// Rogue Flyer LAN multiplayer server.
//
// Serves the game's static files AND a WebSocket relay on the SAME port, so the
// browser connects to ws://<same-host> with no mixed-content/HTTPS problems.
// Everyone on the Wi-Fi opens http://<your-ip>:7359 and plays.
//
//   cd server && npm install && npm start
//
// It's a dumb relay: it forwards each player's state/fire/hit messages to the
// others and hands a newcomer a snapshot of who's already connected.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");

const ROOT = path.resolve(__dirname, "..");        // repo root = the game
const PORT = process.env.PORT || 7359; // "RFLY" — Rogue Flyer's own port (avoids the usual dev-server clashes)
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
let nextId = 1;
const clients = new Map(); // ws -> { id, name, jet, last, room }

// Players only see / relay to others in the SAME room. An empty code drops you
// into the shared "PUBLIC" lobby; any custom code is a private game you share by
// link. Codes normalise to A–Z0–9, max 6, so "abc 12" and "ABC12" collide the
// way a person typing a code would expect.
function normRoom(s) {
  const r = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return r || "PUBLIC";
}

function broadcast(obj, room, exceptWs) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws === exceptWs || ws.readyState !== 1) continue;
    const c = clients.get(ws);
    if (c && c.room === room) ws.send(msg);
  }
}

// Lobby = pilots in a room who are still in the vehicle bay (inGame === false).
// "Launch together": when every ACTIVE waiting pilot in a room is ready (and
// there's at least one), the whole lobby launches at once. Solo readies up and
// goes too. An idle pilot who never readies is marked `afk` and excluded from
// the all-ready gate so they can't hold the room hostage (and is eventually
// kicked). The HOST — the longest-waiting pilot still in the bay — can override
// and force-start the room regardless of who's ready.
const AFK_IDLE = 45000;  // un-ready + idle this long → afk (excluded from the launch gate)
const AFK_KICK = 150000; // ...and this long → disconnected, if the room has others waiting
function lobbyRoster(room) {
  const out = [];
  for (const c of clients.values()) if (c.room === room) out.push({ id: c.id, name: c.name, jet: c.jet, ready: !!c.ready, inGame: !!c.inGame, afk: !!c.afk });
  return out;
}
// Host = the lowest-id pilot still waiting in the bay (stable; passes to the next
// when the host launches or leaves). Returns 0 if nobody is in the bay.
function hostOf(room) {
  let host = 0;
  for (const c of clients.values()) if (c.room === room && !c.inGame) { if (host === 0 || c.id < host) host = c.id; }
  return host;
}
function broadcastLobby(room) { broadcast({ t: "lobby", room, players: lobbyRoster(room), host: hostOf(room) }, room); }
function scoreRoster(room) {
  const out = [];
  for (const c of clients.values()) if (c.room === room) out.push({ id: c.id, name: c.name, kills: c.kills | 0, deaths: c.deaths | 0 });
  return out;
}
function broadcastScores(room) { broadcast({ t: "score", scores: scoreRoster(room) }, room); }
// Launch a set of [ws, client] pairs together.
function launchPilots(room, pairs) {
  if (!pairs.length) return;
  const msg = JSON.stringify({ t: "launch", n: pairs.length });
  for (const [ws, c] of pairs) { c.inGame = true; c.ready = false; c.afk = false; if (ws.readyState === 1) ws.send(msg); }
  broadcastLobby(room); // tell the room the launchers are now flying
}
function waitingIn(room) { const out = []; for (const [ws, c] of clients) if (c.room === room && !c.inGame) out.push([ws, c]); return out; }
function checkLaunch(room) {
  const waiting = waitingIn(room);
  const active = waiting.filter(([, c]) => !c.afk); // idle pilots don't gate the launch
  if (!active.length || !active.every(([, c]) => c.ready)) return;
  launchPilots(room, active); // afk pilots stay behind in the bay
}
// Host override: launch everyone still in the bay, ready or not.
function forceStart(room, byId) {
  if (hostOf(room) !== byId) return; // only the current host may force-start
  launchPilots(room, waitingIn(room));
}

// --- Authority (#3): the server owns HP + death and validates damage. ----
// A `hit` is a REQUEST; clients no longer self-apply damage or author kills.
const DMG_CAP = { gun: 16, missile: 130, rocket: 55, bomb: 255 }; // clamp ceilings (real: 12/120/45/240)
const ENV_CAP = 260;            // max single self-inflicted (eruption/ram/terrain) hit
const MAX_RANGE = 9000;         // beyond the fog → a bogus long-range hit claim
const RATE_WIN = 1000, RATE_DMG = 1700; // per-shooter sliding-window damage ceiling
const MAX_SPEED = 1400;         // u/s; anti-teleport gate on `state` (jets do a few hundred)
const MSG_WIN = 1000, MSG_MAX = 320;    // per-connection message-rate cap (anti-flood)

function findInRoom(room, id) { for (const c of clients.values()) if (c.id === id && c.room === room) return c; return null; }
function killOnServer(victim, byId) {
  if (!victim.alive) return;
  victim.alive = false; victim.deaths++;
  const killer = byId ? findInRoom(victim.room, byId) : null;
  if (killer && killer.id !== victim.id) killer.kills++;
  broadcast({ t: "kill", killer: killer ? killer.id : 0, killerName: killer ? killer.name : "", victim: victim.id, victimName: victim.name }, victim.room);
  broadcastScores(victim.room);
}
function applyDamageServer(victim, dmg, byId) {
  if (!victim.alive || dmg <= 0) return;
  victim.hp = Math.max(0, victim.hp - dmg);
  broadcast({ t: "hp", id: victim.id, hp: victim.hp, by: byId || 0, alive: victim.hp > 0 }, victim.room);
  if (victim.hp <= 0) killOnServer(victim, byId);
}

wss.on("connection", (ws) => {
  const me = { id: nextId++, name: "Pilot", jet: "f16", last: null, room: "PUBLIC", ready: false, inGame: false, afk: false, lobbySince: Date.now(), kills: 0, deaths: 0, hp: 100, alive: true, lastT: 0, dmgWin: [], msgWin: [] };
  clients.set(ws, me);
  ws.on("message", (buf) => {
    // Anti-flood: drop messages past a generous per-connection rate.
    const tnow = Date.now();
    me.msgWin.push(tnow); if (me.msgWin.length > MSG_MAX + 8) me.msgWin.shift();
    while (me.msgWin.length && tnow - me.msgWin[0] > MSG_WIN) me.msgWin.shift();
    if (me.msgWin.length > MSG_MAX) return;
    let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
    if (m.t === "join") {
      me.name = String(m.name || "Pilot").slice(0, 20);
      me.jet = m.jet || me.jet;
      me.uid = String(m.uid || "").slice(0, 64); // stable guest token — seam for future account/stat persistence (#4)
      me.room = normRoom(m.room);
      me.ready = false; me.inGame = false; me.afk = false; me.lobbySince = Date.now(); // a fresh join starts in the bay/lobby
      me.hp = 100; me.alive = true; me.last = null;
      const players = [];
      for (const c of clients.values()) if (c.id !== me.id && c.room === me.room && c.last) players.push({ id: c.id, name: c.name, jet: c.jet, p: c.last.p, q: c.last.q, hp: c.hp, alive: c.alive });
      ws.send(JSON.stringify({ t: "welcome", id: me.id, room: me.room, players }));
      broadcast({ t: "join", id: me.id, name: me.name, jet: me.jet }, me.room, ws);
      broadcastLobby(me.room);
      broadcastScores(me.room);
    } else if (m.t === "ready") {
      me.ready = !!m.ready;
      me.afk = false; me.lobbySince = Date.now(); // toggling ready counts as activity
      broadcastLobby(me.room);
      checkLaunch(me.room);
    } else if (m.t === "forcestart") { // host override — launch the whole bay now
      forceStart(me.room, me.id);
    } else if (m.t === "spawned") { // took off (ready-launch or solo "launch now")
      me.inGame = true; me.ready = false;
      broadcastLobby(me.room);
    } else if (m.t === "respawn") { // (re)entering live flight at full health
      me.hp = 100; me.alive = true; me.last = null; // re-baseline position (legit teleport to spawn)
      broadcast({ t: "hp", id: me.id, hp: 100, by: 0, alive: true }, me.room);
    } else if (m.t === "state") {
      if (!Array.isArray(m.p) || !Array.isArray(m.q)) return;
      me.jet = m.jet || me.jet;
      // Anti-teleport: relay only physically-plausible movement (self-healing —
      // last is always updated so a lag spike can't freeze you permanently).
      let ok = true;
      if (me.last && me.lastT) {
        const dt = Math.max(0.05, (tnow - me.lastT) / 1000);
        const dx = m.p[0] - me.last.p[0], dy = m.p[1] - me.last.p[1], dz = m.p[2] - me.last.p[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > MAX_SPEED * dt + 400) ok = false;
      }
      me.last = { p: m.p, q: m.q }; me.lastT = tnow;
      if (ok) broadcast({ t: "state", id: me.id, jet: me.jet, p: m.p, q: m.q }, me.room, ws);
    } else if (m.t === "fire") {
      broadcast({ t: "fire", id: me.id, kind: m.kind, p: m.p, dir: m.dir }, me.room, ws);
    } else if (m.t === "hit") {
      // Damage REQUEST → validate, then the server applies it authoritatively.
      const cap = DMG_CAP[m.kind]; if (cap == null) return;        // unknown weapon
      const target = findInRoom(me.room, m.target | 0);
      if (!target || !target.alive || !me.alive || target.id === me.id) return;
      const dmg = Math.min(Math.max(0, +m.dmg || 0), cap);         // clamp to the weapon's ceiling
      if (me.last && target.last) {                                // range gate
        const dx = me.last.p[0] - target.last.p[0], dy = me.last.p[1] - target.last.p[1], dz = me.last.p[2] - target.last.p[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > MAX_RANGE) return;
      }
      me.dmgWin = me.dmgWin.filter((e) => tnow - e.t < RATE_WIN);   // sliding-window rate cap
      if (me.dmgWin.reduce((a, e) => a + e.d, 0) >= RATE_DMG) return;
      me.dmgWin.push({ t: tnow, d: dmg });
      applyDamageServer(target, dmg, me.id);
    } else if (m.t === "env") {
      // Self-inflicted environment damage (eruption / ram / terrain) — trusted
      // but capped, then run through the same authoritative HP path.
      applyDamageServer(me, Math.min(Math.max(0, +m.dmg || 0), ENV_CAP), 0);
    }
  });
  ws.on("close", () => { const room = me.room; clients.delete(ws); broadcast({ t: "leave", id: me.id }, room); broadcastLobby(room); broadcastScores(room); });
  ws.on("error", () => {});
});

// Idle sweep: pilots who linger un-ready in the bay get flagged afk (so they stop
// gating the room's synced launch), then kicked if a shared room is waiting on them.
setInterval(() => {
  const now = Date.now();
  const rooms = new Map(); // room -> [[ws, client], …] of pilots still in the bay
  for (const [ws, c] of clients) {
    if (c.inGame) continue;
    let arr = rooms.get(c.room); if (!arr) { arr = []; rooms.set(c.room, arr); }
    arr.push([ws, c]);
  }
  for (const [room, waiting] of rooms) {
    let changed = false;
    for (const [ws, c] of waiting) {
      if (c.ready) continue;
      const idle = now - c.lobbySince;
      if (idle > AFK_KICK && waiting.length > 1) { try { ws.close(); } catch (_) { /* ignore */ } continue; } // boot the loiterer (shared rooms only)
      if (idle > AFK_IDLE && !c.afk) { c.afk = true; changed = true; }
    }
    if (changed) { broadcastLobby(room); checkLaunch(room); }
  }
}, 3000);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use — a server is probably still running.`);
    console.error(`  Free it:              lsof -ti:${PORT} | xargs kill -9`);
    console.error(`  Or pick another port: PORT=${Number(PORT) + 1} npm start\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const ips = [];
  for (const ifs of Object.values(os.networkInterfaces())) for (const i of ifs) if (i.family === "IPv4" && !i.internal) ips.push(i.address);
  console.log("\n  Rogue Flyer — LAN multiplayer server");
  console.log("  ------------------------------------");
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Network:  http://${ip}:${PORT}   <- share this with players on your Wi-Fi`);
  console.log('\n  Open the URL, choose "Multiplayer FFA", and fly.\n');
});
