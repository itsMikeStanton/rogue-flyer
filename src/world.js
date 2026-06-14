import * as THREE from "three";
import { defaultWorldConfig } from "./worldConfig.js";

// Low-poly arcade world, driven by an editable config (see worldConfig.js).

const TERRAIN_SIZE = 24000;
const SEGMENTS = 360; // landmass mesh resolution (higher = finer hills/coast/river)

// Soft radial gradient used as an additive "light pool" cast on the ground
// under lamps — a cheap fake for thrown light (real lights are too many).
let _poolTex = null;
export function lightPoolTexture() {
  if (_poolTex) return _poolTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0.0, "rgba(255,255,255,1)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.45)");
  grd.addColorStop(1.0, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  _poolTex = new THREE.CanvasTexture(c);
  return _poolTex;
}
// A flat (XZ) disc geometry for ground pools (built once, instanced/cloned).
let _poolGeo = null;
function poolGeo() {
  if (!_poolGeo) { _poolGeo = new THREE.PlaneGeometry(2, 2); _poolGeo.rotateX(-Math.PI / 2); }
  return _poolGeo;
}

// Active world config: { seaLevel, islands:[ {center, faction, name, seed, terrain,
// cliff, river, spawn, carriers, settlements, bridges, roads, missionBases,
// forest, paint} ] }. Loaded from a localStorage override if present.
let CFG = migrate(defaultWorldConfig());
try {
  const saved = typeof localStorage !== "undefined" && localStorage.getItem("rogueflyer.world");
  if (saved) CFG = migrate(JSON.parse(saved));
} catch (_) { /* ignore */ }

// Wrap an old single-island config into the islands[] schema.
function migrate(cfg) {
  if (cfg && Array.isArray(cfg.islands)) return cfg;
  const c = cfg || {};
  return {
    seaLevel: c.seaLevel != null ? c.seaLevel : -180,
    islands: [{
      name: "Home", faction: "vanguard", seed: c.seed || 0x1f2e3d, center: { x: 0, z: 0 },
      terrain: c.terrain, cliff: c.cliff, river: c.river, spawn: c.spawn,
      carriers: c.carriers || [], settlements: c.settlements || [], bridges: c.bridges || [],
      roads: c.roads || [], missionBases: c.missionBases || [], forest: c.forest, paint: c.paint,
      landmarks: c.landmarks !== false, spire: !!c.spire,
    }],
  };
}

let activeIsland = 0; // which island the editor is currently editing
export function getActiveIsland() { return CFG.islands[activeIsland]; }
export function getActiveIslandIndex() { return activeIsland; }
// A fresh island (default terrain/props) at a given world center.
export function newIsland(center, name, faction) {
  const is = defaultWorldConfig().islands[0]; // fresh objects each call
  is.center = { x: center.x, z: center.z };
  is.name = name; is.faction = faction;
  is.seed = (Math.random() * 0xffffff) | 0;
  is.carriers = []; is.missionBases = [];
  is.forest.density = null; is.paint.cells = null;
  return is;
}
export function setActiveIsland(i) { activeIsland = Math.max(0, Math.min(CFG.islands.length - 1, i | 0)); }
export function setWorldConfig(cfg) { CFG = migrate(cfg); if (activeIsland >= CFG.islands.length) activeIsland = 0; }
export function getWorldConfig() { return CFG; }

// Faction config (registry + player faction + stances) for the active world,
// backfilled from defaults so worlds saved before factions existed still load.
export function getFactionConfig() {
  const def = defaultWorldConfig();
  return {
    factions: CFG.factions || def.factions,
    playerFaction: CFG.playerFaction || def.playerFaction,
    defaultStance: CFG.defaultStance || def.defaultStance,
    stances: CFG.stances || def.stances,
  };
}

// Carriers / mission targets flattened to WORLD coordinates across all islands.
export function getCarriers() {
  const out = [];
  for (const is of CFG.islands) for (const c of (is.carriers || [])) {
    out.push({ ...c, x: c.x + is.center.x, z: c.z + is.center.z, deckY: CFG.seaLevel + 24 });
  }
  return out;
}
// Mission-base world positions, each guaranteed to sit on land: if a base is
// authored over water (e.g. outside its island's actual shape), walk it back
// toward the island centre until it's ashore — otherwise its defences can't
// spawn and the island would auto-clear with no targets to destroy.
export function getMissionBases() {
  const out = [];
  for (const is of CFG.islands) for (const b of (is.missionBases || [])) {
    let wx = b[0] + is.center.x, wz = b[1] + is.center.z;
    for (let k = 0; k < 14 && terrainHeight(wx, wz) <= SEA_LEVEL + 6; k++) {
      wx = wx * 0.85 + is.center.x * 0.15; // step 15% toward the island centre
      wz = wz * 0.85 + is.center.z * 0.15;
    }
    out.push([wx, wz]);
  }
  return out;
}
// Per-island launch points in WORLD coordinates: the flattened home base
// ("runway") plus any carriers. Conquest mode treats these as the spawn nodes
// you launch from once an island is yours.
export function getIslandSpawns() {
  const out = [];
  for (const is of CFG.islands) {
    const sp = is.spawn || { x: 0, z: 520 };
    const spawns = [{ kind: "runway", name: is.name + " airfield", x: (sp.x || 0) + is.center.x, z: (sp.z || 0) + is.center.z }];
    for (const c of (is.carriers || [])) {
      if (c.team !== "ally") continue; // only the player's single carrier is a launch point (enemy carriers are targets, not bases)
      spawns.push({ kind: "carrier", name: "Carrier", team: c.team, x: c.x + is.center.x, z: c.z + is.center.z, halfL: c.halfL, halfW: c.halfW });
    }
    out.push({ name: is.name, faction: is.faction, center: { x: is.center.x, z: is.center.z }, outer: (is.terrain && is.terrain.islandOuter) || 9500, spawns });
  }
  return out;
}

// Paintable tree-cover grid (0..1) per island.
function defaultForestDensity(gridN, extent) {
  const a = new Array(gridN * gridN);
  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const x = (i / (gridN - 1) - 0.5) * 2 * extent;
      const z = (j / (gridN - 1) - 0.5) * 2 * extent;
      a[j * gridN + i] = THREE.MathUtils.clamp((smoothNoise(x * 0.0011, z * 0.0011) - 0.4) / 0.2, 0, 1);
    }
  }
  return a;
}
function forestDensityArr(is) {
  const f = is.forest;
  if (!f.density) f.density = defaultForestDensity(f.gridN, f.extent);
  return f.density;
}
export function getForestDensity() { return forestDensityArr(getActiveIsland()); }
// Forest cover (0..1) at a WORLD position — for the tactical map's tree overlay.
export function forestAt(wx, wz) {
  const is = nearestIsland(wx, wz);
  return forestDensityForLocal(is, wx - is.center.x, wz - is.center.z);
}
function forestDensityForLocal(is, x, z) {
  // Bilinear so the tree field (and its painted edges) are smooth, not blocky.
  const f = is.forest, g = f.gridN, e = f.extent, d = forestDensityArr(is);
  const fx = THREE.MathUtils.clamp((x / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const fz = THREE.MathUtils.clamp((z / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const i1 = Math.min(g - 1, i0 + 1), j1 = Math.min(g - 1, j0 + 1);
  const tx = fx - i0, tz = fz - j0;
  const a = d[j0 * g + i0], b = d[j0 * g + i1], cc = d[j1 * g + i0], dd = d[j1 * g + i1];
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(cc, dd, tx), tz);
}

// Forest species painted per density cell (0 Pine, 1 Oak, 2 Birch). Default is
// low-frequency noise so trees naturally cluster into single-species stands.
export const FOREST_TYPES = [
  { name: "Pine", color: 0x46604a },
  { name: "Oak", color: 0x5e7350 },
  { name: "Birch", color: 0x8a9461 },
];
function defaultForestTypes(is) {
  const f = is.forest, g = f.gridN, e = f.extent, a = new Array(g * g);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = (i / (g - 1) - 0.5) * 2 * e + is.center.x;
      const z = (j / (g - 1) - 0.5) * 2 * e + is.center.z;
      const t = smoothNoise(x * 0.00055, z * 0.00055);
      a[j * g + i] = t < 0.42 ? 0 : (t < 0.60 ? 2 : 1);
    }
  }
  return a;
}
function forestTypesArr(is) {
  const f = is.forest;
  if (!f.types) f.types = defaultForestTypes(is);
  return f.types;
}
export function getForestTypes() { return forestTypesArr(getActiveIsland()); }

// Paintable ground materials (index 0 = "auto", i.e. keep height-based colour).
export const PAINT_MATERIALS = [
  { name: "Auto", color: 0x000000 },
  { name: "Grass", color: 0x4a7a3c },
  { name: "Sand", color: 0xcdbd87 },
  { name: "Stone", color: 0x7c7d80 },
  { name: "Gravel", color: 0x9a9080 },
  { name: "Dirt", color: 0x6b5436 },
  { name: "Snow", color: 0xeef2f5 },
];
const PAINT_COLORS = PAINT_MATERIALS.map((m) => new THREE.Color(m.color));
export function getPaintGrid() {
  const p = getActiveIsland().paint;
  if (!p.cells) p.cells = new Array(p.gridN * p.gridN).fill(0);
  return p.cells;
}
const _pcA = new THREE.Color(), _pcB = new THREE.Color(), _pcOut = new THREE.Color();
function paintColorForLocal(is, x, z, base, out) {
  const p = is.paint;
  if (!p || !p.cells) { out.copy(base); return out; }
  const g = p.gridN, e = p.extent;
  const fx = THREE.MathUtils.clamp((x / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const fz = THREE.MathUtils.clamp((z / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const i1 = Math.min(g - 1, i0 + 1), j1 = Math.min(g - 1, j0 + 1);
  const tx = fx - i0, tz = fz - j0;
  const col = (ii, jj) => { const m = p.cells[jj * g + ii] || 0; return m === 0 ? base : PAINT_COLORS[m]; };
  _pcA.copy(col(i0, j0)).lerp(col(i1, j0), tx);
  _pcB.copy(col(i0, j1)).lerp(col(i1, j1), tx);
  out.copy(_pcA).lerp(_pcB, tz);
  return out;
}

// Cheap deterministic value-noise so terrain is repeatable run-to-run.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

// Small seeded PRNG so scattered props look the same run-to-run.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Winding river centerline (island-local): x as a function of local z.
function riverCenterXLocal(is, z) {
  const r = is.river;
  if (!r) return 0; // island has no river
  return r.a1 * Math.sin(z * r.f1) + r.a2 * Math.sin(z * r.f2 + r.phase);
}
// Editor convenience (operates on the active island, in its local coords).
export function riverCenterX(z) { return riverCenterXLocal(getActiveIsland(), z); }

// Per-island MACRO SHAPE. Returns { mask, add }: `mask` is the sea blend
// (0 = solid land .. 1 = open sea/deep floor) and `add` is a height bonus layered
// onto the land (ridges, peaks). With no `is.shape` this reproduces the original
// radial blob, so existing islands are untouched. The runway always sits on the
// flat hub at the local origin (see islandHeight), so every shape keeps the
// centre as land — even the atoll grows a little airstrip islet in its lagoon.
function shapeField(is, x, z, d) {
  const t = is.terrain;
  const ss = THREE.MathUtils.smoothstep;
  const s = is.shape;
  if (!s) return { mask: ss(d, t.islandInner, t.islandOuter), add: 0 };
  const ang = Math.atan2(z, x);

  if (s.type === "lobes") {
    // Starfish / medusa: the coastline radius swells and pinches with angle, so
    // the island grows N reaching arms with deep channels carved between them.
    const k = 1 + (s.amp ?? 0.42) * Math.cos((s.arms ?? 6) * ang + (s.phase ?? 0));
    return { mask: ss(d, t.islandInner * k, t.islandOuter * k), add: 0 };
  }
  if (s.type === "atoll") {
    // A reef ring: land only in a band around `ring`; open sea outside AND a
    // lagoon inside. The ring wobbles so the reef isn't a perfect O.
    const wob = 1 + 0.16 * Math.sin(ang * (s.wobble ?? 5) + 1.3);
    const R = (s.ring ?? t.islandInner * 0.78) * wob, W = s.width ?? 1500;
    const outerSea = ss(d, R + W, R + W + (s.ramp ?? 650));
    const lagoonSea = 1 - ss(d, R - W - (s.lagoon ?? 800), R - W);
    return { mask: Math.max(outerSea, lagoonSea), add: 0 };
  }
  if (s.type === "crescent") {
    // A C: a normal blob with a big circular bite taken out of one side, leaving
    // a sheltered horseshoe harbour.
    const base = ss(d, t.islandInner, t.islandOuter);
    const dB = Math.hypot(x - (s.biteX ?? 0), z - (s.biteZ ?? -6500));
    const bite = 1 - ss(dB, s.biteR ?? 5000, (s.biteR ?? 5000) + 350);
    return { mask: Math.max(base, bite), add: 0 };
  }
  if (s.type === "spiral") {
    // A maelstrom of stone: a ridge winding inward over the blob.
    const base = ss(d, t.islandInner, t.islandOuter);
    let add = 0;
    const R = s.spiralR ?? t.islandInner;
    if (d < R) {
      const phase = (ang / (Math.PI * 2)) * (s.turns ?? 2.6) + d / (s.pitch ?? 1500);
      const fr = phase - Math.floor(phase);
      const ridge = Math.exp(-((fr - 0.5) * (fr - 0.5)) / (2 * 0.15 * 0.15));
      add = ridge * (s.height ?? 800) * (1 - ss(d, R * 0.82, R)) * ss(d, R * 0.12, R * 0.3);
    }
    return { mask: base, add };
  }
  if (s.type === "ridges") {
    // Gaussian mountains set into a blob — twin peaks with a saddle between.
    const base = ss(d, t.islandInner, t.islandOuter);
    let add = 0;
    for (const p of (s.peaks || [])) {
      const dp = Math.hypot(x - p.x, z - p.z);
      add += p.h * Math.exp(-(dp * dp) / (2 * p.r * p.r));
    }
    return { mask: base, add };
  }
  if (s.type === "shatter") {
    // A shattered archipelago: scattered islets where a blobby noise crosses a
    // threshold, all fading to sea past the region edge — weave between them.
    const region = ss(d, s.regionInner ?? t.islandInner * 0.6, s.regionOuter ?? t.islandOuter);
    const wx = x + is.center.x, wz = z + is.center.z, sc = s.scale ?? 0.00085;
    const patch = smoothNoise(wx * sc, wz * sc) * 0.7 + smoothNoise(wx * sc * 2.3, wz * sc * 2.3) * 0.3;
    const land = THREE.MathUtils.clamp((patch - (s.thresh ?? 0.5)) * (s.sharp ?? 9), 0, 1);
    return { mask: Math.max(1 - land, region), add: 0 };
  }
  return { mask: ss(d, t.islandInner, t.islandOuter), add: 0 };
}

// Local height field for one island. x,z are island-LOCAL; the base fractal
// noise samples world coords (center-offset) so islands don't look identical.
function islandHeight(is, x, z) {
  const wx = x + is.center.x, wz = z + is.center.z;
  const f = 0.00035;
  let h = 0;
  h += smoothNoise(wx * f, wz * f) * 900;
  h += smoothNoise(wx * f * 3.1, wz * f * 3.1) * 260;
  h += smoothNoise(wx * f * 8.0, wz * f * 8.0) * 70;
  h -= 600;
  const d = Math.sqrt(x * x + z * z);
  const sf = shapeField(is, x, z, d);
  h = THREE.MathUtils.lerp(h, is.terrain.deep, sf.mask);
  h += sf.add;
  const cf = is.cliff;
  const cdist = Math.hypot(x - cf.x, z - cf.z);
  if (cdist < cf.r + 230) {
    const t = THREE.MathUtils.smoothstep(cdist, cf.r, cf.r + 230);
    h = THREE.MathUtils.lerp(cf.h, h, t);
  }
  if (d < is.spawn.flattenRadius) {
    const core = is.spawn.flatCore != null ? is.spawn.flatCore : 600; // fully-flat radius
    const ramp = is.spawn.flatRamp != null ? is.spawn.flatRamp : 800; // blend-out width
    const t = THREE.MathUtils.clamp((d - core) / ramp, 0, 1);
    h = THREE.MathUtils.lerp(0, h, t);
  }
  // (River removed — carve water inlets by hand with the height-sculpt tool.)
  h += sculptHeightAt(is, x, z); // editor-sculpted height offset
  return h;
}

// Pick the nearest island and sample its local height. Ocean between islands
// reads each island's deep floor, so it's flat sea everywhere outside the shores.
function nearestIsland(x, z) {
  let best = CFG.islands[0], bd = Infinity;
  for (const is of CFG.islands) {
    const dx = x - is.center.x, dz = z - is.center.z, dd = dx * dx + dz * dz;
    if (dd < bd) { bd = dd; best = is; }
  }
  return best;
}
export function terrainHeight(x, z) {
  const is = nearestIsland(x, z);
  return islandHeight(is, x - is.center.x, z - is.center.z);
}

// Sea surface (fixed).
export const SEA_LEVEL = defaultWorldConfig().seaLevel;

// Reposition a carrier to a WORLD position at runtime (e.g. follow the front in
// Conquest). Updates the config so getCarriers/collision/spawns all track it.
export function moveCarrier(team, wx, wz) {
  for (const is of CFG.islands) for (const c of (is.carriers || [])) {
    if (c.team === team) { c.x = wx - is.center.x; c.z = wz - is.center.z; return true; }
  }
  return false;
}

// Ground height including carrier decks — used for collision / takeoff.
export function groundHeightAt(x, z) {
  let g = terrainHeight(x, z);
  const deckY = CFG.seaLevel + 24;
  for (const c of getCarriers()) {
    if (Math.abs(x - c.x) < c.halfW && Math.abs(z - c.z) < c.halfL) g = Math.max(g, deckY);
  }
  return g;
}

function buildCarrier(parent, c) {
  const g = new THREE.Group();
  g.position.set(c.x, SEA_LEVEL, c.z);
  const ally = c.team === "ally";
  const hullMat = new THREE.MeshStandardMaterial({ color: ally ? 0x39424c : 0x35302e, flatShading: true, roughness: 0.85 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x44494f, flatShading: true, roughness: 0.95 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(c.halfW * 2, 44, c.halfL * 2), hullMat);
  hull.position.y = 2; // top at +24 (the deck)
  g.add(hull);
  // Tapered bow wedge.
  const bow = new THREE.Mesh(new THREE.ConeGeometry(c.halfW, 60, 4), hullMat);
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 0.5);
  bow.position.set(0, 2, -c.halfL - 12);
  g.add(bow);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(c.halfW * 2, 2, c.halfL * 2 - 6), deckMat);
  deck.position.y = 24; deck.receiveShadow = true;
  g.add(deck);

  // Island superstructure (starboard, forward) + mast.
  const island = new THREE.Mesh(new THREE.BoxGeometry(10, 30, 44), hullMat);
  island.position.set(c.halfW - 8, 39, -c.halfL * 0.4);
  g.add(island);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 18, 5), hullMat);
  mast.position.set(c.halfW - 8, 63, -c.halfL * 0.4);
  g.add(mast);

  // Deck markings (team colored).
  const paint = new THREE.MeshStandardMaterial({ color: ally ? 0xeef0f2 : 0xd24b4b, roughness: 0.7 });
  for (let z = -c.halfL + 34; z <= c.halfL - 34; z += 42) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 20), paint);
    m.rotation.x = -Math.PI / 2; m.position.set(0, 25.2, z);
    g.add(m);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 1.8, 6, 22), paint);
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 25.3, 0);
  g.add(ring);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  parent.add(g);
  return g;
}

// Water material with a gentle GPU vertex-wave animation (drive uTime each frame).
function waveMaterial(color, opacity) {
  // Matte water. Detail comes from procedural fbm noise in the fragment shader
  // (so it's crisp regardless of mesh resolution): subtle colour mottling plus
  // lighter foam on the wave crests. The vertices ripple with a few sines.
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.65, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    let vs = "uniform float uTime;\nvarying float vWave;\nvarying vec2 vWorld;\n" + shader.vertexShader;
    vs = vs.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
  // Waves are computed in WORLD space so a camera-following ocean plane stays
  // put (no swimming), and the directions are off-axis/incommensurate so the
  // surface reads as rolling swell rather than a diamond grid.
  vec2 wxz = (modelMatrix * vec4(transformed, 1.0)).xz;
  float wv = sin(dot(wxz, vec2(0.0042, 0.0011)) + uTime * 1.00) * 2.6
           + sin(dot(wxz, vec2(-0.0017, 0.0039)) + uTime * 0.83) * 2.2
           + sin(dot(wxz, vec2(0.0026, -0.0022)) - uTime * 0.60) * 1.7
           + sin(dot(wxz, vec2(0.0009, 0.0014)) + uTime * 0.40) * 1.2;
  transformed.y += wv;
  vWave = clamp((wv + 7.0) / 14.0, 0.0, 1.0);
  vWorld = wxz;`
    );
    shader.vertexShader = vs;
    const helpers = `
varying float vWave;
varying vec2 vWorld;
uniform float uTime;
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
             mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float wFbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++){ v += a * wNoise(p); p *= 2.0; a *= 0.5; } return v; }
`;
    let fs = helpers + shader.fragmentShader;
    fs = fs.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
  float n  = wFbm(vWorld * 0.0016 + vec2(uTime * 0.02, uTime * 0.015));
  float nc = wFbm(vWorld * 0.0008 + vec2(11.0, 4.0) + vec2(uTime * 0.006, 0.0));
  float n2 = wFbm(vWorld * 0.012  - vec2(uTime * 0.05, 0.0));
  float n3 = wFbm(vWorld * 0.045  + vec2(uTime * 0.08, -uTime * 0.06));
  diffuseColor.rgb *= 0.82 + n * 0.34;
  // colour variety: drift between teal and deeper-blue zones
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.80, 1.08, 1.05), smoothstep(0.45, 0.75, nc));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.84, 1.18), smoothstep(0.45, 0.18, nc));
  // foam: crests plus fine speckle spots
  float foam = smoothstep(0.58, 0.90, vWave * 0.5 + n2 * 0.6);
  foam += smoothstep(0.86, 1.0, n3) * 0.7;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.97), clamp(foam, 0.0, 1.0) * 0.6);`
    );
    shader.fragmentShader = fs;
    mat.userData.shader = shader;
  };
  return mat;
}

// Procedural window textures for buildings: bigger, more widely-spaced glass
// with faint concrete floor bands (reads as a cement curtain wall, not brick),
// plus a matching emissive map where some windows are "lit".
function makeWindowTextures() {
  const N = 64;
  const wall = document.createElement("canvas"); wall.width = wall.height = N;
  const emis = document.createElement("canvas"); emis.width = emis.height = N;
  const gw = wall.getContext("2d"), ge = emis.getContext("2d");
  gw.fillStyle = "#ffffff"; gw.fillRect(0, 0, N, N); // white wall (tinted by instanceColor)
  ge.fillStyle = "#000000"; ge.fillRect(0, 0, N, N);
  // Faint horizontal floor lines + a couple of vertical pier lines = concrete.
  gw.fillStyle = "rgba(40,44,50,0.12)";
  for (let y = 0; y < N; y += 16) gw.fillRect(0, y, N, 1);
  for (let x = 0; x < N; x += 32) gw.fillRect(x, 0, 1, N);
  // Fewer, larger window panes with generous cement between them.
  for (let y = 6; y < N - 10; y += 16) {
    for (let x = 6; x < N - 10; x += 16) {
      gw.fillStyle = Math.random() < 0.5 ? "#39434f" : "#2c3641";
      gw.fillRect(x, y, 9, 11);
      if (Math.random() < 0.22) { ge.fillStyle = "#ffcf86"; ge.fillRect(x, y, 9, 11); }
    }
  }
  const t = new THREE.CanvasTexture(wall);
  const e = new THREE.CanvasTexture(emis);
  t.colorSpace = THREE.SRGBColorSpace;
  e.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = e.wrapS = e.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1); e.repeat.set(1, 1); // identical -> shared UV; tiling is set per-instance in the shader
  return { map: t, emissiveMap: e };
}

export function buildWorld(scene) {
  const waveMats = [];
  // Sky + fog
  scene.background = new THREE.Color(0x8fc4e8);
  scene.fog = new THREE.Fog(0x9fcbe6, 6000, 20000);

  const hemi = new THREE.HemisphereLight(0xcfeaff, 0x4a5a3a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
  sun.position.set(-4000, 6000, 3000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 16000;
  const sc = sun.shadow.camera;
  sc.left = -3000; sc.right = 3000; sc.top = 3000; sc.bottom = -3000;
  scene.add(sun);

  // Far ocean (global): a vast opaque plane so the water edge is never visible.
  const farSea = new THREE.Mesh(
    new THREE.PlaneGeometry(400000, 400000, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x21506e, roughness: 0.7, metalness: 0.0 })
  );
  farSea.rotation.x = -Math.PI / 2;
  // Sit the backdrop well below the detailed ocean. The wave plane (within ~28km
  // of the camera) is opaque and always drawn over it; a big vertical gap keeps
  // the two from z-fighting at distance (the cause of the ocean shimmer). The
  // far sea is only ever seen past the fog, so its exact depth is invisible.
  farSea.position.y = SEA_LEVEL - 400;
  scene.add(farSea);

  // Detailed wave ocean (global): one plane that follows the camera each frame
  // (main.js). Waves are world-anchored in the shader, so it never swims, and a
  // single system means water exists everywhere, not just around islands.
  const oceanGeo = new THREE.PlaneGeometry(56000, 56000, 256, 256);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMat = waveMaterial(0x21506e, 1.0);
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.position.y = SEA_LEVEL;
  ocean.renderOrder = -1; // draw before land props that sit at the shoreline
  scene.add(ocean);
  waveMats.push(oceanMat);

  // Carriers (global, world coordinates across all islands).
  const carriers = {};
  for (const c of getCarriers()) carriers[c.team] = buildCarrier(scene, c);

  // Build each island into its own group at its world offset.
  const colliders = [];
  const islands = [];
  const smokeSources = [];
  const trees = []; // subsample of tree handles, for igniting + removing trees near blasts
  const spinners = []; // scenery to rotate each frame (lighthouse beacons)
  let firstTerrain = null;
  for (const is of CFG.islands) {
    const built = buildIsland(scene, is, waveMats, colliders, smokeSources, trees, spinners);
    if (!firstTerrain) firstTerrain = built.terrain;
    islands.push({ group: built.group, center: is.center, name: is.name, faction: is.faction, terrain: built.terrain });
  }

  // Clouds (global): a large tiled field of big, billowy cumulus that follows
  // the camera each frame (main.js) by snapping to CLOUD_TILE. Because the tile
  // (80km) dwarfs the fog distance, the snap is never visible — clouds simply
  // exist everywhere. Much larger puffs than before.
  const clouds = buildClouds(scene);

  const rings = [];
  return { terrain: firstTerrain, rings, sun, hemi, clouds, ocean, carriers, colliders, waveMats, islands, smokeSources, trees, spinners };
}

// One big tiled cumulus field. Returned mesh carries userData.tile so main can
// snap it to the camera (the tile dwarfs fog distance, so the wrap is unseen).
const CLOUD_TILE = 80000;
function buildClouds(scene) {
  const rnd = mulberry32(0xc10da5);
  const m4 = new THREE.Matrix4(), noRot = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3();
  const MAX = 1100;
  // Per-instance opacity (varied haze) via a tiny shader injection on top of a
  // standard material — InstancedMesh can't vary material.opacity otherwise.
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 1.0, roughness: 1, emissive: 0x6b7fa6, emissiveIntensity: 0.16 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = "attribute float aAlpha;\nvarying float vAlpha;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vAlpha = aAlpha;");
    sh.fragmentShader = "varying float vAlpha;\n" +
      sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.a *= vAlpha;");
  };
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, MAX);
  const alphas = new Float32Array(MAX);
  clouds.castShadow = false;
  clouds.frustumCulled = false; // it's recentred on the camera every frame
  let n = 0;
  const clusters = 130;
  for (let cc = 0; cc < clusters && n < MAX; cc++) {
    const cx = (rnd() - 0.5) * CLOUD_TILE;
    const cz = (rnd() - 0.5) * CLOUD_TILE;
    const cy = 3400 + rnd() * 13800;          // ~3.4km up to ~17km, layered
    const big = 1 + Math.pow(rnd(), 1.7) * 5; // mostly modest, a few up to 6x
    const a = 0.48 + rnd() * 0.47;            // per-cloud opacity: ~half..full
    const puffs = 5 + Math.floor(rnd() * 6);
    for (let p = 0; p < puffs && n < MAX; p++) {
      tp.set(cx + (rnd() - 0.5) * 620 * big, cy + (rnd() - 0.5) * 130 * big, cz + (rnd() - 0.5) * 620 * big);
      ts.set((180 + rnd() * 260) * big, (90 + rnd() * 120) * big, (180 + rnd() * 260) * big);
      clouds.setMatrixAt(n, m4.compose(tp, noRot, ts));
      alphas[n] = a;
      n++;
    }
  }
  clouds.count = n;
  clouds.geometry.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));
  clouds.instanceMatrix.needsUpdate = true;
  clouds.userData.tile = CLOUD_TILE;
  scene.add(clouds);
  return clouds;
}

// Build one island into a group positioned at its world centre. All internal
// geometry is in island-LOCAL coordinates; H/RC sample this island's local
// fields. Colliders are pushed in WORLD coordinates for flight collision.
// A thin box strut between two points (for lattice towers).
function strut(a, b, thick, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.001;
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// Red-and-white striped coastal lighthouse (see reference image). ~170 tall.
function buildLighthouse() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f3f0, flatShading: true, roughness: 0.85 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd23b2e, flatShading: true, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, flatShading: true, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, emissive: 0x223038, metalness: 0.2, roughness: 0.25 });
  const redLight = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2a20, emissiveIntensity: 1.6, roughness: 0.5 });

  const baseH = 26, baseR = 28;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 0.92, baseR, baseH, 18), white);
  base.position.y = baseH / 2; g.add(base);

  // Tapered tower, alternating red/white bands.
  const towerH = 92, segs = 7, botR = 21, topR = 14;
  let y = baseH;
  for (let i = 0; i < segs; i++) {
    const r0 = THREE.MathUtils.lerp(botR, topR, i / segs);
    const r1 = THREE.MathUtils.lerp(botR, topR, (i + 1) / segs);
    const h = towerH / segs;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h + 0.4, 18), i % 2 ? white : red);
    seg.position.y = y + h / 2; g.add(seg);
    y += h;
  }

  // Gallery platform + railing.
  const gallR = topR + 6;
  const gall = new THREE.Mesh(new THREE.CylinderGeometry(gallR, gallR, 4, 18), white);
  gall.position.y = y + 2; g.add(gall);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6, 0.7), dark);
    post.position.set(Math.cos(a) * (gallR - 1), y + 7, Math.sin(a) * (gallR - 1)); g.add(post);
  }
  const rail = new THREE.Mesh(new THREE.TorusGeometry(gallR - 1, 0.5, 6, 20), dark);
  rail.rotation.x = Math.PI / 2; rail.position.y = y + 10; g.add(rail);

  // Lantern room (glass) with vertical frame bars + black dome.
  const lantR = topR - 1, lantH = 22, ly = y + 4;
  const lant = new THREE.Mesh(new THREE.CylinderGeometry(lantR, lantR, lantH, 12), glass);
  lant.position.y = ly + lantH / 2; g.add(lant);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, lantH, 0.6), dark);
    bar.position.set(Math.cos(a) * lantR, ly + lantH / 2, Math.sin(a) * lantR); g.add(bar);
  }
  const dome = new THREE.Mesh(new THREE.ConeGeometry(lantR + 2.5, 16, 12), dark);
  dome.position.y = ly + lantH + 8; g.add(dome);
  // Red aircraft-warning light on the very top (brighter so it blooms at night).
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2a20, emissiveIntensity: 3.6, roughness: 0.5 });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), tipMat);
  tip.position.y = ly + lantH + 18; g.add(tip);

  // Lantern lamp + spinning beacon. The bright core sits in the glass room; two
  // opposing additive beams sweep round as main.js rotates `userData.beacon`.
  const lampY = ly + lantH / 2;
  const core = new THREE.Mesh(new THREE.SphereGeometry(lantR * 0.5, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xfff0c0, emissiveIntensity: 4.4, roughness: 0.3 }));
  core.position.y = lampY; g.add(core);
  // Long, wispy beam: a hollow cone that's faint, fades along its length and
  // softens at the tip, so it reads as a searchlight shaft rather than a solid
  // cone. Alpha falls off from the lamp (apex) toward the far end.
  const BEAM_LEN = 420;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xfff0c0) }, uOpacity: { value: 0.085 }, uLen: { value: BEAM_LEN } },
    vertexShader: "varying float vT; uniform float uLen; void main(){ vT = clamp(-position.y / uLen, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying float vT; uniform vec3 uColor; uniform float uOpacity; void main(){ float a = uOpacity * smoothstep(0.0, 0.04, vT) * pow(1.0 - vT, 1.8); gl_FragColor = vec4(uColor, a); }",
  });
  const makeBeam = () => {
    const cone = new THREE.ConeGeometry(24, BEAM_LEN, 16, 1, true); // a little wider
    cone.translate(0, -BEAM_LEN / 2, 0); // apex at the lamp, base out along -Y
    const m = new THREE.Mesh(cone, beamMat);
    m.rotation.z = Math.PI / 2;          // lay it flat: base points +X
    return m;
  };
  // Each beam gets its own real spotlight (soft edge, long throw) so both shafts
  // actually light the terrain/fog as the beacon sweeps.
  const makeSpot = (parent) => {
    const s = new THREE.SpotLight(0xfff0c0, 2.8, 8000, 0.15, 0.95, 0); // soft edge, far throw, no falloff
    s.castShadow = false;
    const tgt = new THREE.Object3D(); tgt.position.set(120, -22, 0); // out +X, raked down
    parent.add(s); parent.add(tgt); s.target = tgt;
  };
  const beacon = new THREE.Group();
  beacon.position.y = lampY;
  beacon.add(makeBeam()); makeSpot(beacon);
  const wrap = new THREE.Group(); wrap.rotation.y = Math.PI; wrap.add(makeBeam()); makeSpot(wrap); beacon.add(wrap); // opposite beam + its light
  g.add(beacon);
  g.userData.beacon = beacon;

  g.traverse((o) => { if (o.isMesh && o.material !== beamMat) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Steel lattice radio / watch tower with a glassed cab + antenna masts (see
// reference image). ~150 lattice + ~50 masts.
function buildRadioTower() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b8f93, flatShading: true, metalness: 0.5, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f45, flatShading: true });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x70757a, flatShading: true, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2329, emissive: 0x0a141a, metalness: 0.3, roughness: 0.3 });
  const redLight = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2a20, emissiveIntensity: 1.8, roughness: 0.5 });

  const H = 150, botHalf = 22, topHalf = 9, levels = 6, leg = 1.6;
  const corner = (sx, sz, t) => {
    const half = THREE.MathUtils.lerp(botHalf, topHalf, t);
    return new THREE.Vector3(sx * half, t * H, sz * half);
  };
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  // Legs.
  for (const [sx, sz] of signs) g.add(strut(corner(sx, sz, 0), corner(sx, sz, 1), leg, steel));
  // Horizontal rings + face X-braces.
  for (let i = 0; i <= levels; i++) {
    const t = i / levels;
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = signs[c], [nx, nz] = signs[(c + 1) % 4];
      g.add(strut(corner(sx, sz, t), corner(nx, nz, t), leg * 0.7, steel)); // ring beam
      if (i < levels) {
        const t2 = (i + 1) / levels;
        g.add(strut(corner(sx, sz, t), corner(nx, nz, t2), 1.0, steel));    // X brace
        g.add(strut(corner(nx, nz, t), corner(sx, sz, t2), 1.0, steel));
      }
    }
  }
  // Cab (control room) with windows + roof platform.
  const cw = topHalf * 2 + 9;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(cw, 13, cw), cabMat);
  cab.position.y = H + 6.5; g.add(cab);
  const win = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.4, 6, cw + 0.4), glass);
  win.position.y = H + 8; g.add(win);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(cw + 5, 2, cw + 5), dark);
  roof.position.y = H + 13.5; g.add(roof);
  const railT = new THREE.Mesh(new THREE.TorusGeometry((cw + 5) * 0.5, 0.5, 6, 4), dark);
  railT.rotation.x = Math.PI / 2; railT.rotation.z = Math.PI / 4; railT.position.y = H + 16; g.add(railT);
  // Antenna masts + red beacons.
  for (const mx of [-7, 7]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 42, 6), steel);
    mast.position.set(mx, H + 14 + 21, 2); g.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), redLight);
    beacon.position.set(mx, H + 14 + 44, 2); g.add(beacon);
  }
  // A dish on the side.
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1.4, 14), dark);
  dish.rotation.z = Math.PI / 2; dish.rotation.y = 0.4; dish.position.set(cw * 0.5 + 2, H + 6, 0); g.add(dish);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A glowing tapered obelisk monument: stacked frustums of dark stone banded
// with emissive cyan light, a glowing crystalline apex, and a base ring of
// light pylons (returned as userData.ring so it can be spun).
function buildSpire() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x2a3038, flatShading: true, metalness: 0.4, roughness: 0.6 });
  const band = new THREE.MeshStandardMaterial({ color: 0x39e6ff, emissive: 0x18c4e6, emissiveIntensity: 3.2, roughness: 0.4 });
  const apexMat = new THREE.MeshStandardMaterial({ color: 0x8af6ff, emissive: 0x4fe3ff, emissiveIntensity: 4.0, roughness: 0.3 });

  // Shaft: tapering stacked frustums with glowing seams between segments.
  const segs = 7, total = 150, botR = 13, topR = 2.4;
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const r0 = THREE.MathUtils.lerp(botR, topR, t0), r1 = THREE.MathUtils.lerp(botR, topR, t1);
    const segH = total / segs;
    const sm = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, segH, 6), stone);
    sm.position.y = y + segH / 2; sm.castShadow = true; g.add(sm);
    // Glowing band ring at each seam.
    const br = (r0 + r1) * 0.5 + 0.6;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(br, br, 2.4, 6), band);
    ring.position.y = y + segH; g.add(ring);
    y += segH;
  }
  // Crystalline glowing apex.
  const apex = new THREE.Mesh(new THREE.OctahedronGeometry(7, 0), apexMat);
  apex.position.y = total + 6; apex.castShadow = true; g.add(apex);

  // Base ring of light pylons (spun each frame).
  const ring = new THREE.Group();
  const pylon = new THREE.MeshStandardMaterial({ color: 0x39e6ff, emissive: 0x18c4e6, emissiveIntensity: 2.6, roughness: 0.4 });
  const pdark = new THREE.MeshStandardMaterial({ color: 0x23282e, flatShading: true, roughness: 0.7 });
  const N = 8, rr = 26;
  for (let a = 0; a < N; a++) {
    const ang = (a / N) * Math.PI * 2;
    const px = Math.cos(ang) * rr, pz = Math.sin(ang) * rr;
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), pdark);
    base.position.set(px, 2, pz); base.castShadow = true; ring.add(base);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 16, 5), pylon);
    light.position.set(px, 12, pz); ring.add(light);
  }
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

// ---- Editable height-sculpt grid (added on top of the base terrain) ----
const SAND = new THREE.Color(0xcdbd87), LOW = new THREE.Color(0x3f6b3a), MID = new THREE.Color(0x6f7d4a);
const HIGH = new THREE.Color(0x9a9a8e), SNOW = new THREE.Color(0xeef2f5);
function sculptCfg(is) {
  if (!is.heightmap) is.heightmap = { gridN: 128, extent: 12000, cells: null };
  return is.heightmap;
}
export function getSculptGrid() {
  const s = sculptCfg(getActiveIsland());
  if (!s.cells) s.cells = new Array(s.gridN * s.gridN).fill(0);
  return s;
}
function sculptHeightAt(is, x, z) {
  const s = is.heightmap;
  if (!s || !s.cells) return 0;
  const g = s.gridN, e = s.extent;
  const fx = THREE.MathUtils.clamp((x / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const fz = THREE.MathUtils.clamp((z / (2 * e) + 0.5) * (g - 1), 0, g - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fz), i1 = Math.min(g - 1, i0 + 1), j1 = Math.min(g - 1, j0 + 1);
  const tx = fx - i0, tz = fz - j0;
  const a = s.cells[j0 * g + i0] || 0, b = s.cells[j0 * g + i1] || 0, cc = s.cells[j1 * g + i0] || 0, dd = s.cells[j1 * g + i1] || 0;
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(cc, dd, tx), tz);
}
// Terrain vertex colour (shared by the full build and the live sculpt update).
function terrainColorAt(is, x, z, h, cx0, cz0, out) {
  if (h < 45) { const s = THREE.MathUtils.clamp((h + 12) / 57, 0, 1); out.copy(SAND).lerp(LOW, s); }
  else {
    const t = THREE.MathUtils.clamp((h + 200) / 1400, 0, 1);
    if (t < 0.45) out.copy(LOW).lerp(MID, t / 0.45);
    else if (t < 0.8) out.copy(MID).lerp(HIGH, (t - 0.45) / 0.35);
    else out.copy(HIGH).lerp(SNOW, (t - 0.8) / 0.2);
  }
  paintColorForLocal(is, x, z, out, _pcOut); out.copy(_pcOut);
  const j = (hash2((x + cx0) * 0.05, (z + cz0) * 0.05) - 0.5) * 0.06;
  out.setRGB(THREE.MathUtils.clamp(out.r + j, 0, 1), THREE.MathUtils.clamp(out.g + j, 0, 1), THREE.MathUtils.clamp(out.b + j, 0, 1));
  return out;
}
const _scCol = new THREE.Color();
// Live-update a terrain mesh's heights + colours within `radius` of a local
// point — used by the editor's sculpt brush for real-time terrain editing.
// (The material is flat-shaded, so normals come from derivatives — no recompute.)
export function resculptTerrain(is, terrainMesh, lx, lz, radius) {
  const geo = terrainMesh.geometry, pos = geo.attributes.position, col = geo.attributes.color;
  const cx0 = is.center.x, cz0 = is.center.z;
  const margin = (2 * 12000) / 127 + 30;
  const r2 = (radius + margin) * (radius + margin);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dx = x - lx, dz = z - lz;
    if (dx * dx + dz * dz > r2) continue;
    const h = islandHeight(is, x, z);
    pos.setY(i, h);
    terrainColorAt(is, x, z, h, cx0, cz0, _scCol);
    col.setXYZ(i, _scCol.r, _scCol.g, _scCol.b);
  }
  pos.needsUpdate = true; col.needsUpdate = true;
}

// A portal/gantry crane: four legs, a top frame, and a long boom cantilevering
// toward +X (orient the group so +X points out over the water).
function buildCrane() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcf5a3a, flatShading: true, roughness: 0.7, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f45, flatShading: true, roughness: 0.8 });
  const legH = 54;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, legH, 2.4), mat);
    leg.position.set(sx * 13, legH / 2, sz * 9); leg.castShadow = true; g.add(leg);
  }
  for (const sz of [-1, 1]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(28, 3, 3), mat); beam.position.set(0, legH, sz * 9); g.add(beam); }
  const boom = new THREE.Mesh(new THREE.BoxGeometry(68, 3, 4.5), mat); boom.position.set(20, legH + 6, 0); boom.castShadow = true; g.add(boom);
  const cj = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 4.5), mat); cj.position.set(-18, legH + 6, 0); g.add(cj);
  const apex = new THREE.Mesh(new THREE.BoxGeometry(2.5, 16, 2.5), mat); apex.position.set(0, legH + 13, 0); g.add(apex);
  const spreader = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 9), dark); spreader.position.set(38, legH - 4, 0); g.add(spreader);
  return g;
}

// A sports stadium: an open elliptical bowl of stands around a green pitch.
function buildStadium() {
  const g = new THREE.Group();
  const stands = new THREE.Mesh(new THREE.CylinderGeometry(64, 80, 30, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc2c6c9, flatShading: true, roughness: 0.85, side: THREE.DoubleSide }));
  stands.position.y = 15; stands.castShadow = true; g.add(stands);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(80, 3, 6, 28), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, flatShading: true, roughness: 0.8 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 30; g.add(rim);
  const pitch = new THREE.Mesh(new THREE.CircleGeometry(58, 32), new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 1; g.add(pitch);
  g.scale.set(1.18, 1, 0.86); // oval
  return g;
}

// A stone cathedral: a barrel-vaulted nave, a transept, and a bell tower + spire.
function buildCathedral() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xcabfa0, flatShading: true, roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x6a5a48, flatShading: true, roughness: 0.85 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(22, 26, 62), stone); nave.position.y = 13; nave.castShadow = true; g.add(nave);
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 62, 12, 1, false, 0, Math.PI), roof);
  vault.rotation.z = Math.PI / 2; vault.rotation.y = Math.PI / 2; vault.position.y = 26; g.add(vault);
  const transept = new THREE.Mesh(new THREE.BoxGeometry(48, 24, 18), stone); transept.position.set(0, 12, -12); transept.castShadow = true; g.add(transept);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 56, 14), stone); tower.position.set(0, 28, 30); tower.castShadow = true; g.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(10, 30, 4), roof); spire.position.set(0, 71, 30); g.add(spire);
  return g;
}

// A wind turbine: tapered tower, nacelle, and a 3-blade rotor that spins about
// its (horizontal) shaft. Returns { group, rotor } so the rotor can be handed to
// the spinner system. Faces +Z; yaw the group to orient into the "wind".
function buildWindTurbine() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f3, flatShading: true, roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, flatShading: true, roughness: 0.7 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.0, 84, 10), white);
  tower.position.y = 42; tower.castShadow = true; g.add(tower);
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.5, 12), dark);
  nacelle.position.set(0, 85, 1.5); g.add(nacelle);
  // Rotor: hub on the +Z shaft, three blades radiating in the local XY plane so
  // it sweeps a vertical disc; spun about local Z by the spinner system.
  const rotor = new THREE.Group();
  rotor.position.set(0, 85, 8);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10), white);
  hub.rotation.x = Math.PI / 2; rotor.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 38, 0.6), white);
    blade.position.y = 19; blade.geometry.translate(0, 0, 0);
    const arm = new THREE.Group(); arm.add(blade); arm.rotation.z = (i / 3) * Math.PI * 2;
    rotor.add(arm);
  }
  g.add(rotor);
  return { group: g, rotor };
}

// A low-poly power plant: turbine hall, annex, a waisted cooling tower and two
// banded smokestacks. Returns the group plus the local positions/params of its
// smoke sources (cooling-tower vapour + dark stack exhaust) for the smoke system.
export function buildPowerPlant() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x868d94, flatShading: true, roughness: 0.92 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x4f555c, flatShading: true, roughness: 0.92 });
  const band = new THREE.MeshStandardMaterial({ color: 0xb1452f, flatShading: true, roughness: 0.85 });
  const stacks = [];

  // ~3x the previous size; smokestacks taller still. Big, billowing plumes.
  const hall = new THREE.Mesh(new THREE.BoxGeometry(132, 78, 198), wall); hall.position.set(0, 39, 0); g.add(hall);
  const hroof = new THREE.Mesh(new THREE.BoxGeometry(138, 9, 204), roof); hroof.position.set(0, 81, 0); g.add(hroof);
  const annex = new THREE.Mesh(new THREE.BoxGeometry(84, 42, 90), wall); annex.position.set(102, 21, -24); g.add(annex);

  // Waisted cooling tower (two flared cylinders) — huge white vapour plume.
  const ctLo = new THREE.Mesh(new THREE.CylinderGeometry(42, 63, 66, 22), wall); ctLo.position.set(-120, 33, 42); g.add(ctLo);
  const ctHi = new THREE.Mesh(new THREE.CylinderGeometry(54, 42, 54, 22), wall); ctHi.position.set(-120, 93, 42); g.add(ctHi);
  stacks.push({ lx: -120, ly: 122, lz: 42, size: 30, rate: 11, color: 0xe8eef4, rise: 30, drift: 9, life: 7.0, grow: 4.2, wind: 8 });

  // Two banded smokestacks — very tall, dark billowing exhaust.
  for (const sx of [-18, 36]) {
    const h = 220;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, h, 16), wall); st.position.set(sx, h / 2, 72); g.add(st);
    for (let b = 0; b < 3; b++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 14, 16), band); r.position.set(sx, h - 22 - b * 40, 72); g.add(r); }
    stacks.push({ lx: sx, ly: h + 4, lz: 72, size: 15, rate: 10, color: 0x363636, rise: 46, drift: 12, life: 6.5, grow: 4.6, wind: 11 });
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, stacks };
}

function buildIsland(scene, is, waveMats, colliders, smokeSources, trees, spinners) {
  const grp = new THREE.Group();
  grp.position.set(is.center.x, 0, is.center.z);
  scene.add(grp);
  const cx0 = is.center.x, cz0 = is.center.z;
  const H = (x, z) => islandHeight(is, x, z);
  const onRiver = () => false; // river removed — nothing to avoid
  // Is the ground around (x,z) flat enough (within `reach`) to seat a footprint
  // of that size? Used to keep big flat-bottomed structures off slopes/cliffs.
  const flatEnough = (x, z, reach, maxRelief) => {
    const a = H(x, z), b = H(x - reach, z), c = H(x + reach, z), d = H(x, z - reach), e = H(x, z + reach);
    return Math.max(a, b, c, d, e) - Math.min(a, b, c, d, e) <= maxRelief;
  };
  const rnd = mulberry32(is.seed || 0x1f2e3d);
  const m4 = new THREE.Matrix4();
  const noRot = new THREE.Quaternion();
  const tp = new THREE.Vector3();
  const ts = new THREE.Vector3();

  // Terrain mesh (local)
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = H(x, z);
    pos.setY(i, h);
    terrainColorAt(is, x, z, h, cx0, cz0, c);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  grp.add(terrain);

  // (Ocean is a single global, camera-following system — see buildWorld.)

  // Runway near spawn (local)
  const ry = H(0, 0);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(80, 2000), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 }));
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, ry + 0.5, 0);
  runway.receiveShadow = true;
  grp.add(runway);
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.7 });
  const mark = (w, l, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), paintMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, ry + 0.65, z);
    m.receiveShadow = true;
    grp.add(m);
  };
  for (let z = -940; z <= 940; z += 60) mark(1.6, 30, 0, z);
  mark(1.4, 1970, -37, 0); mark(1.4, 1970, 37, 0);
  for (const ze of [-985, 985]) for (let i = -3; i <= 3; i++) { if (i === 0) continue; mark(4, 26, i * 8, ze); }
  for (const za of [-660, 660]) { mark(6, 42, -10, za); mark(6, 42, 10, za); }

  // (River ribbon removed — the global ocean shows through any inlet you sculpt.)

  // ---- Forests: three species (Pine/Oak/Birch) grouped into stands by the
  //      forest-type grid; muted/desaturated greens. ----
  {
    const MAX = is.forest.maxTrees;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1.0, 7, 5), new THREE.MeshStandardMaterial({ color: 0x6a5436, flatShading: true, roughness: 1 }), MAX);
    const pine = new THREE.InstancedMesh(new THREE.ConeGeometry(4.4, 13, 6), new THREE.MeshStandardMaterial({ color: FOREST_TYPES[0].color, flatShading: true, roughness: 1 }), MAX);
    const oak = new THREE.InstancedMesh(new THREE.SphereGeometry(5.5, 6, 5), new THREE.MeshStandardMaterial({ color: FOREST_TYPES[1].color, flatShading: true, roughness: 1 }), MAX);
    const birch = new THREE.InstancedMesh(new THREE.SphereGeometry(4.4, 6, 5), new THREE.MeshStandardMaterial({ color: FOREST_TYPES[2].color, flatShading: true, roughness: 1 }), MAX);
    let n = 0, pc = 0, oc = 0, bc = 0;
    const f = is.forest, g = f.gridN, e = f.extent, dens = forestDensityArr(is), types = forestTypesArr(is);
    const perCell = f.perCell, cellW = (2 * e) / (g - 1);
    outer:
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const d = dens[j * g + i];
        if (d <= 0.02) continue;
        const cellType = types[j * g + i] | 0;
        const count = Math.round(d * perCell);
        const cxw = (i / (g - 1) - 0.5) * 2 * e;
        const czw = (j / (g - 1) - 0.5) * 2 * e;
        for (let t = 0; t < count; t++) {
          if (n >= MAX) break outer;
          const x = cxw + (rnd() - 0.5) * cellW;
          const z = czw + (rnd() - 0.5) * cellW;
          const h = H(x, z);
          if (h < 8 || h > 760 || onRiver(x, z)) continue;
          // mostly the cell's species; an occasional neighbour for soft edges
          let sp = cellType;
          if (rnd() < 0.12) sp = (cellType + 1 + ((rnd() * 2) | 0)) % 3;
          const s = (0.9 + rnd() * 1.4) * (1 + d * 0.9);
          tp.set(x, h + 3.5 * s, z); ts.set(s, s, s);
          trunks.setMatrixAt(n, m4.compose(tp, noRot, ts));
          let cm, ci, cy; // canopy mesh + instance index + world height (for burning)
          if (sp === 0) { cy = h + 13.5 * s; tp.set(x, cy, z); ts.set(s, s, s); ci = pc; pine.setMatrixAt(pc++, m4.compose(tp, noRot, ts)); cm = pine; }
          else if (sp === 1) { cy = h + 9 * s; tp.set(x, cy, z); ts.set(s * 1.1, s * 0.95, s * 1.1); ci = oc; oak.setMatrixAt(oc++, m4.compose(tp, noRot, ts)); cm = oak; }
          else { cy = h + 8 * s; tp.set(x, cy, z); ts.set(s * 0.85, s * 1.15, s * 0.85); ci = bc; birch.setMatrixAt(bc++, m4.compose(tp, noRot, ts)); cm = birch; }
          // Every tree gets an instance handle, so blasts can ignite + remove it.
          if (trees) trees.push({ x: cx0 + x, y: h, z: cz0 + z, cy, tm: trunks, ti: n, cm, ci });
          n++;
        }
      }
    }
    trunks.count = n; pine.count = pc; oak.count = oc; birch.count = bc;
    for (const im of [trunks, pine, oak, birch]) { im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; }
    grp.add(trunks); grp.add(pine); grp.add(oak); grp.add(birch);
  }

  // ---- Bushes ----
  {
    const MAX = 900;
    const bush = new THREE.InstancedMesh(new THREE.SphereGeometry(2.2, 5, 4), new THREE.MeshStandardMaterial({ color: 0x55664a, flatShading: true, roughness: 1 }), MAX);
    let n = 0, guard = 0;
    while (n < MAX && guard < MAX * 8) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const h = H(x, z);
      if (h < 6 || h > 520 || onRiver(x, z)) continue;
      if (rnd() > forestDensityForLocal(is, x, z)) continue;
      const s = 0.8 + rnd() * 1.6;
      tp.set(x, h + 1.6 * s, z); ts.set(s * 1.4, s, s * 1.4);
      bush.setMatrixAt(n++, m4.compose(tp, noRot, ts));
    }
    bush.count = n; bush.instanceMatrix.needsUpdate = true;
    grp.add(bush);
  }

  // ---- Rocks ----
  {
    const MAX = 500;
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x7c7d80, flatShading: true, roughness: 1 }), MAX);
    rocks.castShadow = true; rocks.receiveShadow = true;
    const rq = new THREE.Quaternion(), re = new THREE.Euler();
    let n = 0, guard = 0;
    while (n < MAX && guard < MAX * 10) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.8;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.8;
      const h = H(x, z);
      if (h < 120) continue;
      const s = 4 + rnd() * 16;
      re.set(rnd() * 3, rnd() * 3, rnd() * 3); rq.setFromEuler(re);
      tp.set(x, h + s * 0.4, z); ts.set(s, s * 0.7, s * 0.9);
      rocks.setMatrixAt(n++, m4.compose(tp, rq, ts));
    }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true;
    grp.add(rocks);
  }

  // ---- Settlements ----
  // Tall lots become flat-roofed towers (slab roof + rooftop AC/antenna, with a
  // setback penthouse on the tallest); short lots become pitched-roof houses.
  // Everything stays instanced so a whole city is still a handful of draw calls.
  {
    const MAX = 900;
    // Windows are PROCEDURAL (computed per-window in the shader), not a tiling
    // texture: a window's lit state comes from a hash of its integer cell index
    // (which keeps increasing up the facade) + a per-building seed — so lit
    // windows are scattered, never repeating into vertical columns.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffcf86, emissiveIntensity: 0.85, roughness: 0.85 });
    wallMat.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying vec2 vWUV;\nvarying float vBseed;\n" + sh.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
        vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 an = abs(normal);
        vec2 pUV, sz;
        if (an.y > 0.5) { pUV = position.xz; sz = vec2(isc.x, isc.z); }
        else if (an.x > 0.5) { pUV = position.zy; sz = vec2(isc.z, isc.y); }
        else { pUV = position.xy; sz = vec2(isc.x, isc.y); }
        vWUV = (pUV + 0.5) * (sz / 7.5);   // one window cell every 7.5 world units
        vBseed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#else
        vWUV = position.xy; vBseed = 0.0;
#endif`
      );
      sh.fragmentShader = "varying vec2 vWUV;\nvarying float vBseed;\nfloat bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" + sh.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec2 cell = floor(vWUV);
          vec2 f = fract(vWUV);
          vec2 d = abs(f - 0.5);
          float glass = step(d.x, 0.34) * step(d.y, 0.40);   // window pane vs cement rim
          float band = step(f.y, 0.06);                       // faint floor line
          diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - band * 0.18), diffuseColor.rgb * 0.30, glass);
          float lit = step(0.80, bhash(cell + vec2(vBseed * 53.0, vBseed * 19.0))); // ~20% of windows lit
          totalEmissiveRadiance *= glass * lit;               // glow only on lit panes
        }`
      );
    };
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, MAX);
    const flatRoofMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 });
    const flatRoofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), flatRoofMat, MAX);
    const hipGeo = new THREE.ConeGeometry(0.707, 1, 4); hipGeo.rotateY(Math.PI / 4); // square pyramid roof
    const hipRoofs = new THREE.InstancedMesh(hipGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 }), MAX);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, 300); // setback penthouses
    const detailMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, flatShading: true, roughness: 0.9 });
    const acUnits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), detailMat, 500);
    const antennas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 5), detailMat, 250);
    buildings.castShadow = buildings.receiveShadow = true;
    flatRoofs.castShadow = hipRoofs.castShadow = caps.castShadow = acUnits.castShadow = antennas.castShadow = true;
    // Settlement archetypes — each one gives a distinct read instead of "boxes
    // at different heights". Form: base = height floor, peak = how much of the
    // settlement's maxHeight it actually uses, hip = share of pitched roofs,
    // foot = [minW,maxW] footprint, gap = skip rate (density), ant = antenna
    // chance. Palette: walls / roofs colour families.
    const STYLES = {
      coastal: {   // fishing village: low whitewashed cottages, pitched roofs, sparse
        base: 7, peak: 0.20, hip: 0.92, foot: [13, 22], gap: 0.24, ant: 0.0,
        walls: [0xeae6dc, 0xe2ddcf, 0xf2eee4, 0xd9d3c3, 0xccc6b6, 0xe6ddca],
        roofs: [0xb0563f, 0x9a4a36, 0x39536b, 0x6d6a60, 0x844a3a],
      },
      colonial: {  // old town: mid-rise cream/ochre masonry, tiled roofs, mixed
        base: 12, peak: 0.50, hip: 0.58, foot: [16, 28], gap: 0.15, ant: 0.07,
        walls: [0xe8d8b4, 0xdcc79a, 0xe9dfc6, 0xd2b890, 0xcabfa4, 0xe0cba0],
        roofs: [0x9c5436, 0x884632, 0xa8603e, 0x6a5a48, 0x7d4630],
      },
      modern: {    // metropolis: tall flat-roof glass/cement towers + antennas
        base: 24, peak: 1.0, hip: 0.08, foot: [24, 46], gap: 0.12, ant: 0.45,
        walls: [0xc4c4c0, 0xb8bab9, 0xc9c6be, 0xa9acab, 0xbfbcb4, 0x9ea2a3],
        roofs: [0x52565b, 0x40474d, 0x6b6f74, 0x3a4148],
      },
      industrial: { // port works: wide low grey/rust sheds, all flat, vents
        base: 9, peak: 0.26, hip: 0.0, foot: [30, 56], gap: 0.20, ant: 0.22,
        walls: [0x9a9c98, 0x8c8a82, 0xa6a39a, 0x7e756a, 0x6e6a62, 0x8a6a58],
        roofs: [0x55524c, 0x6b4a3a, 0x4a4742, 0x5e544a],
      },
    };
    const KIND_STYLE = { village: "coastal", town: "colonial", city: "modern", port: "industrial", industrial: "industrial" };
    const tmpCol = new THREE.Color();
    let n = 0, fr = 0, hr = 0, cp = 0, ac = 0, an = 0;
    for (const s of is.settlements) {
      const cx = s.x, cz = s.z, gr = s.radius, sp = s.spacing, mh = s.maxHeight;
      const baseSt = STYLES[s.style || is.culture || KIND_STYLE[s.kind] || "modern"]; // per-settlement > island culture > kind default
      // A `primary` settlement is the island's standout, more-developed centre:
      // denser, taller, more antennas than its satellites (same palette/style).
      const st = s.primary
        ? { ...baseSt, base: baseSt.base * 1.25, peak: baseSt.peak * 1.4, gap: baseSt.gap * 0.35, ant: Math.min(1, baseSt.ant * 1.6) }
        : baseSt;
      for (let gx = -gr; gx <= gr && n < MAX; gx++) {
        for (let gz = -gr; gz <= gr && n < MAX; gz++) {
          if (rnd() < st.gap) continue;
          const x = cx + gx * sp + (rnd() - 0.5) * 40;
          const z = cz + gz * sp + (rnd() - 0.5) * 40;
          const h = H(x, z);
          if (h < 4 || onRiver(x, z)) continue;
          if (!flatEnough(x, z, 26, 22)) continue; // no buildings jutting out of cliffs/steep slopes
          const edge = Math.max(Math.abs(gx), Math.abs(gz));
          // Height: the style's floor + a slice of the settlement's maxHeight
          // (so the village/town/city scale hierarchy still holds), tapering out
          // toward the edges. A pitched roof only on the smaller, "hip" buildings.
          const bh = st.base + rnd() * mh * st.peak * (1 - edge / (gr + 1.5));
          const flat = bh > 50 || rnd() > st.hip;
          const bw = st.foot[0] + rnd() * (st.foot[1] - st.foot[0]);
          const bd = st.foot[0] + rnd() * (st.foot[1] - st.foot[0]);
          tp.set(x, h + bh / 2, z); ts.set(bw, bh, bd);
          buildings.setMatrixAt(n, m4.compose(tp, noRot, ts));
          buildings.setColorAt(n, tmpCol.setHex(st.walls[(rnd() * st.walls.length) | 0]));
          if (flat) {
            tp.set(x, h + bh + 1.2, z); ts.set(bw + 2, 2.4, bd + 2);
            flatRoofs.setMatrixAt(fr, m4.compose(tp, noRot, ts));
            flatRoofs.setColorAt(fr, tmpCol.setHex(st.roofs[(rnd() * st.roofs.length) | 0])); fr++;
            if (bh > 28 && ac < 500) { // a rooftop AC/plant box (real buildings only)
              const aw = 4 + rnd() * 5;
              tp.set(x + (rnd() - 0.5) * bw * 0.4, h + bh + 2.4 + aw / 2, z + (rnd() - 0.5) * bd * 0.4); ts.set(aw, aw, aw);
              acUnits.setMatrixAt(ac++, m4.compose(tp, noRot, ts));
            }
            if (rnd() < st.ant && an < 250) { // an antenna mast
              const ah = 7 + rnd() * 12;
              tp.set(x + (rnd() - 0.5) * bw * 0.3, h + bh + 2.4 + ah / 2, z + (rnd() - 0.5) * bd * 0.3); ts.set(1, ah, 1);
              antennas.setMatrixAt(an++, m4.compose(tp, noRot, ts));
            }
            if (bh > 95 && cp < 300) { // stepped-back penthouse on the tallest towers
              const ch = 10 + rnd() * 16;
              tp.set(x, h + bh + ch / 2, z); ts.set(bw * 0.6, ch, bd * 0.6);
              caps.setMatrixAt(cp, m4.compose(tp, noRot, ts));
              caps.setColorAt(cp, tmpCol.setHex(st.walls[(rnd() * st.walls.length) | 0])); cp++;
            }
          } else {
            const roofH = Math.min(bh * 0.6, 4 + rnd() * 6); // pitched hip roof, proportional
            tp.set(x, h + bh + roofH / 2, z); ts.set(bw + 2, roofH, bd + 2);
            hipRoofs.setMatrixAt(hr, m4.compose(tp, noRot, ts));
            hipRoofs.setColorAt(hr, tmpCol.setHex(st.roofs[(rnd() * st.roofs.length) | 0])); hr++;
          }
          colliders.push({ x: x + cx0, z: z + cz0, hx: bw / 2 + 1, hz: bd / 2 + 1, top: h + bh });
          n++;
        }
      }
    }
    buildings.count = n; flatRoofs.count = fr; hipRoofs.count = hr; caps.count = cp; acUnits.count = ac; antennas.count = an;
    for (const im of [buildings, flatRoofs, hipRoofs, caps, acUnits, antennas]) im.instanceMatrix.needsUpdate = true;
    for (const im of [buildings, flatRoofs, hipRoofs, caps]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    grp.add(buildings); grp.add(flatRoofs); grp.add(hipRoofs); grp.add(caps); grp.add(acUnits); grp.add(antennas);
  }

  // ---- Roads ----
  {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ctrLineMat = new THREE.MeshStandardMaterial({ color: 0xd9c046, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); // yellow centre line
    const edgeLineMat = new THREE.MeshStandardMaterial({ color: 0xe9e6da, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); // white edge lines
    const lampPos = []; // [x,z,...] street-light positions accumulated along all roads
    const buildRoad = (waypoints) => {
      if (waypoints.length < 2) return;
      const half = 14, step = 45; // wider roadway
      const cl = [];
      for (let s = 0; s < waypoints.length - 1; s++) {
        const [ax, az] = waypoints[s], [bx, bz] = waypoints[s + 1];
        const segLen = Math.hypot(bx - ax, bz - az) || 1;
        const steps = Math.max(1, Math.floor(segLen / step));
        for (let k = (s > 0 ? 1 : 0); k <= steps; k++) { const tt = k / steps; cl.push([ax + (bx - ax) * tt, az + (bz - az) * tt]); }
      }
      // A ribbon along the centreline, offset sideways by `off`, half-width `hw`.
      const ribbon = (off, hw, mat, yLift) => {
        const positions = [], indices = [];
        for (let i = 0; i < cl.length; i++) {
          const p = cl[i], a = cl[Math.max(0, i - 1)], b = cl[Math.min(cl.length - 1, i + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
          const pxn = -dz, pzn = dx;
          const ox = p[0] + pxn * off, oz = p[1] + pzn * off;
          const lx = ox + pxn * hw, lz = oz + pzn * hw, rx = ox - pxn * hw, rz = oz - pzn * hw;
          positions.push(lx, H(lx, lz) + yLift, lz, rx, H(rx, rz) + yLift, rz);
        }
        for (let i = 0; i < cl.length - 1; i++) { const a = i * 2, b = i * 2 + 1, cc = (i + 1) * 2, d = (i + 1) * 2 + 1; indices.push(a, cc, b, b, cc, d); }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        g.setIndex(indices); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); m.receiveShadow = true; grp.add(m); return m;
      };
      ribbon(0, half, roadMat, 0.15);                 // roadway
      ribbon(0, 0.55, ctrLineMat, 0.22);              // centre line
      ribbon(half - 1.6, 0.4, edgeLineMat, 0.22);     // edge lines
      ribbon(-(half - 1.6), 0.4, edgeLineMat, 0.22);
      // Street lights: staggered down alternating kerbs of the centreline.
      for (let i = 2; i < cl.length - 2; i += 3) {
        const p = cl[i], a = cl[i - 1], b = cl[i + 1];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const side = (i % 6 < 3) ? 1 : -1;
        lampPos.push(p[0] - dz * (half + 4) * side, p[1] + dx * (half + 4) * side);
      }
    };
    for (const road of is.roads) buildRoad(road);

    // Build all the street lights as two instanced meshes: dark poles + emissive
    // lamp heads that bloom warm at night (no real lights — cheap at any count).
    if (lampPos.length) {
      const n = lampPos.length / 2;
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.8, 24, 6),
        new THREE.MeshStandardMaterial({ color: 0x2e3236, flatShading: true, roughness: 0.8 }), n);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffd79a, emissive: 0xffc070, emissiveIntensity: 3.4, roughness: 0.4 }), n);
      // Ground pool of cast light under each lamp (additive, brightest at night).
      const pools = new THREE.InstancedMesh(poolGeo(),
        new THREE.MeshBasicMaterial({ map: lightPoolTexture(), color: 0xffce8a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pool = new THREE.Vector3(13.5, 13.5, 13.5), pp = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const x = lampPos[i * 2], z = lampPos[i * 2 + 1], gy = H(x, z);
        pp.set(x, gy + 12, z); poles.setMatrixAt(i, m4.compose(pp, q, one));
        pp.set(x, gy + 24, z); heads.setMatrixAt(i, m4.compose(pp, q, one));
        pp.set(x, gy + 0.4, z); pools.setMatrixAt(i, m4.compose(pp, q, pool));
      }
      poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true;
      poles.castShadow = false; heads.castShadow = false; pools.renderOrder = 1;
      grp.add(poles); grp.add(heads); grp.add(pools);
    }
  }

  // (Suspension bridges removed along with the river.)

  // ---- Farmland: a patchwork of crop / tilled field tiles across the gentle
  //      lowlands, clustered by a coarse noise so it reads as worked land from
  //      the air (this is what fills the empty green between settlements). ----
  {
    const FIELD_MAX = 2800;
    const fields = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.96, flatShading: true }), FIELD_MAX);
    fields.receiveShadow = true;
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const cropTones = [0x7a8f3e, 0x90a04a, 0xb9ad5a, 0xd2c878, 0x9c8a4e, 0x8a6f43, 0x6f8137, 0xafb56e, 0xc7b85e];
    const fc = new THREE.Color();
    const e = is.forest.extent, step = 150;
    let nf = 0;
    for (let z = -e; z <= e && nf < FIELD_MAX; z += step) {
      for (let x = -e; x <= e && nf < FIELD_MAX; x += step) {
        const fn = smoothNoise((x + cx0) * 0.00045, (z + cz0) * 0.00045);
        if (fn < 0.40 || fn > 0.78) continue;                 // farmland belts, not blanket coverage
        const jx = x + (rnd() - 0.5) * step * 0.5, jz = z + (rnd() - 0.5) * step * 0.5;
        if (Math.abs(jx) < 130 && Math.abs(jz) < 1100) continue; // keep off the runway
        const h = H(jx, jz);
        if (h < SEA_LEVEL + 6 || h > SEA_LEVEL + 320) continue;  // lowland only, not beach/water/highland
        const s = step * 0.42;
        const h1 = H(jx - s, jz - s), h2 = H(jx + s, jz - s), h3 = H(jx - s, jz + s), h4 = H(jx + s, jz + s);
        if (Math.max(h, h1, h2, h3, h4) - Math.min(h, h1, h2, h3, h4) > 10) continue; // gentle slope only
        const w = step * (0.74 + rnd() * 0.46), d = step * (0.74 + rnd() * 0.46);
        tp.set(jx, h + 0.4, jz); ts.set(w, d, 1);
        fields.setMatrixAt(nf, m4.compose(tp, flat, ts));
        fields.setColorAt(nf, fc.setHex(cropTones[(rnd() * cropTones.length) | 0]));
        nf++;
      }
    }
    fields.count = nf;
    fields.instanceMatrix.needsUpdate = true;
    if (fields.instanceColor) fields.instanceColor.needsUpdate = true;
    if (nf) grp.add(fields);
  }

  // ---- Airfield buildout: hangars, a control tower and fuel tanks alongside
  //      the runway, so a base reads as a base instead of a bare strip. ----
  {
    const ry2 = H(0, 0);
    const hangarWall = new THREE.MeshStandardMaterial({ color: 0x6f7479, flatShading: true, roughness: 0.85, metalness: 0.2 });
    const hangarRoof = new THREE.MeshStandardMaterial({ color: 0x8a9097, flatShading: true, roughness: 0.7, metalness: 0.3 });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, flatShading: true, roughness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b3a44, emissive: 0x18323e, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xb7bcc0, flatShading: true, roughness: 0.7, metalness: 0.25 });
    // Hangars: an arched (half-cylinder) roof on a low box, opening toward the apron.
    for (let i = 0; i < 3; i++) {
      const hx = 150, hz = -560 + i * 150, gy = H(hx, hz);
      if (gy < SEA_LEVEL + 2) continue;
      const body = new THREE.Mesh(new THREE.BoxGeometry(46, 16, 64), hangarWall);
      body.position.set(hx, gy + 8, hz); body.castShadow = body.receiveShadow = true; grp.add(body);
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(23, 23, 64, 14, 1, false, 0, Math.PI), hangarRoof);
      arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2; arch.position.set(hx, gy + 16, hz); arch.castShadow = true; grp.add(arch);
      colliders.push({ x: cx0 + hx, z: cz0 + hz, hx: 24, hz: 33, top: gy + 38 });
    }
    // Control tower: a slim shaft with a cantilevered glass cab + a mast.
    {
      const tx = -130, tz = 280, gy = H(tx, tz);
      if (gy > SEA_LEVEL + 2) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 42, 8), towerMat);
        shaft.position.set(tx, gy + 21, tz); shaft.castShadow = true; grp.add(shaft);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 8, 8, 8), glassMat);
        cab.position.set(tx, gy + 46, tz); cab.castShadow = true; grp.add(cab);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(9, 4, 8), towerMat); cap.position.set(tx, gy + 52, tz); grp.add(cap);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 16, 5), towerMat); mast.position.set(tx, gy + 62, tz); grp.add(mast);
        colliders.push({ x: cx0 + tx, z: cz0 + tz, hx: 9, hz: 9, top: gy + 54 });
      }
    }
    // Fuel-farm tanks: a couple of squat cylinders behind the hangars.
    for (let i = 0; i < 3; i++) {
      const fx = 215, fz = -520 + i * 70, gy = H(fx, fz);
      if (gy < SEA_LEVEL + 2) continue;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 16, 16), tankMat);
      tank.position.set(fx, gy + 8, fz); tank.castShadow = true; grp.add(tank);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 3, 16), tankMat); lid.position.set(fx, gy + 17, fz); grp.add(lid);
      colliders.push({ x: cx0 + fx, z: cz0 + fz, hx: 15, hz: 15, top: gy + 18 });
    }
  }

  // ---- Wind farm: a line of turbines on a gentle coastal/upland band; the
  //      rotors turn (handed to the spinner system about their shaft axis). ----
  {
    const zc = -5400 + (rnd() - 0.5) * 4200; // seeded band
    let placed = 0;
    for (let x = -4200; x <= 4200 && placed < 10; x += 240) {
      const gy = H(x, zc);
      if (gy < SEA_LEVEL + 4 || gy > SEA_LEVEL + 170) continue;
      const s = 90, a = H(x - s, zc), b = H(x + s, zc), c2 = H(x, zc - s), d2 = H(x, zc + s);
      if (Math.max(gy, a, b, c2, d2) - Math.min(gy, a, b, c2, d2) > 12) continue;
      const t = buildWindTurbine();
      t.group.position.set(x, gy, zc);
      t.group.rotation.y = 0.3 + (rnd() - 0.5) * 0.5;
      grp.add(t.group);
      if (spinners) spinners.push({ obj: t.rotor, speed: 1.3 + rnd() * 0.7, axis: "z" });
      colliders.push({ x: cx0 + x, z: cz0 + zc, hx: 4, hz: 4, top: gy + 84 });
      placed++;
    }
  }

  // ---- Transmission lines: pylons marching alongside the roads with wires
  //      strung between them, so the island reads as wired-together, not empty. ----
  if (is.roads && is.roads.length) {
    const PMAX = 320, WMAX = 1300;
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x6b7077, flatShading: true, roughness: 0.85 });
    const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1.7, 36, 4), steelMat, PMAX);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(20, 1.2, 1.2), steelMat, PMAX * 2);
    const wires = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 4), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 }), WMAX);
    masts.castShadow = true;
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), mid = new THREE.Vector3(), wq = new THREE.Quaternion(), wsc = new THREE.Vector3(), armQ = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0), segDir = new THREE.Vector3();
    let pm = 0, pa = 0, wm = 0;
    const GAP = 300, ARM_Y = 30;
    for (const road of is.roads) {
      const pts = [];
      for (let s = 0; s < road.length - 1; s++) {
        const [ax, az] = road[s], [bx, bz] = road[s + 1];
        const segLen = Math.hypot(bx - ax, bz - az) || 1, steps = Math.max(1, Math.floor(segLen / GAP));
        for (let k = (s > 0 ? 1 : 0); k <= steps; k++) { const tt = k / steps; pts.push([ax + (bx - ax) * tt, az + (bz - az) * tt]); }
      }
      let prev = null;
      for (let i = 0; i < pts.length && pm < PMAX; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dxr = b[0] - a[0], dzr = b[1] - a[1]; const L = Math.hypot(dxr, dzr) || 1; dxr /= L; dzr /= L;
        const ox = pts[i][0] - dzr * 26, oz = pts[i][1] + dxr * 26, gy = H(ox, oz);
        if (gy < SEA_LEVEL + 2) { prev = null; continue; }
        tp.set(ox, gy + 18, oz); ts.set(1, 1, 1); masts.setMatrixAt(pm++, m4.compose(tp, noRot, ts));
        armQ.setFromUnitVectors(xAxis, segDir.set(dxr, 0, dzr));
        if (pa < PMAX * 2) { tp.set(ox, gy + ARM_Y, oz); arms.setMatrixAt(pa++, m4.compose(tp, armQ, ts)); }
        if (pa < PMAX * 2) { tp.set(ox, gy + ARM_Y - 8, oz); arms.setMatrixAt(pa++, m4.compose(tp, armQ, ts)); }
        const top = { x: ox, y: gy + ARM_Y, z: oz };
        if (prev && wm + 3 <= WMAX) for (const off of [-8, 0, 8]) {
          const ax2 = prev.x - dzr * off, az2 = prev.z + dxr * off, bx2 = top.x - dzr * off, bz2 = top.z + dxr * off;
          mid.set((ax2 + bx2) / 2, (prev.y + top.y) / 2, (az2 + bz2) / 2);
          dir.set(bx2 - ax2, top.y - prev.y, bz2 - az2); const len = dir.length() || 1; dir.multiplyScalar(1 / len);
          wq.setFromUnitVectors(up, dir); wsc.set(1, len, 1);
          wires.setMatrixAt(wm++, m4.compose(mid, wq, wsc));
        }
        prev = top;
      }
    }
    masts.count = pm; arms.count = pa; wires.count = wm;
    masts.instanceMatrix.needsUpdate = arms.instanceMatrix.needsUpdate = wires.instanceMatrix.needsUpdate = true;
    if (pm) grp.add(masts); if (pa) grp.add(arms); if (wm) grp.add(wires);
  }

  // ---- Port / harbour: a quay with gantry cranes, piers and a container yard
  //      at the shore — a coastal trade anchor (and where the cargo ships head). ----
  {
    const ang = rnd() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    let shoreR = null;
    for (let r = 1500; r < 11000; r += 60) { if (H(dx * r, dz * r) < SEA_LEVEL + 1) { shoreR = r; break; } }
    if (shoreR != null && shoreR > 2500) {
      const tx = -dz, tz = dx;                                   // tangent (along shore)
      const qx = dx * (shoreR - 70), qz = dz * (shoreR - 70), gy = H(qx, qz);
      if (gy > SEA_LEVEL + 1 && gy < SEA_LEVEL + 12) { // low beach only, so the quay sits at the water
        const deckY = gy + 1.5;
        const seaYaw = Math.atan2(-dz, dx), shoreYaw = Math.atan2(-tz, tx);
        const concrete = new THREE.MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.9, flatShading: true });
        const quay = new THREE.Mesh(new THREE.BoxGeometry(220, 4, 46), concrete);
        quay.position.set(qx, deckY, qz); quay.rotation.y = shoreYaw; quay.receiveShadow = true; grp.add(quay);
        for (let p = -1; p <= 1; p += 2) {                        // two piers reaching seaward
          const pcx = qx + tx * p * 78 + dx * 58, pcz = qz + tz * p * 78 + dz * 58;
          const pier = new THREE.Mesh(new THREE.BoxGeometry(110, 3, 20), concrete);
          pier.position.set(pcx, deckY, pcz); pier.rotation.y = seaYaw; pier.receiveShadow = true; grp.add(pier);
        }
        for (let cI = -1; cI <= 1; cI++) {                        // gantry cranes, booms to sea
          const cxp = qx + tx * cI * 72, czp = qz + tz * cI * 72;
          const cr = buildCrane(); cr.position.set(cxp, deckY, czp); cr.rotation.y = seaYaw; grp.add(cr);
          colliders.push({ x: cx0 + cxp, z: cz0 + czp, hx: 16, hz: 12, top: deckY + 70 });
        }
        // Container yard (instanced, stacked) behind the quay.
        const contCols = [0xc0492f, 0x2f6ec0, 0x2fae6e, 0xd2a82f, 0x8a8f93, 0xb03a8a];
        const yard = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 5, 13),
          new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), 260);
        const cc = new THREE.Color(); const yYaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, shoreYaw, 0));
        let ny = 0;
        const yx = qx - dx * 110, yz = qz - dz * 110;
        for (let rr = 0; rr < 7 && ny < 260; rr++) for (let cc2 = 0; cc2 < 9 && ny < 260; cc2++) {
          const bx = yx + tx * (cc2 - 4) * 14 - dx * rr * 15, bz = yz + tz * (cc2 - 4) * 14 - dz * rr * 15;
          const bgy = H(bx, bz); if (bgy < SEA_LEVEL + 1) continue;
          const stack = 1 + ((rnd() * 3) | 0);
          for (let s2 = 0; s2 < stack && ny < 260; s2++) {
            tp.set(bx, bgy + 2.5 + s2 * 5, bz); ts.set(1, 1, 1);
            yard.setMatrixAt(ny, m4.compose(tp, yYaw, ts));
            yard.setColorAt(ny, cc.setHex(contCols[(rnd() * contCols.length) | 0])); ny++;
          }
        }
        yard.count = ny; yard.instanceMatrix.needsUpdate = true; if (yard.instanceColor) yard.instanceColor.needsUpdate = true;
        yard.castShadow = true; if (ny) grp.add(yard);
      }
    }
  }

  // ---- Solar field: a grid of tilted dark photovoltaic panels on gentle land. ----
  {
    let sx0 = 0, sz0 = 0, gy0 = -1e9;
    for (let tries = 0; tries < 14; tries++) {
      const x = (rnd() - 0.5) * 6500, z = (rnd() - 0.5) * 6500, h = H(x, z);
      if (h > SEA_LEVEL + 6 && h < SEA_LEVEL + 240 && flatEnough(x, z, 90, 16)) { sx0 = x; sz0 = z; gy0 = h; break; }
    }
    if (gy0 > SEA_LEVEL + 6 && gy0 < SEA_LEVEL + 240) {
      const PMAX = 160;
      const panels = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 5),
        new THREE.MeshStandardMaterial({ color: 0x18283f, emissive: 0x0a1628, emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }), PMAX);
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.5, 0, 0));
      let np = 0;
      for (let r = 0; r < 11 && np < PMAX; r++) for (let c = 0; c < 14 && np < PMAX; c++) {
        const x = sx0 + (c - 7) * 14, z = sz0 + (r - 5) * 9, gy = H(x, z);
        if (gy < SEA_LEVEL + 4 || gy > SEA_LEVEL + 260) continue;
        tp.set(x, gy + 2.6, z); ts.set(1, 1, 1); panels.setMatrixAt(np++, m4.compose(tp, tilt, ts));
      }
      panels.count = np; panels.instanceMatrix.needsUpdate = true; if (np) grp.add(panels);
    }
  }

  // ---- Refinery / tank farm: a ring of storage tanks + a flare stack (smoke). ----
  {
    let rx = 0, rz = 0, gy = -1e9;
    for (let tries = 0; tries < 14; tries++) { // find dry, flat ground for the tank ring
      const x = (rnd() - 0.5) * 5200, z = (rnd() - 0.5) * 5200, h = H(x, z);
      if (h > SEA_LEVEL + 4 && h < SEA_LEVEL + 190 && flatEnough(x, z, 70, 16)) { rx = x; rz = z; gy = h; break; }
    }
    if (gy > SEA_LEVEL + 4 && gy < SEA_LEVEL + 190) {
      const tankMat = new THREE.MeshStandardMaterial({ color: 0xc2c6c9, flatShading: true, roughness: 0.7, metalness: 0.2 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, tr = 42 + (i % 2) * 24;
        const txp = rx + Math.cos(a) * tr, tzp = rz + Math.sin(a) * tr, tgy = H(txp, tzp);
        if (tgy < SEA_LEVEL + 2) continue;
        const R = 14 + rnd() * 8, Hh = 14 + rnd() * 8;
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Hh, 18), tankMat);
        tank.position.set(txp, tgy + Hh / 2, tzp); tank.castShadow = true; grp.add(tank);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.85, 3, 18), tankMat); lid.position.set(txp, tgy + Hh + 1.5, tzp); grp.add(lid);
        colliders.push({ x: cx0 + txp, z: cz0 + tzp, hx: R, hz: R, top: tgy + Hh });
      }
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.6, 72, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a58, flatShading: true, roughness: 0.8 }));
      stack.position.set(rx, gy + 36, rz); stack.castShadow = true; grp.add(stack);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(rx, gy + 78, rz); grp.add(flame);
      if (smokeSources) smokeSources.push({ x: cx0 + rx, y: gy + 82, z: cz0 + rz, size: 6, rate: 0.45, color: 0x35353c, rise: 26, drift: 9, life: 7, grow: 2.2, wind: 1 });
      colliders.push({ x: cx0 + rx, z: cz0 + rz, hx: 4, hz: 4, top: gy + 72 });
    }
  }

  // ---- Civic landmarks: a stadium near a big settlement, and a cathedral near
  //      an old-world (colonial) one, for skyline variety per culture. ----
  {
    const kindStyle = { village: "coastal", town: "colonial", city: "modern", port: "industrial", industrial: "industrial" };
    const styleOf = (s) => s.style || is.culture || kindStyle[s.kind] || "modern";
    // Big flat-footed civic buildings: try several spots around the settlement
    // and only seat one on dry, flat-enough ground (no stadium on a hillside).
    const placeNear = (s, off, build, hx, hz, topH, reach) => {
      if (!s) return;
      for (let tries = 0; tries < 10; tries++) {
        const a = rnd() * Math.PI * 2, dd = s.radius * (s.spacing || 110) + off;
        const x = s.x + Math.cos(a) * dd, z = s.z + Math.sin(a) * dd, gy = H(x, z);
        if (gy < SEA_LEVEL + 4 || gy > SEA_LEVEL + 240) continue;
        if (!flatEnough(x, z, reach, 12)) continue;
        const m = build(); m.position.set(x, gy, z); m.rotation.y = rnd() * Math.PI * 2; grp.add(m);
        colliders.push({ x: cx0 + x, z: cz0 + z, hx, hz, top: gy + topH });
        return;
      }
    };
    placeNear(is.settlements.find((s) => s.radius >= 2) || is.settlements[0], 360, buildStadium, 95, 80, 30, 90);
    placeNear(is.settlements.find((s) => styleOf(s) === "colonial"), 220, buildCathedral, 26, 32, 85, 40);
  }

  // ---- Dam + reservoir: a concrete dam holding a small upland lake. Built only
  //      on the flattest elevated spot found, so the water sits believably. ----
  {
    let best = null, bestRelief = 1e9;
    for (let t = 0; t < 64; t++) {
      const x = (rnd() - 0.5) * 13000, z = (rnd() - 0.5) * 13000, h = H(x, z);
      if (h < SEA_LEVEL + 70 || h > SEA_LEVEL + 300) continue;
      const s = 170, hs = [H(x - s, z), H(x + s, z), H(x, z - s), H(x, z + s)];
      const relief = Math.max(...hs) - Math.min(...hs);
      if (relief < bestRelief) { bestRelief = relief; best = { x, z, h, hs }; }
    }
    if (best && bestRelief < 26) {
      const { x, z, h, hs } = best;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      let lo = 0; for (let i = 1; i < 4; i++) if (hs[i] < hs[lo]) lo = i;
      const ddx = dirs[lo][0], ddz = dirs[lo][1], waterY = h + 1;
      const lake = new THREE.Mesh(new THREE.CircleGeometry(210, 36), new THREE.MeshStandardMaterial({ color: 0x2a5a6e, roughness: 0.25, metalness: 0.2 }));
      lake.rotation.x = -Math.PI / 2; lake.position.set(x, waterY, z); grp.add(lake);
      const wallX = x + ddx * 205, wallZ = z + ddz * 205, wgy = H(wallX, wallZ);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(340, 46, 18), new THREE.MeshStandardMaterial({ color: 0x9a9ea2, flatShading: true, roughness: 0.9 }));
      wall.position.set(wallX, wgy + 23, wallZ); wall.rotation.y = Math.atan2(-ddx, -ddz); wall.castShadow = true; grp.add(wall);
      colliders.push({ x: cx0 + wallX, z: cz0 + wallZ, hx: 170, hz: 9, top: wgy + 46 });
    }
  }

  // ---- Landmarks: a lattice radio tower on the cliff, a lighthouse on the
  //      far shore (opposite the cliff). Both big, low-poly. Home's signature;
  //      islands can opt out (landmarks:false). ----
  if (is.landmarks !== false) {
    const cf = is.cliff;
    const rt = buildRadioTower();
    rt.scale.y = 2; // twice as tall
    rt.position.set(cf.x, H(cf.x, cf.z), cf.z);
    grp.add(rt);
    const cd = Math.hypot(cf.x, cf.z) || 1;
    const lx = (-cf.x / cd) * 6900, lz = (-cf.z / cd) * 6900; // opposite side, near the coast
    const lh = buildLighthouse();
    lh.scale.set(1.7, 2.2, 1.7); // ~5x real (was ~10x) — still a tall landmark, less cartoonish
    lh.position.set(lx, Math.max(H(lx, lz), SEA_LEVEL + 2), lz);
    grp.add(lh);
    if (spinners && lh.userData.beacon) spinners.push({ obj: lh.userData.beacon, speed: 0.35 });
  }

  // ---- Spire monument: a glowing tapered obelisk crowning the cliff summit,
  //      with a slowly rotating ring of light pylons at its base. ----
  if (is.spire) {
    const cf = is.cliff;
    const sp = buildSpire();
    sp.scale.setScalar(3);
    sp.position.set(cf.x, H(cf.x, cf.z), cf.z);
    grp.add(sp);
    if (spinners && sp.userData.ring) spinners.push({ obj: sp.userData.ring, speed: 0.3 });
  }

  // ---- Power plant near the city: big smoke plumes (and a strike target). ----
  {
    let px = 4900, pz = 5200, gy = H(px, pz);
    if (!flatEnough(px, pz, 120, 22)) { // its big hall needs flat ground — nudge to a flat spot nearby
      for (let t = 0; t < 24; t++) {
        const a = rnd() * Math.PI * 2, r = 600 + rnd() * 3200, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, h = H(x, z);
        if (h > SEA_LEVEL + 2 && h < SEA_LEVEL + 240 && flatEnough(x, z, 120, 20)) { px = x; pz = z; gy = h; break; }
      }
    }
    if (gy > SEA_LEVEL + 2) {
      const pp = buildPowerPlant();
      pp.group.position.set(px, gy, pz);
      grp.add(pp.group);
      colliders.push({ x: cx0 + px, z: cz0 + pz, hx: 72, hz: 108, top: gy + 90 }); // turbine hall
      if (smokeSources) for (const s of pp.stacks) smokeSources.push({
        x: cx0 + px + s.lx, y: gy + s.ly, z: cz0 + pz + s.lz,
        size: s.size, rate: s.rate, color: s.color, rise: s.rise, drift: s.drift, life: s.life, grow: s.grow, wind: s.wind,
      });
      // Floodlights ringing the plant so the whole site is lit up at night.
      const ppHead = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe6b0, emissiveIntensity: 4.0, roughness: 0.4 });
      const ppPole = new THREE.MeshStandardMaterial({ color: 0x2e3236, flatShading: true, roughness: 0.8 });
      const ppPool = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), color: 0xffdca0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const lx = px + Math.cos(ang) * 125, lz = pz + Math.sin(ang) * 140, lgy = H(lx, lz);
        if (lgy < SEA_LEVEL + 2) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 34, 6), ppPole); pole.position.set(lx, lgy + 17, lz); pole.castShadow = true; grp.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 3), ppHead); head.position.set(lx, lgy + 33, lz + Math.sin(-ang) * 0.5); grp.add(head);
        const pool = new THREE.Mesh(poolGeo(), ppPool); pool.scale.set(44, 44, 44); pool.position.set(lx, lgy + 0.5, lz); pool.renderOrder = 1; grp.add(pool);
      }
    }
  }

  return { group: grp, terrain };
}
