// Rogue Flyer LAN multiplayer server.
//
// Serves the game's static files AND a WebSocket relay on the SAME port, so the
// browser connects to ws://<same-host> with no mixed-content/HTTPS problems.
// Everyone on the Wi-Fi opens http://<your-ip>:8080 and plays.
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
const PORT = process.env.PORT || 8080;
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
const clients = new Map(); // ws -> { id, name, jet, last }

function broadcast(obj, exceptWs) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws !== exceptWs && ws.readyState === 1) ws.send(msg);
}

wss.on("connection", (ws) => {
  const me = { id: nextId++, name: "Pilot", jet: "f16", last: null };
  clients.set(ws, me);
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
    if (m.t === "join") {
      me.name = String(m.name || "Pilot").slice(0, 20);
      me.jet = m.jet || me.jet;
      const players = [];
      for (const c of clients.values()) if (c.id !== me.id && c.last) players.push({ id: c.id, name: c.name, jet: c.jet, ...c.last });
      ws.send(JSON.stringify({ t: "welcome", id: me.id, players }));
      broadcast({ t: "join", id: me.id, name: me.name, jet: me.jet }, ws);
    } else if (m.t === "state") {
      me.jet = m.jet || me.jet;
      me.last = { p: m.p, q: m.q, health: m.health, alive: m.alive };
      broadcast({ t: "state", id: me.id, jet: me.jet, p: m.p, q: m.q, health: m.health, alive: m.alive }, ws);
    } else if (m.t === "fire") {
      broadcast({ t: "fire", id: me.id, kind: m.kind, p: m.p, dir: m.dir }, ws);
    } else if (m.t === "hit") {
      broadcast({ t: "hit", target: m.target, by: me.id, dmg: m.dmg }); // to everyone (target applies it)
    }
  });
  ws.on("close", () => { clients.delete(ws); broadcast({ t: "leave", id: me.id }); });
  ws.on("error", () => {});
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
