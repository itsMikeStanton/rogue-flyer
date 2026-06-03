import * as THREE from "three";
import { defaultWorldConfig } from "./worldConfig.js";

// Low-poly arcade world, driven by an editable config (see worldConfig.js).

const TERRAIN_SIZE = 24000;
const SEGMENTS = 200;

// Active world config. Loaded from a localStorage override if present so the
// in-browser editor can iterate; otherwise the built-in default.
let CFG = defaultWorldConfig();
try {
  const saved = typeof localStorage !== "undefined" && localStorage.getItem("rogueflyer.world");
  if (saved) CFG = { ...CFG, ...JSON.parse(saved) };
} catch (_) { /* ignore */ }

export function setWorldConfig(cfg) { CFG = cfg; }
export function getWorldConfig() { return CFG; }
export function getCarriers() { return CFG.carriers.map((c) => ({ ...c, deckY: CFG.seaLevel + 24 })); }
export function getMissionBases() { return CFG.missionBases; }

// Paintable tree-cover grid (0..1). When the config has none, derive a default
// from the same noise the old procedural forests used, so the world looks the
// same until someone paints. The editor mutates this array in place.
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
export function getForestDensity() {
  const f = CFG.forest;
  if (!f.density) f.density = defaultForestDensity(f.gridN, f.extent);
  return f.density;
}
function forestDensityAt(x, z) {
  const f = CFG.forest, g = f.gridN, e = f.extent, d = getForestDensity();
  const i = Math.round(THREE.MathUtils.clamp((x / (2 * e) + 0.5) * (g - 1), 0, g - 1));
  const j = Math.round(THREE.MathUtils.clamp((z / (2 * e) + 0.5) * (g - 1), 0, g - 1));
  return d[j * g + i];
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

// Winding river centerline: x as a function of z (from config).
export function riverCenterX(z) {
  const r = CFG.river;
  return r.a1 * Math.sin(z * r.f1) + r.a2 * Math.sin(z * r.f2 + r.phase);
}

// Public height sampler used for terrain mesh + ground collision.
export function terrainHeight(x, z) {
  const f = 0.00035;
  let h = 0;
  h += smoothNoise(x * f, z * f) * 900;
  h += smoothNoise(x * f * 3.1, z * f * 3.1) * 260;
  h += smoothNoise(x * f * 8.0, z * f * 8.0) * 70;
  h -= 600; // sink the baseline so there's lowland and ridges
  const d = Math.sqrt(x * x + z * z);
  // Island: beyond the shore, the land falls away to the ocean floor.
  const isl = THREE.MathUtils.smoothstep(d, CFG.terrain.islandInner, CFG.terrain.islandOuter);
  h = THREE.MathUtils.lerp(h, CFG.terrain.deep, isl);
  // Coastal cliff: raise a plateau with a short (steep) transition = cliff faces.
  const cf = CFG.cliff;
  const cdist = Math.hypot(x - cf.x, z - cf.z);
  if (cdist < cf.r + 230) {
    const t = THREE.MathUtils.smoothstep(cdist, cf.r, cf.r + 230);
    h = THREE.MathUtils.lerp(cf.h, h, t);
  }
  // Flatten a region around the origin for a runway / spawn.
  if (d < CFG.spawn.flattenRadius) {
    const t = THREE.MathUtils.clamp((d - 600) / 800, 0, 1);
    h = THREE.MathUtils.lerp(0, h, t);
  }
  // Carve the river valley (island interior only).
  const rv = CFG.river;
  if (d < rv.carveMax) {
    const rd = Math.abs(x - riverCenterX(z));
    if (rd < rv.outer) {
      const t = THREE.MathUtils.smoothstep(rd, rv.inner, rv.outer);
      h = THREE.MathUtils.lerp(rv.bed, h, t);
    }
  }
  return h;
}

// Sea surface (fixed) — carriers come from config via getCarriers().
export const SEA_LEVEL = defaultWorldConfig().seaLevel;

// Ground height including carrier decks — used for collision / takeoff.
export function groundHeightAt(x, z) {
  let g = terrainHeight(x, z);
  const deckY = CFG.seaLevel + 24;
  for (const c of CFG.carriers) {
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
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.25, metalness: 0.5,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n  transformed.y += sin(transformed.x * 0.004 + uTime) * 3.0 + sin(transformed.z * 0.0055 + uTime * 0.8) * 2.5;"
    );
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
  t.repeat.set(2, 3); e.repeat.set(2, 3);
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

  // Terrain mesh
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const sand = new THREE.Color(0xcdbd87);
  const low = new THREE.Color(0x3f6b3a);
  const mid = new THREE.Color(0x6f7d4a);
  const high = new THREE.Color(0x9a9a8e);
  const snow = new THREE.Color(0xeef2f5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    if (h < 45) {
      // beach near the waterline blending up into grass
      const s = THREE.MathUtils.clamp((h + 12) / 57, 0, 1);
      c.copy(sand).lerp(low, s);
    } else {
      const t = THREE.MathUtils.clamp((h + 200) / 1400, 0, 1);
      if (t < 0.45) c.copy(low).lerp(mid, t / 0.45);
      else if (t < 0.8) c.copy(mid).lerp(high, (t - 0.45) / 0.35);
      else c.copy(high).lerp(snow, (t - 0.8) / 0.2);
    }
    // subtle per-vertex variation so it isn't flat
    const j = (hash2(x * 0.05, z * 0.05) - 0.5) * 0.06;
    colors.push(
      THREE.MathUtils.clamp(c.r + j, 0, 1),
      THREE.MathUtils.clamp(c.g + j, 0, 1),
      THREE.MathUtils.clamp(c.b + j, 0, 1)
    );
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })
  );
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Water plane at sea level — segmented for gentle wave animation
  const wgeo = new THREE.PlaneGeometry(TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5, 140, 140);
  wgeo.rotateX(-Math.PI / 2);
  const waterMat = waveMaterial(0x21506e, 0.9);
  const water = new THREE.Mesh(wgeo, waterMat);
  water.position.y = SEA_LEVEL;
  scene.add(water);
  waveMats.push(waterMat);

  // Carriers out in the ocean (one each side of the island).
  const carriers = {};
  for (const c of getCarriers()) carriers[c.team] = buildCarrier(scene, c);

  // Runway near spawn
  const ry = terrainHeight(0, 0);
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 1200),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, ry + 0.5, 0);
  runway.receiveShadow = true;
  scene.add(runway);

  // Painted markings (white), laid just above the asphalt.
  const paint = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.7 });
  const mark = (w, l, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), paint);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, ry + 0.65, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  // Dashed centerline
  for (let z = -540; z <= 540; z += 60) mark(1.6, 30, 0, z);
  // Edge lines
  mark(1.4, 1170, -37, 0);
  mark(1.4, 1170, 37, 0);
  // Threshold "piano keys" at both ends
  for (const ze of [-585, 585]) {
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      mark(4, 26, i * 8, ze);
    }
  }
  // Aiming-point blocks near each end
  for (const za of [-380, 380]) {
    mark(6, 42, -10, za);
    mark(6, 42, 10, za);
  }

  // ---- River surface: a translucent ribbon following the carved valley ----
  {
    const z0 = -CFG.river.extent, z1 = CFG.river.extent, step = 300, half = 150;
    const surf = CFG.river.surface;
    const positions = [], indices = [];
    let rows = 0;
    for (let z = z0; z <= z1; z += step) {
      const cx = riverCenterX(z);
      positions.push(cx - half, surf, z, cx + half, surf, z);
      rows++;
    }
    for (let i = 0; i < rows - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    rgeo.setIndex(indices);
    rgeo.computeVertexNormals();
    const riverMat = waveMaterial(0x2f6f8c, 0.85);
    const river = new THREE.Mesh(rgeo, riverMat);
    river.receiveShadow = true;
    scene.add(river);
    waveMats.push(riverMat);
  }

  const rnd = mulberry32(0x1f2e3d);
  const m4 = new THREE.Matrix4();
  const noRot = new THREE.Quaternion();
  const tp = new THREE.Vector3();
  const ts = new THREE.Vector3();
  const onRiver = (x, z) => Math.abs(x - riverCenterX(z)) < CFG.river.outer + 60;

  // ---- Forests: dense clustered conifers + deciduous trees on lowland ----
  {
    const MAX = CFG.forest.maxTrees;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.7, 1.0, 7, 5),
      new THREE.MeshStandardMaterial({ color: 0x5b4326, flatShading: true, roughness: 1 }), MAX);
    const conifer = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4.6, 13, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f6d34, flatShading: true, roughness: 1 }), MAX);
    const decid = new THREE.InstancedMesh(
      new THREE.SphereGeometry(5.5, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x4f7d3a, flatShading: true, roughness: 1 }), MAX);
    let n = 0, ci = 0, di = 0, guard = 0;
    while (n < MAX && guard < MAX * 10) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const h = terrainHeight(x, z);
      if (h < 8 || h > 760 || onRiver(x, z)) continue;
      // Painted tree-cover decides whether a candidate sprouts.
      const dens = forestDensityAt(x, z);
      if (dens <= 0.02 || rnd() > dens) continue;
      const s = 1.0 + rnd() * 1.8;
      tp.set(x, h + 3.5 * s, z); ts.set(s, s, s);
      trunks.setMatrixAt(n, m4.compose(tp, noRot, ts));
      if (rnd() < 0.6) {
        tp.set(x, h + 13.5 * s, z); ts.set(s, s, s);
        conifer.setMatrixAt(ci++, m4.compose(tp, noRot, ts));
      } else {
        tp.set(x, h + 9 * s, z); ts.set(s * 1.1, s * 0.95, s * 1.1);
        decid.setMatrixAt(di++, m4.compose(tp, noRot, ts));
      }
      n++;
    }
    trunks.count = n; conifer.count = ci; decid.count = di;
    trunks.instanceMatrix.needsUpdate = true;
    conifer.instanceMatrix.needsUpdate = true;
    decid.instanceMatrix.needsUpdate = true;
    trunks.receiveShadow = conifer.receiveShadow = decid.receiveShadow = true;
    scene.add(trunks); scene.add(conifer); scene.add(decid);
  }

  // ---- Bushes / shrubs scattered on lowland ----
  {
    const MAX = 900;
    const bush = new THREE.InstancedMesh(
      new THREE.SphereGeometry(2.2, 5, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a6b32, flatShading: true, roughness: 1 }), MAX);
    let n = 0, guard = 0;
    while (n < MAX && guard < MAX * 8) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const h = terrainHeight(x, z);
      if (h < 6 || h > 520 || onRiver(x, z)) continue;
      if (rnd() > forestDensityAt(x, z)) continue; // shrubs follow the painted cover too
      const s = 0.8 + rnd() * 1.6;
      tp.set(x, h + 1.6 * s, z); ts.set(s * 1.4, s, s * 1.4);
      bush.setMatrixAt(n++, m4.compose(tp, noRot, ts));
    }
    bush.count = n; bush.instanceMatrix.needsUpdate = true;
    scene.add(bush);
  }

  // ---- Rocks on the higher slopes ----
  {
    const MAX = 500;
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x7c7d80, flatShading: true, roughness: 1 }), MAX);
    rocks.castShadow = true; rocks.receiveShadow = true;
    const rq = new THREE.Quaternion(), re = new THREE.Euler();
    let n = 0, guard = 0;
    while (n < MAX && guard < MAX * 10) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.8;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.8;
      const h = terrainHeight(x, z);
      if (h < 120) continue;
      const s = 4 + rnd() * 16;
      re.set(rnd() * 3, rnd() * 3, rnd() * 3); rq.setFromEuler(re);
      tp.set(x, h + s * 0.4, z); ts.set(s, s * 0.7, s * 0.9);
      rocks.setMatrixAt(n++, m4.compose(tp, rq, ts));
    }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true;
    scene.add(rocks);
  }

  // ---- Settlements: cities, towns, villages (instanced w/ roofs + colliders) ----
  const colliders = [];
  const settlements = CFG.settlements.map((s) => [s.x, s.z, s.radius, s.spacing, s.maxHeight]);
  {
    const MAX = 900;
    const win = makeWindowTextures();
    const wallMat = new THREE.MeshStandardMaterial({
      map: win.map, emissive: 0xffcf86, emissiveMap: win.emissiveMap, emissiveIntensity: 0.9, roughness: 0.8,
    });
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, MAX);
    const roofMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), roofMat, MAX);
    buildings.castShadow = buildings.receiveShadow = true;
    roofs.castShadow = true;
    const wallTones = [0x8b9098, 0x9a9388, 0x7d8a93, 0xa3a097, 0x6f7a82];
    const roofTones = [0x5a3b34, 0x40474d, 0x6b5a3a, 0x3a4148];
    const tmpCol = new THREE.Color();
    let n = 0;
    for (const [cx, cz, gr, sp, mh] of settlements) {
      for (let gx = -gr; gx <= gr && n < MAX; gx++) {
        for (let gz = -gr; gz <= gr && n < MAX; gz++) {
          if (rnd() < 0.12) continue; // a few empty lots
          const x = cx + gx * sp + (rnd() - 0.5) * 40;
          const z = cz + gz * sp + (rnd() - 0.5) * 40;
          const h = terrainHeight(x, z);
          if (h < 4 || onRiver(x, z)) continue;
          const edge = Math.max(Math.abs(gx), Math.abs(gz));
          const bh = 18 + rnd() * mh * (1 - edge / (gr + 1.5)); // taller toward center
          const bw = 22 + rnd() * 26, bd = 22 + rnd() * 26;
          tp.set(x, h + bh / 2, z); ts.set(bw, bh, bd);
          buildings.setMatrixAt(n, m4.compose(tp, noRot, ts));
          buildings.setColorAt(n, tmpCol.setHex(wallTones[(rnd() * wallTones.length) | 0]));
          tp.set(x, h + bh + 1.2, z); ts.set(bw + 3, 2.4, bd + 3);
          roofs.setMatrixAt(n, m4.compose(tp, noRot, ts));
          roofs.setColorAt(n, tmpCol.setHex(roofTones[(rnd() * roofTones.length) | 0]));
          colliders.push({ x, z, hx: bw / 2 + 1, hz: bd / 2 + 1, top: h + bh });
          n++;
        }
      }
    }
    buildings.count = n; roofs.count = n;
    buildings.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    buildings.instanceColor.needsUpdate = true;
    roofs.instanceColor.needsUpdate = true;
    scene.add(buildings); scene.add(roofs);
  }

  // ---- Roads painted onto the terrain between key places ----
  {
    // polygonOffset lets the ribbon render flush on the ground without z-fighting.
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x3a3d42, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const buildRoad = (waypoints) => {
      if (waypoints.length < 2) return;
      const half = 9, step = 45;
      // Resample the whole polyline into one continuous centerline so the ribbon
      // has no per-segment seams at the corners.
      const cl = [];
      for (let s = 0; s < waypoints.length - 1; s++) {
        const [ax, az] = waypoints[s], [bx, bz] = waypoints[s + 1];
        const segLen = Math.hypot(bx - ax, bz - az) || 1;
        const steps = Math.max(1, Math.floor(segLen / step));
        for (let k = (s > 0 ? 1 : 0); k <= steps; k++) {
          const tt = k / steps;
          cl.push([ax + (bx - ax) * tt, az + (bz - az) * tt]);
        }
      }
      const positions = [], indices = [];
      for (let i = 0; i < cl.length; i++) {
        // Mitre each point using the averaged tangent of its neighbours.
        const p = cl[i], a = cl[Math.max(0, i - 1)], b = cl[Math.min(cl.length - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const px = -dz, pz = dx;
        const lx = p[0] + px * half, lz = p[1] + pz * half;
        const rx = p[0] - px * half, rz = p[1] - pz * half;
        // Sample terrain at each edge so the ribbon hugs the slope (painted on).
        positions.push(lx, terrainHeight(lx, lz) + 0.15, lz, rx, terrainHeight(rx, rz) + 0.15, rz);
      }
      for (let i = 0; i < cl.length - 1; i++) {
        const a = i * 2, b = i * 2 + 1, cc = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, cc, b, b, cc, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices); g.computeVertexNormals();
      const road = new THREE.Mesh(g, roadMat);
      road.receiveShadow = true; scene.add(road);
    };
    for (const road of CFG.roads) buildRoad(road);
  }

  // ---- Two bridges over the river ----
  {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b6f74, flatShading: true, roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x484c50, flatShading: true });
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x55585d, flatShading: true });
    const deckY = 16;
    for (const bz of CFG.bridges) {
      const cx = riverCenterX(bz);
      const span = (CFG.river.outer + 70) * 2;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 3, 30), deckMat);
      deck.position.set(cx, deckY, bz);
      deck.castShadow = deck.receiveShadow = true;
      scene.add(deck);
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 2, 1.6), railMat);
        rail.position.set(cx, deckY + 2.4, bz + s * 14);
        scene.add(rail);
      }
      for (const px of [cx - CFG.river.inner, cx + CFG.river.inner]) {
        const ph = deckY - CFG.river.bed + 6;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(9, ph, 9), pierMat);
        pier.position.set(px, deckY - ph / 2, bz);
        pier.castShadow = true; scene.add(pier);
      }
    }
  }

  // ---- Clouds (instanced flattened puffs at altitude) ----
  let clouds;
  {
    const MAX = 430;
    clouds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1, emissive: 0x6378a0, emissiveIntensity: 0.18 }),
      MAX
    );
    clouds.castShadow = false;
    let n = 0;
    for (let c = 0; c < 58 && n < MAX; c++) {
      const cx = (rnd() - 0.5) * TERRAIN_SIZE * 0.9;
      const cz = (rnd() - 0.5) * TERRAIN_SIZE * 0.9;
      const cy = 1400 + rnd() * 2300;
      const puffs = 4 + Math.floor(rnd() * 5);
      for (let p = 0; p < puffs && n < MAX; p++) {
        tp.set(cx + (rnd() - 0.5) * 260, cy + (rnd() - 0.5) * 55, cz + (rnd() - 0.5) * 260);
        ts.set(70 + rnd() * 95, 32 + rnd() * 30, 70 + rnd() * 95);
        clouds.setMatrixAt(n, m4.compose(tp, noRot, ts));
        n++;
      }
    }
    clouds.count = n;
    clouds.instanceMatrix.needsUpdate = true;
    scene.add(clouds);
  }

  // No ring checkpoints (removed) — modes provide their own objectives.
  const rings = [];

  return { terrain, rings, sun, clouds, carriers, colliders, waveMats };
}
