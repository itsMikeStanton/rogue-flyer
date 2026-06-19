import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

// Aircraft markings: national/squadron insignia and a tail/modex number, drawn
// to canvas textures and PROJECTED onto the airframe surface as decals (via
// DecalGeometry) so they conform to curved/angled panels instead of floating as
// flat stickers. Placement is derived from the airframe's bounding box (rotor
// blades and afterburner flames excluded) + a raycast to snap each decal onto
// the actual body surface, so it works on every hand-built model. Textures are
// cached and shared across rebuilds.

const _box = new THREE.Box3();
const _tmp = new THREE.Box3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

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
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
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
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  _numCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const _ray = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _au = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _size = new THREE.Vector3();
const _pos = new THREE.Vector3(), _nrm = new THREE.Vector3(), _up = new THREE.Vector3();

// Orientation whose +Z is the surface normal and +Y is `up` (in the tangent
// plane), so the decal texture maps upright across the XY face.
function basisEuler(normal, up) {
  _az.copy(normal).normalize();
  _ax.crossVectors(_au.copy(up).normalize(), _az);
  if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0); // up parallel to normal → fall back
  _ax.normalize();
  _ay.crossVectors(_az, _ax).normalize();
  _mat4.makeBasis(_ax, _ay, _az);
  return _eu.setFromRotationMatrix(_mat4);
}

// Project a decal texture onto the body surface near `pos`, along `normal`
// (outward). Raycasts from outside the body to snap onto the actual panel, then
// clips a DecalGeometry to it so the marking hugs curves/angles. `flipU` mirrors
// the texture horizontally (so digits read correctly on the opposite side).
function projectDecal(group, targets, tex, pos, normal, up, w, h, flipU) {
  _nrm.copy(normal).normalize();
  _origin.copy(pos).addScaledVector(_nrm, 6); // start well outside the body
  _dir.copy(_nrm).negate();                    // cast inward toward the surface
  _ray.set(_origin, _dir);
  const hits = _ray.intersectObjects(targets, false);
  if (!hits.length) return;
  const hit = hits[0];
  const orient = basisEuler(_nrm, up);
  // x,y = decal size; z = projection depth. Keep depth shallow so the box catches
  // only the near panel, not the far side of the fuselage (which would double it).
  _size.set(flipU ? -w : w, h, Math.max(w, h) * 0.5 + 0.7);
  const geo = new DecalGeometry(hit.object, hit.point, orient, _size);
  if (geo.getAttribute("position").count === 0) { geo.dispose(); return; } // nothing in the box
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false,
    roughness: 0.85, metalness: 0.08,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, // lift off the skin (no z-fight)
  }));
  m.userData.decal = true;
  m.renderOrder = 3;
  group.add(m);
}

// Add insignia + number decals to a freshly built airframe group, sized and
// placed from its solid-body bounding box, projected onto the actual surface.
export function applyMarkings(group, def, opts) {
  const insTex = insigniaTex(opts && opts.insignia);
  const numTex = numberTex(opts ? opts.number : -1);
  if (!insTex && !numTex) return;

  // Solid-body bounding box + the set of meshes we can project onto (skip rotor
  // blades, afterburner flames, and anything without normals).
  const skip = new Set();
  for (const r of group.userData.rotors || []) if (r.m) r.m.traverse((o) => skip.add(o));
  for (const f of group.userData.flames || []) skip.add(f);
  const targets = [];
  _box.makeEmpty();
  group.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.userData.decal) return;
    const g = o.geometry;
    if (!g || !g.attributes.position || !g.attributes.normal) return; // decal projection needs normals
    targets.push(o);
    _tmp.setFromObject(o);
    if (!_tmp.isEmpty()) _box.union(_tmp);
  });
  if (_box.isEmpty() || !targets.length) return;
  group.updateMatrixWorld(true); // raycast + projection read world matrices

  _box.getCenter(_c); _box.getSize(_s);
  const spanX = _s.x, len = _s.z, midY = _c.y, rearZ = _box.max.z;
  const hasWings = spanX > 4.0;                       // fixed-wing vs heli/narrow body
  const bw = THREE.MathUtils.clamp(_s.y * 0.26, 0.42, 1.1); // est. body half-width

  if (insTex) {
    const fs = THREE.MathUtils.clamp(len * 0.12, 0.62, 1.3);  // fuselage roundel
    for (const sx of [-1, 1]) { // fuselage sides, forward third, facing ±X
      projectDecal(group, targets, insTex,
        _pos.set(sx * bw, midY + 0.06, _c.z - len * 0.05),
        _nrm.set(sx, 0, 0), _up.set(0, 1, 0), fs, fs, false);
    }
    if (hasWings) {
      const ws = THREE.MathUtils.clamp(spanX * 0.11, 0.7, 1.7); // upper-wing roundel
      for (const sx of [-1, 1]) { // wing tops, facing +Y, texture top = forward
        projectDecal(group, targets, insTex,
          _pos.set(sx * spanX * 0.30, midY, _c.z + len * 0.06),
          _nrm.set(0, 1, 0), _up.set(0, 0, -1), ws, ws, false);
      }
    }
  }

  if (numTex) {
    const h = THREE.MathUtils.clamp(len * 0.085, 0.45, 1.0), w = h * 1.3;
    for (const sx of [-1, 1]) { // rear fuselage / tail sides, facing ±X
      projectDecal(group, targets, numTex,
        _pos.set(sx * bw, midY + _s.y * 0.12, rearZ - len * 0.16),
        _nrm.set(sx, 0, 0), _up.set(0, 1, 0), w, h, sx < 0); // flip on the left so digits aren't mirrored
    }
  }
}
