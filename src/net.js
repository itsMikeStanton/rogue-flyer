import * as THREE from "three";

// Minimal multiplayer client: a thin WebSocket wrapper that tracks remote
// players and smooths their motion between updates. The game (main.js) owns the
// meshes/HUD; this just holds data + fires events.
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;         // the room/lobby the server placed us in (set on welcome)
    this.lobby = [];          // [{id,name,ready,inGame}] roster of everyone in the room
    this.scores = [];         // [{id,name,kills,deaths}] room scoreboard
    this.connected = false;
    this.status = "offline"; // offline | connecting | online | error
    this.players = new Map(); // id -> remote player record
    this.onEvent = null;      // (type, msg) => {}  for join/leave/welcome/fire/hit/open/close/error
    this._lastSend = 0;
  }

  connect(name, jet, room) {
    this._name = name; this._jet = jet; this._room = room || "";
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    this.status = "connecting";
    try { this.ws = new WebSocket(proto + location.host); }
    catch (e) { this.status = "error"; this._emit("error", e); return; }
    this.ws.onopen = () => { this.connected = true; this.status = "online"; this.send({ t: "join", name, jet, room: this._room }); this._emit("open"); };
    this.ws.onclose = () => { this.connected = false; if (this.status !== "error") this.status = "offline"; this._emit("close"); };
    this.ws.onerror = (e) => { this.status = "error"; this._emit("error", e); };
    this.ws.onmessage = (ev) => this._recv(ev.data);
  }

  disconnect() {
    if (this.ws) { try { this.send({ t: "leave" }); this.ws.close(); } catch (_) { /* ignore */ } }
    this.ws = null; this.connected = false; this.status = "offline";
    this.players.clear(); this.id = null; this.room = null; this.lobby = []; this.scores = [];
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  _emit(t, m) { if (this.onEvent) this.onEvent(t, m); }

  _recv(data) {
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    switch (m.t) {
      case "welcome":
        this.id = m.id;
        this.room = m.room || "PUBLIC";
        for (const p of m.players) this._upsert(p);
        this._emit("welcome", m); break;
      case "join": this._upsert(m); this._emit("join", m); break;
      case "leave": this.players.delete(m.id); this._emit("leave", m); break;
      case "state": if (m.id !== this.id) this._upsert(m); break;
      case "fire": if (m.id !== this.id) this._emit("fire", m); break;
      case "hit": if (m.target === this.id) this._emit("hit", m); break;
      case "lobby": this.lobby = m.players || []; this._emit("lobby", m); break;
      case "launch": this._emit("launch", m); break;
      case "score": this.scores = m.scores || []; this._emit("score", m); break;
      case "kill": this._emit("kill", m); break;
    }
  }

  _upsert(m) {
    let p = this.players.get(m.id);
    if (!p) {
      p = {
        id: m.id, name: m.name || "Pilot", jet: m.jet || "f16", health: 100, alive: true, init: false,
        cur: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
        tgt: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
      };
      this.players.set(m.id, p);
    }
    if (m.name) p.name = m.name;
    if (m.jet) p.jet = m.jet;
    if (m.health != null) p.health = m.health;
    if (m.alive != null) p.alive = m.alive;
    if (m.p) { p.tgt.p.set(m.p[0], m.p[1], m.p[2]); if (!p.init) p.cur.p.copy(p.tgt.p); }
    if (m.q) { p.tgt.q.set(m.q[0], m.q[1], m.q[2], m.q[3]); if (!p.init) p.cur.q.copy(p.tgt.q); }
    p.init = true;
  }

  // Throttled (~15 Hz) local-state broadcast.
  sendState(state, jet, health, alive) {
    const now = performance.now();
    if (now - this._lastSend < 66) return;
    this._lastSend = now;
    const p = state.position, q = state.quaternion;
    this.send({ t: "state", jet, health, alive, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
  }

  sendFire(kind, pos, dir) { this.send({ t: "fire", kind, p: [pos.x, pos.y, pos.z], dir: [dir.x, dir.y, dir.z] }); }
  sendHit(targetId, dmg) { this.send({ t: "hit", target: targetId, dmg }); }
  sendReady(ready) { this.send({ t: "ready", ready: !!ready }); }   // lobby ready toggle
  sendSpawned() { this.send({ t: "spawned" }); }                    // left the bay into flight
  sendDeath(byId) { this.send({ t: "death", by: byId | 0 }); }      // I went down; byId = last attacker (0 = none)

  // Ease remote players toward their latest received transform each frame.
  interpolate(dt) {
    const a = Math.min(1, dt * 9);
    for (const p of this.players.values()) {
      if (p.id === this.id) continue;
      p.cur.p.lerp(p.tgt.p, a);
      p.cur.q.slerp(p.tgt.q, a);
    }
  }

  count() { let n = 0; for (const p of this.players.values()) if (p.id !== this.id) n++; return n; }
}
