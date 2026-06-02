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
    if (extra.checkpoints != null) {
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
    if ((extra.mode === "dogfight" || extra.mode === "mission") && extra.health != null) {
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
