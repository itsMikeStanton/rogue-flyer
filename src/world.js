import * as THREE from "three";
import { defaultWorldConfig } from "./worldConfig.js";

// Low-poly arcade world, driven by an editable config (see worldConfig.js).

const TERRAIN_SIZE = 24000;
const SEGMENTS = 360; // landmass mesh resolution (higher = finer hills/coast/river)

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
      name: "Home", faction: "ally", seed: c.seed || 0x1f2e3d, center: { x: 0, z: 0 },
      terrain: c.terrain, cliff: c.cliff, river: c.river, spawn: c.spawn,
      carriers: c.carriers || [], settlements: c.settlements || [], bridges: c.bridges || [],
      roads: c.roads || [], missionBases: c.missionBases || [], forest: c.forest, paint: c.paint,
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

// Carriers / mission targets flattened to WORLD coordinates across all islands.
export function getCarriers() {
  const out = [];
  for (const is of CFG.islands) for (const c of (is.carriers || [])) {
    out.push({ ...c, x: c.x + is.center.x, z: c.z + is.center.z, deckY: CFG.seaLevel + 24 });
  }
  return out;
}
export function getMissionBases() {
  const out = [];
  for (const is of CFG.islands) for (const b of (is.missionBases || [])) out.push([b[0] + is.center.x, b[1] + is.center.z]);
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
  return r.a1 * Math.sin(z * r.f1) + r.a2 * Math.sin(z * r.f2 + r.phase);
}
// Editor convenience (operates on the active island, in its local coords).
export function riverCenterX(z) { return riverCenterXLocal(getActiveIsland(), z); }

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
  const isl = THREE.MathUtils.smoothstep(d, is.terrain.islandInner, is.terrain.islandOuter);
  h = THREE.MathUtils.lerp(h, is.terrain.deep, isl);
  const cf = is.cliff;
  const cdist = Math.hypot(x - cf.x, z - cf.z);
  if (cdist < cf.r + 230) {
    const t = THREE.MathUtils.smoothstep(cdist, cf.r, cf.r + 230);
    h = THREE.MathUtils.lerp(cf.h, h, t);
  }
  if (d < is.spawn.flattenRadius) {
    const t = THREE.MathUtils.clamp((d - 600) / 800, 0, 1);
    h = THREE.MathUtils.lerp(0, h, t);
  }
  const rv = is.river;
  if (d < rv.carveMax) {
    const rd = Math.abs(x - riverCenterXLocal(is, z));
    if (rd < rv.outer) {
      const t = THREE.MathUtils.smoothstep(rd, rv.inner, rv.outer);
      h = THREE.MathUtils.lerp(rv.bed, h, t);
    }
  }
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

// Procedural window textures for buildings: a tiled grid of window panes, with
// a matching emissive map where some windows are "lit".
function makeWindowTextures() {
  const N = 64;
  const wall = document.createElement("canvas"); wall.width = wall.height = N;
  const emis = document.createElement("canvas"); emis.width = emis.height = N;
  const gw = wall.getContext("2d"), ge = emis.getContext("2d");
  gw.fillStyle = "#ffffff"; gw.fillRect(0, 0, N, N); // white wall (tinted by instanceColor)
  ge.fillStyle = "#000000"; ge.fillRect(0, 0, N, N);
  for (let y = 7; y < N - 4; y += 13) {
    for (let x = 6; x < N - 4; x += 12) {
      gw.fillStyle = Math.random() < 0.5 ? "#39434f" : "#2a3340";
      gw.fillRect(x, y, 7, 9);
      if (Math.random() < 0.33) { ge.fillStyle = "#ffcf86"; ge.fillRect(x, y, 7, 9); }
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
  let firstTerrain = null;
  for (const is of CFG.islands) {
    const built = buildIsland(scene, is, waveMats, colliders);
    if (!firstTerrain) firstTerrain = built.terrain;
    islands.push({ group: built.group, center: is.center, name: is.name, faction: is.faction });
  }

  // Clouds (global): a large tiled field of big, billowy cumulus that follows
  // the camera each frame (main.js) by snapping to CLOUD_TILE. Because the tile
  // (80km) dwarfs the fog distance, the snap is never visible — clouds simply
  // exist everywhere. Much larger puffs than before.
  const clouds = buildClouds(scene);

  const rings = [];
  return { terrain: firstTerrain, rings, sun, clouds, ocean, carriers, colliders, waveMats, islands };
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
function buildIsland(scene, is, waveMats, colliders) {
  const grp = new THREE.Group();
  grp.position.set(is.center.x, 0, is.center.z);
  scene.add(grp);
  const cx0 = is.center.x, cz0 = is.center.z;
  const H = (x, z) => islandHeight(is, x, z);
  const RC = (z) => riverCenterXLocal(is, z);
  const onRiver = (x, z) => Math.abs(x - RC(z)) < is.river.outer + 60;
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
  const sand = new THREE.Color(0xcdbd87), low = new THREE.Color(0x3f6b3a), mid = new THREE.Color(0x6f7d4a);
  const high = new THREE.Color(0x9a9a8e), snow = new THREE.Color(0xeef2f5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = H(x, z);
    pos.setY(i, h);
    if (h < 45) {
      const s = THREE.MathUtils.clamp((h + 12) / 57, 0, 1);
      c.copy(sand).lerp(low, s);
    } else {
      const t = THREE.MathUtils.clamp((h + 200) / 1400, 0, 1);
      if (t < 0.45) c.copy(low).lerp(mid, t / 0.45);
      else if (t < 0.8) c.copy(mid).lerp(high, (t - 0.45) / 0.35);
      else c.copy(high).lerp(snow, (t - 0.8) / 0.2);
    }
    paintColorForLocal(is, x, z, c, _pcOut); c.copy(_pcOut);
    const j = (hash2((x + cx0) * 0.05, (z + cz0) * 0.05) - 0.5) * 0.06;
    colors.push(
      THREE.MathUtils.clamp(c.r + j, 0, 1),
      THREE.MathUtils.clamp(c.g + j, 0, 1),
      THREE.MathUtils.clamp(c.b + j, 0, 1)
    );
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  terrain.receiveShadow = true;
  grp.add(terrain);

  // (Ocean is a single global, camera-following system — see buildWorld.)

  // Runway near spawn (local)
  const ry = H(0, 0);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(80, 1200), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 }));
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
  for (let z = -540; z <= 540; z += 60) mark(1.6, 30, 0, z);
  mark(1.4, 1170, -37, 0); mark(1.4, 1170, 37, 0);
  for (const ze of [-585, 585]) for (let i = -3; i <= 3; i++) { if (i === 0) continue; mark(4, 26, i * 8, ze); }
  for (const za of [-380, 380]) { mark(6, 42, -10, za); mark(6, 42, 10, za); }

  // River ribbon (local)
  {
    const z0 = -is.river.extent, z1 = is.river.extent, step = 300, half = 150;
    const surf = is.river.surface;
    const positions = [], indices = [];
    let rows = 0;
    for (let z = z0; z <= z1; z += step) { const rc = RC(z); positions.push(rc - half, surf, z, rc + half, surf, z); rows++; }
    for (let i = 0; i < rows - 1; i++) { const a = i * 2, b = i * 2 + 1, cc = (i + 1) * 2, d = (i + 1) * 2 + 1; indices.push(a, cc, b, b, cc, d); }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    rgeo.setIndex(indices); rgeo.computeVertexNormals();
    const riverMat = waveMaterial(0x2f6f8c, 0.85);
    const river = new THREE.Mesh(rgeo, riverMat);
    river.receiveShadow = true;
    grp.add(river);
    waveMats.push(riverMat);
  }

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
          if (sp === 0) { tp.set(x, h + 13.5 * s, z); ts.set(s, s, s); pine.setMatrixAt(pc++, m4.compose(tp, noRot, ts)); }
          else if (sp === 1) { tp.set(x, h + 9 * s, z); ts.set(s * 1.1, s * 0.95, s * 1.1); oak.setMatrixAt(oc++, m4.compose(tp, noRot, ts)); }
          else { tp.set(x, h + 8 * s, z); ts.set(s * 0.85, s * 1.15, s * 0.85); birch.setMatrixAt(bc++, m4.compose(tp, noRot, ts)); }
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
    const win = makeWindowTextures();
    const wallMat = new THREE.MeshStandardMaterial({ map: win.map, emissive: 0xffcf86, emissiveMap: win.emissiveMap, emissiveIntensity: 0.9, roughness: 0.8 });
    // Tile the window texture per-instance from each building's world size, so
    // windows stay a constant size instead of stretching to the box dimensions.
    wallMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
#ifdef USE_INSTANCING
        {
          vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec3 an = abs(normal);
          vec2 pUV, sz;
          if (an.y > 0.5) { pUV = position.xz; sz = vec2(isc.x, isc.z); }
          else if (an.x > 0.5) { pUV = position.zy; sz = vec2(isc.z, isc.y); }
          else { pUV = position.xy; sz = vec2(isc.x, isc.y); }
          vMapUv = (pUV + 0.5) * (sz / 30.0);
        }
#endif`
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
    // Cement/concrete greys (cool, low-saturation) rather than warm brick tones.
    const wallTones = [0xb3b6b7, 0x9b9ea0, 0x868a8c, 0xa6a8a7, 0x787c7e];
    const roofTones = [0x52565b, 0x40474d, 0x6b6f74, 0x3a4148];
    const tmpCol = new THREE.Color();
    let n = 0, fr = 0, hr = 0, cp = 0, ac = 0, an = 0;
    for (const s of is.settlements) {
      const cx = s.x, cz = s.z, gr = s.radius, sp = s.spacing, mh = s.maxHeight;
      for (let gx = -gr; gx <= gr && n < MAX; gx++) {
        for (let gz = -gr; gz <= gr && n < MAX; gz++) {
          if (rnd() < 0.12) continue;
          const x = cx + gx * sp + (rnd() - 0.5) * 40;
          const z = cz + gz * sp + (rnd() - 0.5) * 40;
          const h = H(x, z);
          if (h < 4 || onRiver(x, z)) continue;
          const edge = Math.max(Math.abs(gx), Math.abs(gz));
          const bh = 18 + rnd() * mh * (1 - edge / (gr + 1.5));
          const tall = bh > 50;
          const bw = tall ? 16 + rnd() * 18 : 20 + rnd() * 24;
          const bd = tall ? 16 + rnd() * 18 : 20 + rnd() * 24;
          tp.set(x, h + bh / 2, z); ts.set(bw, bh, bd);
          buildings.setMatrixAt(n, m4.compose(tp, noRot, ts));
          buildings.setColorAt(n, tmpCol.setHex(wallTones[(rnd() * wallTones.length) | 0]));
          if (tall) {
            tp.set(x, h + bh + 1.2, z); ts.set(bw + 2, 2.4, bd + 2);
            flatRoofs.setMatrixAt(fr, m4.compose(tp, noRot, ts));
            flatRoofs.setColorAt(fr, tmpCol.setHex(roofTones[(rnd() * roofTones.length) | 0])); fr++;
            if (ac < 500) { // a rooftop AC/plant box
              const aw = 4 + rnd() * 5;
              tp.set(x + (rnd() - 0.5) * bw * 0.4, h + bh + 2.4 + aw / 2, z + (rnd() - 0.5) * bd * 0.4); ts.set(aw, aw, aw);
              acUnits.setMatrixAt(ac++, m4.compose(tp, noRot, ts));
            }
            if (rnd() < 0.45 && an < 250) { // an antenna mast
              const ah = 7 + rnd() * 12;
              tp.set(x + (rnd() - 0.5) * bw * 0.3, h + bh + 2.4 + ah / 2, z + (rnd() - 0.5) * bd * 0.3); ts.set(1, ah, 1);
              antennas.setMatrixAt(an++, m4.compose(tp, noRot, ts));
            }
            if (bh > 95 && cp < 300) { // stepped-back penthouse on the tallest towers
              const ch = 10 + rnd() * 16;
              tp.set(x, h + bh + ch / 2, z); ts.set(bw * 0.6, ch, bd * 0.6);
              caps.setMatrixAt(cp, m4.compose(tp, noRot, ts));
              caps.setColorAt(cp, tmpCol.setHex(wallTones[(rnd() * wallTones.length) | 0])); cp++;
            }
          } else {
            const roofH = 5 + rnd() * 5; // pitched hip roof
            tp.set(x, h + bh + roofH / 2, z); ts.set(bw + 2, roofH, bd + 2);
            hipRoofs.setMatrixAt(hr, m4.compose(tp, noRot, ts));
            hipRoofs.setColorAt(hr, tmpCol.setHex(roofTones[(rnd() * roofTones.length) | 0])); hr++;
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
    const buildRoad = (waypoints) => {
      if (waypoints.length < 2) return;
      const half = 9, step = 45;
      const cl = [];
      for (let s = 0; s < waypoints.length - 1; s++) {
        const [ax, az] = waypoints[s], [bx, bz] = waypoints[s + 1];
        const segLen = Math.hypot(bx - ax, bz - az) || 1;
        const steps = Math.max(1, Math.floor(segLen / step));
        for (let k = (s > 0 ? 1 : 0); k <= steps; k++) { const tt = k / steps; cl.push([ax + (bx - ax) * tt, az + (bz - az) * tt]); }
      }
      const positions = [], indices = [];
      for (let i = 0; i < cl.length; i++) {
        const p = cl[i], a = cl[Math.max(0, i - 1)], b = cl[Math.min(cl.length - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const px = -dz, pz = dx;
        const lx = p[0] + px * half, lz = p[1] + pz * half;
        const rx = p[0] - px * half, rz = p[1] - pz * half;
        positions.push(lx, H(lx, lz) + 0.15, lz, rx, H(rx, rz) + 0.15, rz);
      }
      for (let i = 0; i < cl.length - 1; i++) { const a = i * 2, b = i * 2 + 1, cc = (i + 1) * 2, d = (i + 1) * 2 + 1; indices.push(a, cc, b, b, cc, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices); g.computeVertexNormals();
      const road = new THREE.Mesh(g, roadMat);
      road.receiveShadow = true; grp.add(road);
    };
    for (const road of is.roads) buildRoad(road);
  }

  // ---- Bridges (suspension): deck + towers + sagging main cables + hangers ----
  {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b6f74, flatShading: true, roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x484c50, flatShading: true });
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x55585d, flatShading: true });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x8a6f63, flatShading: true, roughness: 0.9 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.5 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.7 });
    const deckY = 16, towerH = 34, halfW = 14;
    for (const bz of is.bridges) {
      const cx = RC(bz);
      const span = (is.river.outer + 70) * 2;
      const half = span / 2, inner = is.river.inner, top = deckY + towerH;
      // roadway deck + painted centreline
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 3, 30), deckMat);
      deck.position.set(cx, deckY, bz); deck.castShadow = deck.receiveShadow = true; grp.add(deck);
      const line = new THREE.Mesh(new THREE.BoxGeometry(span, 0.2, 1.2), lineMat);
      line.position.set(cx, deckY + 1.65, bz); grp.add(line);
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 2, 1.2), railMat);
        rail.position.set(cx, deckY + 2.4, bz + s * halfW); grp.add(rail);
      }
      // two towers (paired legs + crossbeam) standing on pier footings
      for (const tx of [cx - inner, cx + inner]) {
        for (const s of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(4, towerH + 8, 4), towerMat);
          leg.position.set(tx, deckY - 4 + (towerH + 8) / 2, bz + s * halfW);
          leg.castShadow = true; grp.add(leg);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 2 * halfW + 4), towerMat);
        beam.position.set(tx, top, bz); grp.add(beam);
        const ph = deckY - is.river.bed + 6;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(10, ph, 2 * halfW + 6), pierMat);
        pier.position.set(tx, deckY - ph / 2, bz); pier.castShadow = true; grp.add(pier);
      }
      // main cables (sag between the towers, anchored at the deck ends) + hangers
      for (const s of [-1, 1]) {
        const z = bz + s * halfW;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(cx - half, deckY + 2, z),
          new THREE.Vector3(cx - inner, top, z),
          new THREE.Vector3(cx, deckY + 6, z),
          new THREE.Vector3(cx + inner, top, z),
          new THREE.Vector3(cx + half, deckY + 2, z),
        ]);
        grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.6, 6, false), cableMat));
        const N = 9;
        for (let i = 1; i < N; i++) {
          const xx = cx - inner + (2 * inner) * (i / N);
          const tn = (xx - cx) / inner;
          const cy = top - (top - (deckY + 6)) * (1 - tn * tn); // parabola matching the cable
          const hh = cy - (deckY + 1.6);
          if (hh < 1) continue;
          const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, hh, 5), cableMat);
          hanger.position.set(xx, deckY + 1.6 + hh / 2, z); grp.add(hanger);
        }
      }
    }
  }

  return { group: grp, terrain };
}
