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
    if (extra.mode === "mission") {
      ctx.fillText(`TARGETS LEFT ${extra.bandits}`, w - 20, 44);
      ctx.fillText(`DESTROYED ${extra.kills}/${extra.total}`, w - 20, 62);
    } else if (extra.kills != null && extra.mode !== "free") {
      ctx.fillText(`KILLS ${extra.kills}`, w - 20, 44);
      const label = extra.mode === "dogfight" ? "BANDITS" : "DRONES";
      ctx.fillText(`${label} ${extra.bandits}`, w - 20, 62);
    }
    ctx.textAlign = "left";

    // Hull health (combat modes) + missiles
    if ((extra.mode === "dogfight" || extra.mode === "mission" || extra.mode === "ffa") && extra.health != null) {
      this.healthBar(20, 58, extra.health);
    }
    if (extra.mode !== "free" && extra.missiles != null) {
      ctx.fillStyle = extra.missiles > 0 ? green : "#888";
      ctx.font = "13px 'Consolas', monospace";
      ctx.fillText(`MSL x${extra.missiles}`, 20, 92);
    }

    // Missile lock box around the locked target
    if (extra.lock) this.lockBox(extra.lock);

    // Mission objective marker (on-screen diamond or edge arrow).
    if (extra.objective) this.objective(extra.objective);

    // Nav markers pointing to the other islands.
    if (extra.islandMarkers) for (const m of extra.islandMarkers) this.islandMarker(m);

    // Multiplayer: connection status (top centre) + name/health tags on jets.
    if (extra.netStatus) {
      ctx.textAlign = "center";
      ctx.fillStyle = extra.netStatus.startsWith("LAN") ? "#36ff9a" : "#ffd23f";
      ctx.font = "12px 'Consolas', monospace";
      ctx.fillText("◈ " + extra.netStatus, cx, 74);
    }
    if (extra.netLabels) for (const m of extra.netLabels) this.netLabel(m);
  }

  netLabel(m) {
    const ctx = this.ctx;
    const cx = this.w / 2, cy = this.h / 2;
    const col = m.color || "#ff7a7a";
    const km = (m.dist / 1000).toFixed(1);
    ctx.save();
    ctx.font = "11px 'Consolas', monospace";
    if (m.onscreen && !m.behind) {
      // On screen: name + health bar floating over the jet.
      ctx.textAlign = "center";
      ctx.fillStyle = col;
      ctx.fillText(`${m.name}  ${km}km`, m.x, m.y - 10);
      const w = 46, h = 4, x = m.x - w / 2, y = m.y - 6;
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, w, h);
      const hp = Math.max(0, Math.min(100, m.health == null ? 100 : m.health)) / 100;
      ctx.fillStyle = hp > 0.5 ? "#36ff9a" : hp > 0.25 ? "#ffd23f" : "#ff5b5b";
      ctx.fillRect(x, y, w * hp, h);
    } else {
      // Off screen / behind: arrow at the screen edge pointing toward the pilot.
      let dx = m.ndcx, dy = m.ndcy;
      if (m.behind) { dx = -dx; dy = -dy; }
      const ang = Math.atan2(-dy, dx);
      const rx = this.w / 2 - 54, ry = this.h / 2 - 54;
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = col; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.textAlign = "center"; ctx.fillStyle = col;
      ctx.fillText(`${m.name}  ${km}km`, x, y - 13);
    }
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
    const s = 26;
    ctx.save();
    ctx.strokeStyle = "#ffd23f";
    ctx.fillStyle = "#ffd23f";
    ctx.lineWidth = 2;
    ctx.strokeRect(lock.x - s, lock.y - s, s * 2, s * 2);
    ctx.font = "11px 'Consolas', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`LOCK ${Math.round(lock.dist)}m`, lock.x, lock.y + s + 14);
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
