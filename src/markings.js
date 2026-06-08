import * as THREE from "three";

// Aircraft markings: national/squadron insignia and a tail/modex number, drawn
// to canvas textures and applied as small "sticker" decal planes on the body,
// wings and tail. Placement is derived from the airframe's bounding box (with
// rotor blades and afterburner flames excluded) so it works on every hand-built
// model without per-aircraft tuning. Textures and the unit plane are cached and
// shared across rebuilds.

const _box = new THREE.Box3();
const _tmp = new THREE.Box3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const PLANE = new THREE.PlaneGeometry(1, 1); // unit quad, normal +Z

// ---------------------------------------------------------------------------
// Canvas insignia art
// ---------------------------------------------------------------------------

export const INSIGNIA = [
  { id: "none",     name: "None",            kind: "—" },
  { id: "usaf",     name: "Star & Bar",      kind: "Military" },
  { id: "roundel",  name: "RAF Roundel",     kind: "Military" },
  { id: "tricolor", name: "Tricolore",       kind: "Military" },
  { id: "redstar",  name: "Red Star",        kind: "Military" },
  { id: "lowvis",   name: "Low-Vis Star",    kind: "Military" },
  { id: "skull",    name: "Jolly Roger",     kind: "Squadron" },
  { id: "spade",    name: "Ace of Spades",   kind: "Squadron" },
  { id: "checker",  name: "Racing Check",    kind: "Civil" },
];

function disc(ctx, x, y, r, color) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}
function starPath(ctx, cx, cy, ro, ri, pts = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 ? ri : ro, a = rot + (i * Math.PI) / pts;
    const fn = i === 0 ? "moveTo" : "lineTo";
    ctx[fn](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// Paint one insignia onto a transparent square canvas (size S).
function drawInsignia(ctx, id, S) {
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  ctx.clearRect(0, 0, S, S);
  ctx.lineJoin = "round";
  if (id === "usaf" || id === "lowvis") {
    const blue = id === "lowvis" ? "#3a4048" : "#16387a";
    const white = id === "lowvis" ? "#5b636c" : "#f2f4f6";
    const red = id === "lowvis" ? "#3a4048" : "#c8202e";
    // side bars
    ctx.fillStyle = white;
    const bw = R * 0.95, bh = R * 0.66;
    ctx.fillRect(cx - R - bw, cy - bh / 2, bw, bh);
    ctx.fillRect(cx + R, cy - bh / 2, bw, bh);
    ctx.fillStyle = red; const rh = bh * 0.34;
    ctx.fillRect(cx - R - bw, cy - rh / 2, bw, rh);
    ctx.fillRect(cx + R, cy - rh / 2, bw, rh);
    disc(ctx, cx, cy, R, blue);
    ctx.fillStyle = white; starPath(ctx, cx, cy, R * 0.78, R * 0.32, 5); ctx.fill();
  } else if (id === "roundel") {
    disc(ctx, cx, cy, R, "#1b3a8f"); disc(ctx, cx, cy, R * 0.66, "#f2f4f6"); disc(ctx, cx, cy, R * 0.32, "#c8202e");
  } else if (id === "tricolor") {
    disc(ctx, cx, cy, R, "#c8202e"); disc(ctx, cx, cy, R * 0.66, "#f2f4f6"); disc(ctx, cx, cy, R * 0.32, "#1b3a8f");
  } else if (id === "redstar") {
    ctx.fillStyle = "#cf1f24"; starPath(ctx, cx, cy, R, R * 0.42, 5); ctx.fill();
    ctx.lineWidth = S * 0.02; ctx.strokeStyle = "#f2d24a"; starPath(ctx, cx, cy, R, R * 0.42, 5); ctx.stroke();
  } else if (id === "skull") {
    disc(ctx, cx, cy - R * 0.08, R * 0.62, "#f2f4f6");          // cranium
    ctx.fillStyle = "#f2f4f6"; ctx.fillRect(cx - R * 0.34, cy + R * 0.3, R * 0.68, R * 0.34); // jaw
    ctx.fillStyle = "#15181c";
    disc(ctx, cx - R * 0.26, cy - R * 0.06, R * 0.18, "#15181c"); // eyes
    disc(ctx, cx + R * 0.26, cy - R * 0.06, R * 0.18, "#15181c");
    ctx.fillRect(cx - R * 0.06, cy + R * 0.1, R * 0.12, R * 0.16); // nose
    // crossbones
    ctx.strokeStyle = "#f2f4f6"; ctx.lineWidth = S * 0.07; ctx.lineCap = "round";
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * R * 1.1, cy + R * 0.7 - Math.sin(a) * R * 1.1);
      ctx.lineTo(cx + Math.cos(a) * R * 1.1, cy + R * 0.7 + Math.sin(a) * R * 1.1);
      ctx.stroke();
    }
  } else if (id === "spade") {
    disc(ctx, cx, cy, R, "#f2f4f6");
    ctx.fillStyle = "#15181c";
    // spade: two lobes + top triangle + stem
    const sp = R * 0.62;
    disc(ctx, cx - sp * 0.5, cy + sp * 0.1, sp * 0.55, "#15181c");
    disc(ctx, cx + sp * 0.5, cy + sp * 0.1, sp * 0.55, "#15181c");
    ctx.beginPath();
    ctx.moveTo(cx, cy - sp); ctx.lineTo(cx - sp, cy + sp * 0.4); ctx.lineTo(cx + sp, cy + sp * 0.4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); // stem
    ctx.moveTo(cx, cy + sp * 0.1); ctx.lineTo(cx - sp * 0.28, cy + sp); ctx.lineTo(cx + sp * 0.28, cy + sp); ctx.closePath(); ctx.fill();
  } else if (id === "checker") {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const n = 4, cell = (R * 2) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#15181c" : "#f2f4f6";
      ctx.fillRect(cx - R + i * cell, cy - R + j * cell, cell + 1, cell + 1);
    }
    ctx.restore();
  }
}

const _texCache = new Map();
function insigniaTex(id) {
  if (!id || id === "none") return null;
  if (_texCache.has(id)) return _texCache.get(id);
  const S = 128;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  drawInsignia(cv.getContext("2d"), id, S);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.needsUpdate = true;
  _texCache.set(id, t);
  return t;
}

// A data-URL thumbnail of an insignia, for the UI swatches.
const _urlCache = new Map();
export function insigniaDataURL(id) {
  if (!id || id === "none") return "";
  if (_urlCache.has(id)) return _urlCache.get(id);
  const S = 96;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  drawInsignia(cv.getContext("2d"), id, S);
  const url = cv.toDataURL();
  _urlCache.set(id, url);
  return url;
}

// Tail / modex number as white digits with a dark outline.
const _numCache = new Map();
function numberTex(n) {
  if (n == null || n < 0) return null;
  const key = "" + n;
  if (_numCache.has(key)) return _numCache.get(key);
  const W = 128, H = 96;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const s = n < 10 ? "0" + n : "" + n;
  ctx.font = "900 76px Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = 12; ctx.strokeStyle = "#15181c";
  ctx.strokeText(s, W / 2, H / 2 + 4);
  ctx.fillStyle = "#eef2f5"; ctx.fillText(s, W / 2, H / 2 + 4);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.needsUpdate = true;
  _numCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function decal(tex, w, h) {
  const m = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.scale.set(w, h, 1);
  m.renderOrder = 3;
  m.userData.decal = true;
  return m;
}

// Add insignia + number decals to a freshly built airframe group, sized and
// placed from its solid-body bounding box.
export function applyMarkings(group, def, opts) {
  const insTex = insigniaTex(opts && opts.insignia);
  const numTex = numberTex(opts ? opts.number : -1);
  if (!insTex && !numTex) return;

  // Bounding box of the solid body: skip rotor blades and afterburner flames.
  const skip = new Set();
  for (const r of group.userData.rotors || []) if (r.m) r.m.traverse((o) => skip.add(o));
  for (const f of group.userData.flames || []) skip.add(f);
  _box.makeEmpty();
  group.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.userData.decal) return;
    _tmp.setFromObject(o);
    if (!_tmp.isEmpty()) _box.union(_tmp);
  });
  if (_box.isEmpty()) return;

  _box.getCenter(_c); _box.getSize(_s);
  const spanX = _s.x, len = _s.z, midY = _c.y, rearZ = _box.max.z;
  const hasWings = spanX > 4.0;                       // fixed-wing vs heli/narrow body
  const bw = THREE.MathUtils.clamp(_s.y * 0.26, 0.42, 1.1); // est. body half-width

  if (insTex) {
    const fs = THREE.MathUtils.clamp(len * 0.12, 0.62, 1.3);  // fuselage roundel
    // Fuselage sides, near the forward third, facing ±X.
    for (const sx of [-1, 1]) {
      const d = decal(insTex, fs, fs);
      d.position.set(sx * (bw + 0.02), midY + 0.06, _c.z - len * 0.05);
      d.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(d);
    }
    if (hasWings) {
      const ws = THREE.MathUtils.clamp(spanX * 0.11, 0.7, 1.7); // upper-wing roundel
      for (const sx of [-1, 1]) {
        const d = decal(insTex, ws, ws);
        d.position.set(sx * spanX * 0.30, midY + 0.12, _c.z + len * 0.06);
        d.rotation.x = -Math.PI / 2;
        group.add(d);
      }
    }
  }

  if (numTex) {
    const h = THREE.MathUtils.clamp(len * 0.085, 0.45, 1.0), w = h * 1.3;
    // Both sides of the rear fuselage / tail, facing ±X.
    for (const sx of [-1, 1]) {
      const d = decal(numTex, w, h);
      d.position.set(sx * (bw + 0.02), midY + _s.y * 0.12, rearZ - len * 0.16);
      d.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(d);
    }
  }
}
