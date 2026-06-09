// Pure-canvas art for the briefing room — no image assets, same technique as
// markings.js. A stylized "Captain Dad" portrait and a top-down map preview.

// Draw a stern cartoon commander into a square 2D context of side S.
export function drawCaptainDad(ctx, S) {
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  // Background panel + vignette.
  const g = ctx.createRadialGradient(cx, S * 0.42, S * 0.1, cx, S * 0.5, S * 0.7);
  g.addColorStop(0, "#243240"); g.addColorStop(1, "#0e151d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

  // Shoulders / uniform.
  ctx.fillStyle = "#3a4a3a";
  ctx.beginPath();
  ctx.moveTo(S * 0.12, S);
  ctx.quadraticCurveTo(S * 0.5, S * 0.66, S * 0.88, S);
  ctx.closePath(); ctx.fill();
  // Collar tabs + a couple of rank pips.
  ctx.fillStyle = "#2c382c";
  ctx.beginPath(); ctx.moveTo(S * 0.30, S * 0.92); ctx.lineTo(S * 0.46, S * 0.80); ctx.lineTo(S * 0.40, S); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(S * 0.70, S * 0.92); ctx.lineTo(S * 0.54, S * 0.80); ctx.lineTo(S * 0.60, S); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffd23f";
  for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(S * (0.33 + i * 0.045), S * 0.9, S * 0.012, 0, Math.PI * 2); ctx.fill(); }

  // Head + jaw.
  const hy = S * 0.46, hr = S * 0.2;
  ctx.fillStyle = "#c98f6b";
  ctx.beginPath();
  ctx.moveTo(cx - hr, hy - hr * 0.4);
  ctx.lineTo(cx - hr, hy + hr * 0.5);
  ctx.quadraticCurveTo(cx - hr, hy + hr * 1.05, cx, hy + hr * 1.12); // jaw
  ctx.quadraticCurveTo(cx + hr, hy + hr * 1.05, cx + hr, hy + hr * 0.5);
  ctx.lineTo(cx + hr, hy - hr * 0.4);
  ctx.closePath(); ctx.fill();
  // Ears.
  ctx.beginPath(); ctx.arc(cx - hr, hy + hr * 0.2, hr * 0.16, 0, Math.PI * 2); ctx.arc(cx + hr, hy + hr * 0.2, hr * 0.16, 0, Math.PI * 2); ctx.fill();

  // Officer cap.
  ctx.fillStyle = "#222b22";
  ctx.beginPath();
  ctx.moveTo(cx - hr * 1.15, hy - hr * 0.18);
  ctx.quadraticCurveTo(cx, hy - hr * 1.5, cx + hr * 1.15, hy - hr * 0.18);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#161d16"; // brim
  ctx.fillRect(cx - hr * 1.25, hy - hr * 0.22, hr * 2.5, hr * 0.22);
  ctx.fillStyle = "#c9a23a"; // cap badge
  ctx.beginPath(); ctx.arc(cx, hy - hr * 0.62, hr * 0.13, 0, Math.PI * 2); ctx.fill();

  // Brow + frown (yelling).
  ctx.strokeStyle = "#6e4a36"; ctx.lineWidth = S * 0.018; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.7, hy - hr * 0.1); ctx.lineTo(cx - hr * 0.18, hy + hr * 0.02);
  ctx.moveTo(cx + hr * 0.7, hy - hr * 0.1); ctx.lineTo(cx + hr * 0.18, hy + hr * 0.02);
  ctx.stroke();
  // Eyes.
  ctx.fillStyle = "#20242a";
  ctx.beginPath(); ctx.arc(cx - hr * 0.42, hy + hr * 0.12, hr * 0.07, 0, Math.PI * 2); ctx.arc(cx + hr * 0.42, hy + hr * 0.12, hr * 0.07, 0, Math.PI * 2); ctx.fill();
  // Big bushy mustache.
  ctx.fillStyle = "#6e4a36";
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.55, hy + hr * 0.5);
  ctx.quadraticCurveTo(cx, hy + hr * 0.42, cx + hr * 0.55, hy + hr * 0.5);
  ctx.quadraticCurveTo(cx + hr * 0.2, hy + hr * 0.72, cx, hy + hr * 0.6);
  ctx.quadraticCurveTo(cx - hr * 0.2, hy + hr * 0.72, cx - hr * 0.55, hy + hr * 0.5);
  ctx.closePath(); ctx.fill();
  // Open mouth (mid-shout).
  ctx.fillStyle = "#3a1f1f";
  ctx.beginPath(); ctx.ellipse(cx, hy + hr * 0.78, hr * 0.18, hr * 0.12, 0, 0, Math.PI * 2); ctx.fill();
}

// Stylized top-down map preview of one island with target dots + waypoint
// diamonds + a spawn arrow, drawn into a square context of side S.
// island = { center:{x,z} }, targets/[waypoints] are arrays of {x,z}, in world
// coords; `extent` is the half-size (world units) the preview covers.
export function drawMapPreview(ctx, S, island, targets = [], waypoints = [], extent = 9000) {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = "#0b2230"; ctx.fillRect(0, 0, S, S); // ocean
  const cx = island && island.center ? island.center.x : 0;
  const cz = island && island.center ? island.center.z : 0;
  const toX = (wx) => ((wx - cx) / (2 * extent) + 0.5) * S;
  const toY = (wz) => ((wz - cz) / (2 * extent) + 0.5) * S;
  // Landmass blob.
  ctx.fillStyle = "#2c4a30";
  ctx.beginPath();
  const blobR = S * 0.34;
  for (let a = 0; a <= 32; a++) {
    const ang = (a / 32) * Math.PI * 2;
    const r = blobR * (0.82 + 0.18 * Math.sin(ang * 3 + 1.1) * Math.cos(ang * 2));
    const x = S / 2 + Math.cos(ang) * r, y = S / 2 + Math.sin(ang) * r;
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(120,150,170,0.25)"; ctx.lineWidth = 1; ctx.stroke();
  // Grid.
  ctx.strokeStyle = "rgba(120,150,170,0.10)";
  for (let i = 1; i < 6; i++) {
    const p = (i / 6) * S;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  // Targets (red dots).
  ctx.fillStyle = "#ff6b6b";
  for (const t of targets) { ctx.beginPath(); ctx.arc(toX(t.x), toY(t.z), 4, 0, Math.PI * 2); ctx.fill(); }
  // Waypoints (cyan diamonds).
  ctx.fillStyle = "#36c8ff";
  for (const w of waypoints) {
    const x = toX(w.x), y = toY(w.z), r = 5;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
  }
  // Spawn arrow (your start, lower centre, pointing up-field).
  ctx.fillStyle = "#36ff9a";
  const sx = S / 2, sy = S * 0.86;
  ctx.beginPath(); ctx.moveTo(sx, sy - 8); ctx.lineTo(sx - 6, sy + 6); ctx.lineTo(sx + 6, sy + 6); ctx.closePath(); ctx.fill();
}
