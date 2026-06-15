// Canvas-2D heads-up display drawn over the 3D scene.
import { drawEmblem } from "./factionEmblems.js";

// Corrupted interface colours the green symbology flickers to during a glitch.
const GLITCH_COLS = ["#ff2d55", "#2de1ff", "#ffe23a", "#ff8a00", "#36ff9a", "#ffffff"];

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  draw(t, extra) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    // Electronic glitch (stall / blast / eruption / storm): jitter the whole HUD,
    // then tear + fuzz + corrupt it in an overlay below.
    const gl = extra.glitch || 0;
    ctx.save();
    if (gl > 0.02) ctx.translate((Math.random() - 0.5) * 9 * gl, (Math.random() - 0.5) * 6 * gl);
    const cx = w / 2, cy = h / 2;
    // The interface colour itself corrupts during a glitch — the green flickers
    // to broken hues, so the actual symbology (not just an overlay) glitches.
    let green = t.stall ? "#ff5b5b" : "#36ff9a";
    if (gl > 0.02 && Math.random() < gl * 0.5) green = GLITCH_COLS[(Math.random() * GLITCH_COLS.length) | 0];
    ctx.strokeStyle = green;
    ctx.fillStyle = green;
    ctx.lineWidth = 1.5;
    ctx.font = "14px 'Consolas', monospace";

    // Artificial horizon + pitch ladder (behind the reticle)
    if (extra.pitch != null) this.horizon(cx, cy, extra.pitch, extra.roll || 0, green);

    // Fixed aircraft reference (boresight) — stays put as the ladder moves
    ctx.beginPath();
    ctx.moveTo(cx - 60, cy); ctx.lineTo(cx - 30, cy);
    ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 60, cy);
    ctx.moveTo(cx - 30, cy); ctx.lineTo(cx - 24, cy + 7);
    ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 24, cy + 7);
    ctx.stroke();

    // Center reticle (velocity-ish marker)
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 8);
    ctx.stroke();

    // Airspeed tape (left)
    const kts = Math.round(t.speed * 1.94384);
    this.tape(cx - 220, cy, kts, "KTS", -1);
    // Altitude tape (right)
    const ft = Math.round(t.altitude * 3.281);
    this.tape(cx + 220, cy, ft, "ALT", 1);

    // Heading strip (top)
    this.heading(cx, 40, t.heading);

    // Throttle bar (bottom-left)
    this.throttle(40, h - 160, t.throttle);

    // Readouts (bottom center)
    ctx.textAlign = "center";
    const mach = t.mach.toFixed(2);
    const g = t.gForce.toFixed(1);
    const aoa = t.aoa.toFixed(1);
    const vs = Math.round(t.vspeed * 196.85); // m/s -> ft/min
    ctx.fillText(`MACH ${mach}    ${g} G    AoA ${aoa}°    VS ${vs} fpm`, cx, h - 26);

    if (extra.boost) {
      ctx.save();
      ctx.font = "bold 15px 'Consolas', monospace";
      ctx.fillStyle = Math.floor(Date.now() / 120) % 2 ? "#7fd0ff" : "#39a9ff";
      ctx.fillText("▲▲  AFTERBURNER  ▲▲", cx, h - 46);
      ctx.restore();
    }

    if (t.stall) {
      ctx.fillStyle = "#ff5b5b";
      ctx.font = "bold 22px 'Consolas', monospace";
      ctx.fillText("STALL", cx, cy - 60);
    }

    // Takeoff prompt while rolling on the ground.
    if (extra.onGround) {
      const kts = Math.round(t.speed * 1.94384);
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 15px 'Consolas', monospace";
      const msg = kts < 132 ? "THROTTLE UP — ROTATE AT 132 KTS" : "PULL UP ▲";
      ctx.fillText(msg, cx, cy + 90);
    }

    // Top-left info
    ctx.textAlign = "left";
    ctx.fillStyle = green;
    ctx.font = "13px 'Consolas', monospace";
    ctx.fillText(extra.jetName, 20, 26);
    if (extra.camName) ctx.fillText("CAM: " + extra.camName, 20, 44);

    // Time of day (top centre, just under the heading tape) — so the day/night
    // cycle is visible: a phase word + HH:MM clock, tinted to match the sky.
    if (extra.tod) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "bold 13px 'Consolas', monospace";
      const ph = extra.tod.phase;
      ctx.fillStyle = ph === "DAY" ? "#ffe08a" : ph === "DUSK" ? "#ffb066" : ph === "DAWN" ? "#ffc890" : "#9fb6e8";
      const icon = ph === "DAY" ? "☀" : ph === "NIGHT" ? "☾" : "◑";
      ctx.fillText(`${icon} ${ph}  ${extra.tod.clock}`, cx, 86);
      ctx.restore();
      ctx.textAlign = "left";
    }

    // Threat / detection state (top centre): are they onto you?
    if (extra.threat) {
      const tracking = extra.threat === "tracking";
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "bold 15px 'Consolas', monospace";
      // Flash the TRACKED warning so it reads as urgent.
      const on = tracking ? (Math.floor(Date.now() / 320) % 2 === 0) : true;
      ctx.fillStyle = tracking ? (on ? "#ff3b30" : "#7a1c18") : "#ffb733";
      ctx.fillText(tracking ? "◉ TRACKED" : "◎ SEARCHING…", cx, 28);
      ctx.restore();
      ctx.textAlign = "left";
    }

    // Top-right: rings + combat tallies
    ctx.textAlign = "right";
    if (extra.checkpoints) {
      ctx.fillText(`RINGS ${extra.ringsHit}/${extra.checkpoints}`, w - 20, 26);
    }
    if (extra.mode === "mission" || extra.mode === "campaign") {
      ctx.fillText(`TARGETS LEFT ${extra.bandits}`, w - 20, 44);
      ctx.fillText(`DESTROYED ${extra.kills}/${extra.total}`, w - 20, 62);
    } else if (extra.kills != null && extra.mode !== "free") {
      ctx.fillText(`KILLS ${extra.kills}`, w - 20, 44);
      const label = extra.mode === "dogfight" ? "BANDITS" : "DRONES";
      ctx.fillText(`${label} ${extra.bandits}`, w - 20, 62);
      if (extra.wave) ctx.fillText(`WAVE ${extra.wave}`, w - 20, 80);
    }
    ctx.textAlign = "left";

    // Hull health (combat modes) + missiles
    if ((extra.mode === "dogfight" || extra.mode === "mission" || extra.mode === "campaign" || extra.mode === "ffa") && extra.health != null) {
      this.healthBar(20, 58, extra.health);
    }
    // Lives remaining (finite-lives runs only).
    if (extra.lives != null) {
      ctx.textAlign = "left";
      ctx.fillStyle = extra.lives > 1 ? green : "#ff5b5b";
      ctx.font = "12px 'Consolas', monospace";
      ctx.fillText("✈ LIVES " + extra.lives, 180, 66);
    }
    if (extra.ord) {
      ctx.font = "13px 'Consolas', monospace";
      const parts = [];
      if (extra.ord.missiles) parts.push(["MSL", extra.ord.missiles]);
      if (extra.ord.rockets) parts.push(["RKT", extra.ord.rockets]);
      if (extra.ord.bombs) parts.push(["BMB", extra.ord.bombs]);
      if (!parts.length) parts.push(["GUN", "∞"]);
      let x = 20;
      for (const [label, n] of parts) {
        ctx.fillStyle = (typeof n === "number" && n <= 0) ? "#888" : green;
        const s = `${label} ${n}`;
        ctx.fillText(s, x, 92);
        x += ctx.measureText(s).width + 14;
      }
    }

    // Gear / flaps / brake status (above the throttle bar, bottom-left).
    if (extra.gear != null || extra.flaps != null) {
      ctx.textAlign = "left";
      ctx.font = "12px 'Consolas', monospace";
      ctx.fillStyle = extra.gear ? "#36ff9a" : "#6b7785";
      ctx.fillText(extra.gear ? "GEAR ▼ DOWN" : "GEAR ▲ UP", 40, h - 176);
      ctx.fillStyle = extra.flaps ? "#36ff9a" : "#6b7785";
      ctx.fillText(extra.flaps ? "FLAPS ▼" : "FLAPS ▲", 40, h - 192);
      if (extra.brake) { ctx.fillStyle = "#ffd23f"; ctx.fillText("◧ AIRBRAKE", 40, h - 208); }
    }
    // Harrier nozzle / VTOL state.
    if (extra.vtol != null) {
      ctx.textAlign = "left";
      ctx.font = "bold 12px 'Consolas', monospace";
      ctx.fillStyle = extra.vtol ? "#36c8ff" : "#6b7785";
      ctx.fillText(extra.vtol ? "NOZZLES ▼ HOVER" : "NOZZLES ▶ FWD", 40, h - 224);
    }
    // Approaching the ground with the gear up — flash a warning.
    if (extra.gearWarn && Math.floor(performance.now() / 400) % 2 === 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff5b5b";
      ctx.font = "bold 18px 'Consolas', monospace";
      ctx.fillText("▲ LOWER GEAR ▲", cx, cy + 120);
    }

    // Missile lock box around the locked target
    if (extra.lock) this.lockBox(extra.lock);

    // Objective checklist panel (top-left). The in-world targets are the yellow
    // objective contacts (drawn with the air/ground contacts).
    if (extra.objectives && extra.objectives.length) this.objectiveList(extra.objectives, extra.objectiveTitle);
    // Must-destroy count (strike/conquest): how many targets left to clear.
    if (extra.objectivesLeft > 0) {
      ctx.textAlign = "center"; ctx.fillStyle = "#ffe14a"; ctx.font = "700 13px 'Consolas', monospace";
      ctx.fillText(`⌖ ${extra.objectivesLeft} TARGET${extra.objectivesLeft > 1 ? "S" : ""} TO CLEAR`, cx, 92);
    }

    // Nav markers pointing to the other islands.
    if (extra.islandMarkers) for (const m of extra.islandMarkers) this.islandMarker(m);

    // Multiplayer connection status (top centre).
    if (extra.netStatus) {
      ctx.textAlign = "center";
      ctx.fillStyle = extra.netStatus.startsWith("LAN") ? "#36ff9a" : "#ffd23f";
      ctx.font = "12px 'Consolas', monospace";
      ctx.fillText("◈ " + extra.netStatus, cx, 74);
    }
    // Air contacts: markers over/around every aircraft + a radar scope.
    if (extra.contacts) for (const c of extra.contacts) this.contactMarker(c);
    if (extra.radar) this.radarScope(extra.radar);

    // Landing-approach guidance (gates, ILS deviation cross, callouts).
    if (extra.approach) this.approach(extra.approach);
    // Flight-plan route: waypoint markers, legs, next-waypoint cue.
    if (extra.route) this.route(extra.route);
    // Resupply balloon marker.
    if (extra.supply) this.supplyMarker(extra.supply);
    ctx.restore();
    if (gl > 0.02) this.glitch(gl);
  }

  // Electronic-glitch overlay: horizontal tears (slice the HUD and shove it
  // sideways), RGB-ish split, scanline fuzz, and scattered corrupt glyphs.
  glitch(g) {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.save();
    // RGB-split chroma ghosts: redraw the rendered HUD hue-shifted + offset so
    // the actual green lines smear into red/cyan fringes (chromatic aberration).
    const dx = (2 + 12 * g) * (Math.random() < 0.5 ? 1 : -1);
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45 * g;
    if ("filter" in ctx) {
      ctx.filter = "hue-rotate(135deg)"; ctx.drawImage(this.canvas, -dx, 0);   // cyan-shifted ghost
      ctx.filter = "hue-rotate(-105deg)"; ctx.drawImage(this.canvas, dx, 0);   // red/orange-shifted ghost
      ctx.filter = "none";
    } else { ctx.drawImage(this.canvas, dx, 0); }                              // fallback: plain double-image
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    // Tear bands: copy a horizontal slice of the rendered HUD and offset it.
    const bands = 1 + Math.floor(g * 6);
    for (let i = 0; i < bands; i++) {
      if (Math.random() > 0.35 + g * 0.6) continue;
      const by = Math.random() * h, bh = 3 + Math.random() * 26 * g, dx = (Math.random() - 0.5) * 70 * g;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.canvas, 0, by, w, bh, dx, by, w, bh);                 // shifted copy
      ctx.globalAlpha = 0.4 * g; ctx.fillStyle = Math.random() < 0.5 ? "#ff2d55" : "#2de1ff";
      ctx.fillRect(dx * 0.5, by, w, bh);                                       // chroma tint on the tear
    }
    // Scanline fuzz.
    ctx.globalAlpha = 0.05 + 0.08 * g; ctx.fillStyle = "#39ff9a";
    for (let y = (Math.random() * 3) | 0; y < h; y += 3) if (Math.random() < 0.5) ctx.fillRect(0, y, w, 1);
    // Corrupt glyphs scattered across the panel (character-swap feel). Kept
    // sparse and only at stronger glitch levels — a faint glitch shouldn't litter
    // the screen with characters.
    if (g > 0.3) {
      ctx.font = "13px 'Consolas', monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const glyphs = "▓▒░█#@%&!?<>/\\|=+*01010xФД";
      const count = Math.floor((g - 0.3) * 12); // ~0 near the threshold → ~8 at full intensity
      for (let i = 0; i < count; i++) {
        ctx.globalAlpha = (0.18 + Math.random() * 0.3) * g;
        ctx.fillStyle = Math.random() < 0.28 ? "#ff3b30" : "#39ff9a";
        ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], Math.random() * w, Math.random() * h);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Air-drop resupply balloon: a pulsing cyan chute icon + distance, with an edge
  // arrow when it's off-screen, so you can fly out to it to rearm.
  supplyMarker(m) {
    const ctx = this.ctx, CY = "#46e0c0";
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
    const km = m.dist >= 1000 ? `${(m.dist / 1000).toFixed(1)}km` : `${Math.round(m.dist)}m`;
    ctx.save();
    ctx.strokeStyle = CY; ctx.fillStyle = CY; ctx.font = "11px 'Consolas', monospace"; ctx.textAlign = "center";
    if (m.onscreen && !m.behind) {
      ctx.globalAlpha = pulse; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y - 4, 9, Math.PI, 0); ctx.stroke();            // canopy
      ctx.beginPath(); ctx.moveTo(m.x - 9, m.y - 4); ctx.lineTo(m.x - 3, m.y + 6); ctx.moveTo(m.x + 9, m.y - 4); ctx.lineTo(m.x + 3, m.y + 6); ctx.stroke(); // lines
      ctx.strokeRect(m.x - 4, m.y + 6, 8, 6);                                          // crate
      ctx.globalAlpha = 1;
      ctx.fillText(`RESUPPLY  ${km}`, m.x, m.y - 16);
    } else {
      const e = this._edgePoint(m.dirx, m.diry, 58);
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      ctx.globalAlpha = pulse; ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
      ctx.fillText(`RESUPPLY  ${km}`, e.x, e.y - 12);
    }
    ctx.restore();
  }

  // Planned route flown in-game: numbered waypoint diamonds joined by legs, the
  // active waypoint highlighted (amber) with an edge arrow when off-screen, and a
  // progress readout. Mirrors the approach aid but for arbitrary waypoints.
  route(r) {
    const ctx = this.ctx, cx = this.w / 2;
    const CY = "#36c8ff", NX = "#ffd23f", DN = "rgba(110,170,140,0.5)";
    ctx.save();
    // Legs between consecutive on-screen waypoints.
    ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
    for (let i = 0; i < r.wps.length - 1; i++) {
      const a = r.wps[i], b = r.wps[i + 1];
      if (a.behind || b.behind) continue;
      ctx.strokeStyle = b.done ? DN : (b.next ? NX : "rgba(54,200,255,0.5)");
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Waypoint pucks.
    for (const w of r.wps) {
      const col = w.done ? DN : (w.next ? NX : CY);
      if (w.onscreen && !w.behind) {
        const s = w.next ? 9 : 6;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w.next ? 2.2 : 1.5;
        this._wptIcon(w.type, w.x, w.y, s, col);
        ctx.font = "10px 'Consolas', monospace"; ctx.textAlign = "center";
        ctx.fillText(String(w.idx), w.x, w.y - s - 5);
        if (w.next) {
          ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(w.x, w.y, s + 5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
          if (r.next) { ctx.font = "9px 'Consolas', monospace"; ctx.fillText(r.next.label + (r.next.snap ? " ▸ " + r.next.snap.toUpperCase() : ""), w.x, w.y - s - 17); }
        }
      } else if (w.next) {
        const e = this._edgePoint(w.dirx, w.diry, 60);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang);
        ctx.fillStyle = NX; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // Progress readout + attack callout.
    ctx.textAlign = "center"; ctx.font = "12px 'Consolas', monospace";
    if (r.next) {
      const tgt = r.next.snap ? " ▸ " + r.next.snap.toUpperCase() : "";
      ctx.fillStyle = r.next.attack ? "#ff7a5b" : NX;
      ctx.fillText(`ROUTE ▸ WPT ${r.next.idx}/${r.total} · ${r.next.label}${tgt} · ${(r.next.dist / 1000).toFixed(1)} km`, cx, 96);
      if (r.next.attack && r.next.dist < 5000) {
        ctx.font = "700 15px 'Consolas', monospace"; ctx.fillStyle = "#ff5b5b";
        ctx.fillText("◤ ATTACK POINT ◢", cx, 116);
      }
    } else { ctx.fillStyle = "#36ff9a"; ctx.fillText("ROUTE COMPLETE", cx, 96); }
    ctx.restore();
  }

  // Type-specific waypoint icon (stroke only; caller sets colour/width).
  _wptIcon(type, x, y, s, col) {
    const ctx = this.ctx;
    if (type === "attack") {
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.moveTo(x + dx * (s - 1), y + dy * (s - 1)); ctx.lineTo(x + dx * (s + 4), y + dy * (s + 4)); }
      ctx.stroke();
    } else if (type === "ip") {
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.stroke();
    } else if (type === "rtb") {
      ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.55); ctx.lineTo(x + s, y - s * 0.55); ctx.lineTo(x, y + s); ctx.closePath(); ctx.stroke();
    } else {
      ctx.strokeRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
    }
  }

  // ILS-style approach guidance: a tunnel of gates to fly through, a localizer/
  // glideslope deviation cross, a recommended-speed line, steering cues and
  // altitude callouts. Drawn in cyan to set it apart from the green HUD.
  approach(a) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    const CY = "#36c8ff", AM = "#ffd23f", GD = a.onPath ? "#36ff9a" : CY;
    ctx.save();

    // Aim point on the runway (small target cross).
    if (a.aim && a.aim.onscreen && !a.aim.behind) {
      ctx.strokeStyle = CY; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(a.aim.x - 12, a.aim.y); ctx.lineTo(a.aim.x + 12, a.aim.y);
      ctx.moveTo(a.aim.x, a.aim.y - 12); ctx.lineTo(a.aim.x, a.aim.y + 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Approach gates — a receding tunnel; nearer gates are bigger/brighter.
    if (a.gates) {
      for (let i = 0; i < a.gates.length; i++) {
        const g = a.gates[i];
        if (!g.onscreen || g.behind) continue;
        const r = Math.max(12, 50 - i * 8);
        ctx.strokeStyle = g.near ? CY : "rgba(54,200,255,0.55)";
        ctx.lineWidth = g.near ? 2.4 : 1.4;
        ctx.beginPath();
        ctx.rect(g.x - r, g.y - r * 0.72, r * 2, r * 1.44); // squarish gate frame
        ctx.stroke();
      }
    }

    // Off-course: a waypoint diamond / edge arrow to the approach fix.
    if (a.fix) {
      ctx.fillStyle = CY; ctx.strokeStyle = CY;
      if (a.fix.onscreen && !a.fix.behind) {
        const x = a.fix.x, y = a.fix.y;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y);
        ctx.closePath(); ctx.stroke();
        ctx.font = "11px 'Consolas', monospace"; ctx.textAlign = "center";
        ctx.fillText("APP FIX", x, y - 18);
      } else {
        const e = this._edgePoint(a.fix.dirx, a.fix.diry, 54);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang);
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // ILS deviation cross (bottom-centre): steer toward the moving bars.
    const bx = cx, by = cy + 168, half = 62;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(54,200,255,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(bx - half, by - half, half * 2, half * 2);
    // scale dots
    ctx.fillStyle = "rgba(54,200,255,0.6)";
    for (const m of [-0.66, -0.33, 0.33, 0.66]) {
      ctx.beginPath(); ctx.arc(bx + m * half, by, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by + m * half, 2, 0, Math.PI * 2); ctx.fill();
    }
    // fixed aircraft reference
    ctx.globalAlpha = 1; ctx.strokeStyle = "#cfe8ff"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 12, by); ctx.lineTo(bx - 4, by);
    ctx.moveTo(bx + 4, by); ctx.lineTo(bx + 12, by);
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by - 8);
    ctx.stroke();
    // localizer (vertical bar — course left/right) + glideslope (horizontal bar)
    const nx = bx + a.locDev * half, ny = by + a.gsDev * half;
    ctx.strokeStyle = GD; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(nx, by - half + 6); ctx.lineTo(nx, by + half - 6); ctx.stroke(); // localizer
    ctx.beginPath(); ctx.moveTo(bx - half + 6, ny); ctx.lineTo(bx + half - 6, ny); ctx.stroke(); // glideslope
    // labels under the box
    ctx.fillStyle = CY; ctx.font = "10px 'Consolas', monospace"; ctx.textAlign = "center";
    ctx.fillText("LOC", bx, by + half + 13);
    ctx.textAlign = "right"; ctx.fillText("G/S", bx - half - 6, by + 4);

    // Status + numbers (just above the cross).
    ctx.textAlign = "center";
    ctx.fillStyle = a.onPath ? "#36ff9a" : CY;
    ctx.font = "bold 14px 'Consolas', monospace";
    ctx.fillText(a.status, bx, by - half - 26);
    ctx.fillStyle = CY; ctx.font = "12px 'Consolas', monospace";
    ctx.fillText(`◎ APPROACH    DIST ${a.dist}m    HGT ${a.height}m`, bx, by - half - 10);

    // Recommended vs actual speed (amber if outside the window).
    const spdOff = Math.abs(a.vNow - a.vTarget) > 18;
    ctx.fillStyle = spdOff ? AM : CY; ctx.textAlign = "right";
    ctx.fillText(`SPD ${a.vNow}`, bx - 18, by + half + 28);
    ctx.fillStyle = CY; ctx.textAlign = "left";
    ctx.fillText(`tgt ${a.vTarget} KTS`, bx + 18, by + half + 28);

    // Steering cues, stacked above the status line.
    if (a.cues && a.cues.length) {
      ctx.textAlign = "center"; ctx.font = "bold 13px 'Consolas', monospace";
      ctx.fillStyle = AM;
      let yy = by - half - 46;
      for (const c of a.cues) { ctx.fillText(c, bx, yy); yy -= 17; }
    }

    // Big altitude callout in the flare.
    if (a.callout) {
      ctx.textAlign = "center";
      ctx.fillStyle = a.callout === "FLARE" ? AM : "#cfe8ff";
      ctx.font = "bold 30px 'Consolas', monospace";
      ctx.fillText(a.callout, cx, cy - 96);
    }
    ctx.restore();
  }

  // Place an off-screen indicator on the inset screen-border in the target's
  // direction. dirx/diry are clip-space (NDC-proportional, sign-corrected for
  // behind) so the point doesn't swing wildly near the camera plane. Returns the
  // pixel position + the outward angle for the arrow.
  _edgePoint(dirx, diry, margin) {
    const W = this.w, H = this.h, cx = W / 2, cy = H / 2;
    // NDC x→right, y→up; screen y is down. Convert the clip direction to pixels.
    let ex = (dirx || 0) * (W * 0.5), ey = -(diry || 0) * (H * 0.5);
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) ey = 1;
    const halfW = cx - margin, halfH = cy - margin;
    const scale = 1 / Math.max(Math.abs(ex) / halfW, Math.abs(ey) / halfH);
    return { x: cx + ex * scale, y: cy + ey * scale, ang: Math.atan2(ey, ex) };
  }

  contactMarker(c) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    const col = c.color || "#ff5b5b";
    const km = c.dist >= 1000 ? `${(c.dist / 1000).toFixed(1)}km` : `${Math.round(c.dist)}m`;
    const label = c.name ? `${c.name}  ${km}` : km;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.font = "10px 'Consolas', monospace";
    if (c.onscreen && !c.behind) {
      const obj = c.kind === "objective";
      const s = obj ? (c.focus ? 14 : 11) : 13;
      ctx.lineWidth = obj ? 2 : 1.5;
      ctx.globalAlpha = (obj && c.focus) ? 0.55 + 0.45 * Math.sin(performance.now() / 180) : 0.9; // nearest objective pulses
      this._contactShape(c.kind, c.x, c.y, s);
      ctx.globalAlpha = 1; ctx.textAlign = "center";
      ctx.fillText((obj && c.focus ? "▸ " : "") + label, c.x, c.y - s - 6);
      if (c.health != null) {
        const w = 40, h = 3, x = c.x - w / 2, y = c.y + s + 4;
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, w, h);
        const hp = Math.max(0, Math.min(100, c.health)) / 100;
        ctx.fillStyle = hp > 0.5 ? "#36ff9a" : hp > 0.25 ? "#ffd23f" : "#ff5b5b";
        ctx.fillRect(x, y, w * hp, h);
      }
    } else {
      // Off-screen: only the nearest objective gets an edge arrow (the rest would clutter).
      if (c.kind === "objective" && !c.focus) { ctx.restore(); return; }
      const e = this._edgePoint(c.dirx, c.diry, 50);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.textAlign = "center";
      ctx.fillText(label, e.x, e.y - 12);
    }
    ctx.restore();
  }

  // Shape per contact kind so they read at a glance: enemy air = diamond,
  // ground threat = square, neutral traffic = circle, must-destroy = boxed
  // crosshair (corner-bracket reticles are reserved for the missile lock).
  _contactShape(kind, x, y, s) {
    const ctx = this.ctx;
    if (kind === "ground") {
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    } else if (kind === "traffic") {
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke();
    } else if (kind === "objective") {
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke(); // inner crosshair
    } else { // air (enemy aircraft): diamond
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.stroke();
    }
  }

  // Top-right radar: blips relative to you, your nose pointing up.
  radarScope(radar) {
    const ctx = this.ctx;
    const R = 58, rx = this.w - R - 22, ry = R + 84;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.fillStyle = "rgba(6,16,12,0.5)";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(54,255,154,0.55)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#36ff9a";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-4, 4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill();
    for (const b of radar.blips) {
      const x = b.nx * R, y = -b.ny * R;
      ctx.fillStyle = b.color || "#ff5b5b";
      ctx.globalAlpha = b.far ? 0.5 : 1;
      ctx.beginPath(); ctx.arc(x, y, b.far ? 2.5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(54,255,154,0.8)"; ctx.font = "9px 'Consolas', monospace"; ctx.textAlign = "center";
    ctx.fillText(`${(radar.range / 1000).toFixed(0)}km`, 0, R + 12);
    ctx.restore();
  }

  islandMarker(m) {
    const ctx = this.ctx;
    const st = m.stance || m.faction; // stance toward the player (enemy/ally/neutral)
    const baseCol = st === "enemy" ? "#ff6b6b" : st === "ally" ? "#7fd2ff" : "#cbd5e0";
    const col = m.isTarget ? "#ffd23f" : baseCol; // the selected target island flies amber
    const km = (m.dist / 1000).toFixed(1);
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = "11px 'Consolas', monospace";
    if (m.onscreen && !m.behind) {
      // Range-as-height: float the marker up off the island's real point — the
      // farther the island, the higher it climbs — with a leader line tying it
      // back down to the point. The target island is exempt (sits on its point,
      // drawn prominently) so you can steer to it precisely.
      const lift = m.isTarget ? 0 : Math.min(240, Math.max(0, ((m.dist - 9000) / 1000) * 3.4));
      const fx = Math.max(48, Math.min(this.w - 48, m.x));
      const fy = Math.max(64, Math.min(this.h - 80, m.y - lift));
      if (lift > 4) {
        ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(fx, fy); ctx.stroke();
      }
      const R = m.isTarget ? 12 : 9;
      ctx.globalAlpha = m.isTarget ? 1 : 0.95;
      if (m.isTarget) {
        // Prominent target reticle: a pulsing bracketed box + crosshair ticks.
        const pulse = 3 + 2 * Math.sin(performance.now() / 250);
        ctx.lineWidth = 2; ctx.strokeStyle = col;
        const b = R + 7 + pulse;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(fx + sx * b, fy + sy * b - sy * 7); ctx.lineTo(fx + sx * b, fy + sy * b); ctx.lineTo(fx + sx * b - sx * 7, fy + sy * b);
          ctx.stroke();
        }
      }
      // Faction emblem (in its own colour) marks who holds the island; the ring
      // falls back for factions without a logo.
      if (m.emblem) drawEmblem(ctx, m.emblem, fx, fy, R, m.factionColor, { badge: false, weight: m.isTarget ? 0.22 : 0.16 });
      else { ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(fx, fy, R - 2, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.font = m.isTarget ? "700 12px 'Consolas', monospace" : "11px 'Consolas', monospace";
      ctx.fillText(`${m.isTarget ? "◎ " : ""}${m.name}  ${km}km`, fx, fy - R - 9);
    } else {
      // off-screen / behind: arrow at the screen edge pointing toward it (the
      // target's arrow rides further in and bolder so it's easy to chase).
      const e = this._edgePoint(m.dirx, m.diry, m.isTarget ? 80 : 64);
      ctx.save();
      ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      ctx.globalAlpha = m.isTarget ? 1 : 0.9;
      const s = m.isTarget ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(14 * s, 0); ctx.lineTo(-7 * s, -8 * s); ctx.lineTo(-7 * s, 8 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (m.emblem) drawEmblem(ctx, m.emblem, e.x - 32, e.y - 14, 7, m.factionColor, { badge: false, weight: 0.18 });
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.textAlign = "center";
      ctx.font = m.isTarget ? "700 11px 'Consolas', monospace" : "11px 'Consolas', monospace";
      ctx.fillText(`${m.isTarget ? "◎ " : ""}${m.name}  ${km}km`, e.x, e.y - 14);
    }
    ctx.restore();
  }

  // Attitude indicator: a horizon bar and pitch-ladder rungs that bank with
  // roll and slide with pitch, clipped to a box around the centre.
  horizon(cx, cy, pitch, roll, color) {
    const ctx = this.ctx;
    const k = 5.2; // pixels per degree
    const pdeg = pitch * 180 / Math.PI;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 230, cy - 150, 460, 300); // keep the ladder near centre
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    ctx.translate(0, pdeg * k);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.font = "11px 'Consolas', monospace";
    ctx.textAlign = "left";
    // horizon (0°) line with a centre gap
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-200, 0); ctx.lineTo(-26, 0);
    ctx.moveTo(26, 0); ctx.lineTo(200, 0);
    ctx.stroke();
    // pitch rungs
    ctx.globalAlpha = 0.75;
    for (let a = -60; a <= 60; a += 10) {
      if (a === 0) continue;
      const y = -a * k;
      const half = a > 0 ? 60 : 50;
      const tick = a > 0 ? 8 : -8;
      ctx.beginPath();
      if (a < 0) ctx.setLineDash([7, 6]); else ctx.setLineDash([]);
      ctx.moveTo(-half, y); ctx.lineTo(-26, y);
      ctx.moveTo(26, y); ctx.lineTo(half, y);
      // end caps point toward the horizon
      ctx.moveTo(-26, y); ctx.lineTo(-26, y + tick);
      ctx.moveTo(26, y); ctx.lineTo(26, y + tick);
      ctx.stroke();
      ctx.setLineDash([]);
      const lbl = String(Math.abs(a));
      ctx.fillText(lbl, -half - 18, y + 4);
      ctx.fillText(lbl, half + 6, y + 4);
    }
    ctx.restore();
  }

  // Mission objective checklist, top-left under the ordnance row.
  objectiveList(list, title) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "12px 'Consolas', monospace";
    let y = 124;
    ctx.fillStyle = "#9fb3c4";
    ctx.fillText(title || "OBJECTIVES", 20, y); y += 18;
    for (const o of list) {
      const done = o.state === "done", failed = o.state === "failed";
      const mark = done ? "✓" : failed ? "✗" : o.priority === "optional" ? "○" : o.priority === "secondary" ? "◆" : "●";
      ctx.fillStyle = done ? "#36ff9a" : failed ? "#ff5b5b" : o.priority === "optional" ? "#8fa0b0" : "#ffd23f";
      let label = `${mark} ${o.label}`;
      if (!done && !failed && o.total != null && o.total > 1) label += `  ×${o.left}`; // how many of this type remain
      if (o.timeLeft != null) label += `  ${o.timeLeft}s`;
      ctx.fillText(label, 20, y);
      y += 17;
    }
    ctx.restore();
  }

  objective(o) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    ctx.save();
    ctx.fillStyle = "#ffe14a";   // bright yellow — distinct from red air / orange ground
    ctx.strokeStyle = "#ffe14a";
    if (o.onscreen && !o.behind) {
      const x = o.x, y = o.y;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y); ctx.lineTo(x, y + 11); ctx.lineTo(x - 11, y);
      ctx.closePath(); ctx.stroke();
      ctx.font = "11px 'Consolas', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`TGT ${Math.round(o.dist)}m`, x, y + 26);
    } else {
      // off-screen / behind: arrow at the screen edge pointing toward it
      const e = this._edgePoint(o.dirx, o.diry, 46);
      ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  healthBar(x, y, hp) {
    const ctx = this.ctx;
    const w = 150, hh = 10;
    const frac = Math.max(0, Math.min(1, hp / 100));
    const col = frac > 0.5 ? "#36ff9a" : frac > 0.25 ? "#ffd23f" : "#ff5b5b";
    ctx.save();
    ctx.strokeStyle = "#9fb3c4";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, hh);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * frac, hh);
    ctx.fillStyle = "#9fb3c4";
    ctx.font = "10px 'Consolas', monospace";
    ctx.fillText("HULL", x, y - 4);
    ctx.restore();
  }

  lockBox(lock) {
    const ctx = this.ctx;
    const locked = !!lock.locked;
    const prog = lock.progress == null ? (locked ? 1 : 0) : lock.progress;
    const col = locked ? "#36ff9a" : "#ffd23f"; // green when solid, amber while seeking
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    if (locked) {
      // Solid green corner brackets — a confirmed lock.
      const s = 24, c = 12;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = lock.x + sx * s, y = lock.y + sy * s;
        ctx.beginPath();
        ctx.moveTo(x - sx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * c);
        ctx.stroke();
      }
      ctx.font = "bold 12px 'Consolas', monospace"; ctx.textAlign = "center";
      ctx.fillText(`◉ LOCK ${Math.round(lock.dist)}m`, lock.x, lock.y + s + 16);
    } else {
      // Seeking: a flashing dashed box + a ring that closes in as lock builds.
      ctx.globalAlpha = 0.45 + 0.55 * (Math.floor(performance.now() / 120) % 2);
      const s = 30;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(lock.x - s, lock.y - s, s * 2, s * 2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // closing acquisition ring (full circle -> shrinks to the box as prog->1)
      const r = 8 + (1 - prog) * 44;
      ctx.beginPath(); ctx.arc(lock.x, lock.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.font = "11px 'Consolas', monospace"; ctx.textAlign = "center";
      ctx.fillText(`SEEKING ${Math.round(prog * 100)}%`, lock.x, lock.y + s + 16);
    }
    ctx.restore();
  }

  tape(x, cy, value, label, dir) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = dir < 0 ? "right" : "left";
    const bx = x + dir * 6;
    ctx.strokeStyle = ctx.fillStyle;
    // box
    ctx.beginPath();
    const bw = 70;
    const left = dir < 0 ? x - bw : x;
    ctx.rect(left, cy - 14, bw, 28);
    ctx.stroke();
    ctx.font = "16px 'Consolas', monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(value), left + bw / 2, cy + 5);
    ctx.font = "11px 'Consolas', monospace";
    ctx.fillText(label, left + bw / 2, cy - 22);
    ctx.restore();
  }

  heading(cx, y, hdg) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "12px 'Consolas', monospace";
    const span = 90; // degrees visible
    const pxPerDeg = 360 / span;
    for (let d = -span / 2; d <= span / 2; d += 5) {
      const deg = ((Math.round(hdg / 5) * 5 + d) % 360 + 360) % 360;
      const px = cx + d * pxPerDeg;
      const major = deg % 30 === 0;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + (major ? 12 : 6));
      ctx.stroke();
      if (major) {
        const lbl = deg === 0 ? "N" : deg === 90 ? "E" : deg === 180 ? "S" : deg === 270 ? "W" : String(deg);
        ctx.fillText(lbl, px, y + 26);
      }
    }
    // caret
    ctx.beginPath();
    ctx.moveTo(cx, y - 8); ctx.lineTo(cx - 6, y - 16); ctx.lineTo(cx + 6, y - 16); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  throttle(x, y, t) {
    const ctx = this.ctx;
    ctx.save();
    const w = 22, h = 120;
    ctx.strokeRect(x, y, w, h);
    ctx.fillRect(x, y + h * (1 - t), w, h * t);
    ctx.font = "11px 'Consolas', monospace";
    ctx.textAlign = "center";
    ctx.fillText("THR", x + w / 2, y - 8);
    ctx.fillText(Math.round(t * 100) + "%", x + w / 2, y + h + 16);
    if (t > 0.92) {
      ctx.fillStyle = "#7fd2ff";
      ctx.fillText("AB", x + w / 2, y + h + 30);
    }
    ctx.restore();
  }
}
