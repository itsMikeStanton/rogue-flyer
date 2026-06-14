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
// "Launch together": when every waiting pilot in a room is ready (and there's at
// least one), the whole lobby is launched at once. Solo readies up and goes too.
function lobbyRoster(room) {
  const out = [];
  for (const c of clients.values()) if (c.room === room) out.push({ id: c.id, name: c.name, jet: c.jet, ready: !!c.ready, inGame: !!c.inGame });
  return out;
}
function broadcastLobby(room) { broadcast({ t: "lobby", room, players: lobbyRoster(room) }, room); }
function checkLaunch(room) {
  const waiting = [];
  for (const [ws, c] of clients) if (c.room === room && !c.inGame) waiting.push([ws, c]);
  if (!waiting.length || !waiting.every(([, c]) => c.ready)) return;
  const n = waiting.length;
  const msg = JSON.stringify({ t: "launch", n });
  for (const [ws, c] of waiting) { c.inGame = true; c.ready = false; if (ws.readyState === 1) ws.send(msg); }
  broadcastLobby(room); // tell the room the launchers are now flying
}

wss.on("connection", (ws) => {
  const me = { id: nextId++, name: "Pilot", jet: "f16", last: null, room: "PUBLIC", ready: false, inGame: false };
  clients.set(ws, me);
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
    if (m.t === "join") {
      me.name = String(m.name || "Pilot").slice(0, 20);
      me.jet = m.jet || me.jet;
      me.room = normRoom(m.room);
      me.ready = false; me.inGame = false; // a fresh join starts in the bay/lobby
      const players = [];
      for (const c of clients.values()) if (c.id !== me.id && c.room === me.room && c.last) players.push({ id: c.id, name: c.name, jet: c.jet, ...c.last });
      ws.send(JSON.stringify({ t: "welcome", id: me.id, room: me.room, players }));
      broadcast({ t: "join", id: me.id, name: me.name, jet: me.jet }, me.room, ws);
      broadcastLobby(me.room);
    } else if (m.t === "ready") {
      me.ready = !!m.ready;
      broadcastLobby(me.room);
      checkLaunch(me.room);
    } else if (m.t === "spawned") { // took off (ready-launch or solo "launch now")
      me.inGame = true; me.ready = false;
      broadcastLobby(me.room);
    } else if (m.t === "state") {
      me.jet = m.jet || me.jet;
      me.last = { p: m.p, q: m.q, health: m.health, alive: m.alive };
      broadcast({ t: "state", id: me.id, jet: me.jet, p: m.p, q: m.q, health: m.health, alive: m.alive }, me.room, ws);
    } else if (m.t === "fire") {
      broadcast({ t: "fire", id: me.id, kind: m.kind, p: m.p, dir: m.dir }, me.room, ws);
    } else if (m.t === "hit") {
      broadcast({ t: "hit", target: m.target, by: me.id, dmg: m.dmg }, me.room); // to the room (target applies it)
    }
  });
  ws.on("close", () => { const room = me.room; clients.delete(ws); broadcast({ t: "leave", id: me.id }, room); broadcastLobby(room); });
  ws.on("error", () => {});
});

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
