// Canvas-2D heads-up display drawn over the 3D scene.

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
    const cx = w / 2, cy = h / 2;
    const green = t.stall ? "#ff5b5b" : "#36ff9a";
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

    // Mission objective marker (on-screen diamond or edge arrow).
    if (extra.objective) this.objective(extra.objective);
    // Objective checklist panel (top-left).
    if (extra.objectives && extra.objectives.length) this.objectiveList(extra.objectives);

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
        let dx = a.fix.ndcx, dy = a.fix.ndcy;
        if (a.fix.behind) { dx = -dx; dy = -dy; }
        const ang = Math.atan2(-dy, dx);
        const rx = this.w / 2 - 54, ry = this.h / 2 - 54;
        const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
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

  contactMarker(c) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    const col = c.color || "#ff5b5b";
    const km = c.dist >= 1000 ? `${(c.dist / 1000).toFixed(1)}km` : `${Math.round(c.dist)}m`;
    const label = c.name ? `${c.name}  ${km}` : km;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.font = "10px 'Consolas', monospace";
    if (c.onscreen && !c.behind) {
      const s = 13;
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
      ctx.strokeRect(c.x - s, c.y - s, s * 2, s * 2);
      ctx.globalAlpha = 1; ctx.textAlign = "center";
      ctx.fillText(label, c.x, c.y - s - 5);
      if (c.health != null) {
        const w = 40, h = 3, x = c.x - w / 2, y = c.y + s + 4;
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, w, h);
        const hp = Math.max(0, Math.min(100, c.health)) / 100;
        ctx.fillStyle = hp > 0.5 ? "#36ff9a" : hp > 0.25 ? "#ffd23f" : "#ff5b5b";
        ctx.fillRect(x, y, w * hp, h);
      }
    } else {
      let dx = c.ndcx, dy = c.ndcy;
      if (c.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(-dy, dx);
      const rx = this.w / 2 - 50, ry = this.h / 2 - 50;
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.textAlign = "center";
      ctx.fillText(label, x, y - 12);
    }
    ctx.restore();
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
    const cx = this.w / 2, cy = this.h / 2;
    const col = m.faction === "enemy" ? "#ff6b6b" : m.faction === "ally" ? "#7fd2ff" : "#cbd5e0";
    const km = (m.dist / 1000).toFixed(1);
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = "11px 'Consolas', monospace";
    if (m.onscreen && !m.behind) {
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.x, m.y - 12); ctx.lineTo(m.x, m.y - 7); ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(`${m.name}  ${km}km`, m.x, m.y - 18);
    } else {
      // off-screen / behind: arrow at the screen edge pointing toward it
      let dx = m.ndcx, dy = m.ndcy;
      if (m.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(-dy, dx);
      const rx = this.w / 2 - 64, ry = this.h / 2 - 64;
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.textAlign = "center";
      ctx.fillText(`${m.name}  ${km}km`, x, y - 14);
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
  objectiveList(list) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "12px 'Consolas', monospace";
    let y = 124;
    ctx.fillStyle = "#9fb3c4";
    ctx.fillText("OBJECTIVES", 20, y); y += 18;
    for (const o of list) {
      const done = o.state === "done", failed = o.state === "failed";
      const mark = done ? "✓" : failed ? "✗" : o.priority === "optional" ? "○" : o.priority === "secondary" ? "◆" : "●";
      ctx.fillStyle = done ? "#36ff9a" : failed ? "#ff5b5b" : o.priority === "optional" ? "#8fa0b0" : "#ffd23f";
      let label = `${mark} ${o.label}`;
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
    ctx.fillStyle = "#ffb030";
    ctx.strokeStyle = "#ffb030";
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
      let dx = o.ndcx, dy = o.ndcy;
      if (o.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(-dy, dx);
      const rx = this.w / 2 - 46, ry = this.h / 2 - 46;
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      ctx.translate(x, y); ctx.rotate(ang);
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
