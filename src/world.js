import * as THREE from "three";

// Low-poly arcade world: rolling terrain, runway, scattered landmarks, sky.

const TERRAIN_SIZE = 24000;
const SEGMENTS = 160;

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

// Winding river centerline: x as a function of z.
const RIVER_BED = -14;
const RIVER_SURFACE = -9;
const RIVER_INNER = 140;  // full-depth half-width
const RIVER_OUTER = 440;  // banks blend out to here
export function riverCenterX(z) {
  return 2200 * Math.sin(z * 0.00026) + 700 * Math.sin(z * 0.00091 + 1.3);
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
  const isl = THREE.MathUtils.smoothstep(d, 7000, 9800);
  h = THREE.MathUtils.lerp(h, -750, isl);
  // Flatten a region around the origin for a runway / spawn.
  if (d < 1400) {
    const t = THREE.MathUtils.clamp((d - 600) / 800, 0, 1);
    h = THREE.MathUtils.lerp(0, h, t);
  }
  // Carve the river valley (island interior only).
  if (d < 7800) {
    const rd = Math.abs(x - riverCenterX(z));
    if (rd < RIVER_OUTER) {
      const t = THREE.MathUtils.smoothstep(rd, RIVER_INNER, RIVER_OUTER);
      h = THREE.MathUtils.lerp(RIVER_BED, h, t);
    }
  }
  return h;
}

// Sea surface and the two carriers.
export const SEA_LEVEL = -180;
const DECK_Y = SEA_LEVEL + 24;
export const CARRIERS = [
  { team: "ally", x: -1200, z: 11200, halfL: 170, halfW: 36, deckY: DECK_Y },
  { team: "enemy", x: 1200, z: -12800, halfL: 170, halfW: 36, deckY: DECK_Y },
];

// Ground height including carrier decks — used for collision / takeoff.
export function groundHeightAt(x, z) {
  let g = terrainHeight(x, z);
  for (const c of CARRIERS) {
    if (Math.abs(x - c.x) < c.halfW && Math.abs(z - c.z) < c.halfL) g = Math.max(g, c.deckY);
  }
  return g;
}

function buildCarrier(scene, c) {
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
  scene.add(g);
  return g;
}

export function buildWorld(scene) {
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
  const low = new THREE.Color(0x3f6b3a);
  const mid = new THREE.Color(0x6f7d4a);
  const high = new THREE.Color(0x9a9a8e);
  const snow = new THREE.Color(0xeef2f5);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const t = THREE.MathUtils.clamp((h + 200) / 1400, 0, 1);
    const c = new THREE.Color();
    if (t < 0.45) c.copy(low).lerp(mid, t / 0.45);
    else if (t < 0.8) c.copy(mid).lerp(high, (t - 0.45) / 0.35);
    else c.copy(high).lerp(snow, (t - 0.8) / 0.2);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })
  );
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Water plane at sea level
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5),
    new THREE.MeshStandardMaterial({ color: 0x21506e, transparent: true, opacity: 0.86, roughness: 0.3, metalness: 0.4 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  scene.add(water);

  // Carriers out in the ocean (one each side of the island).
  for (const c of CARRIERS) buildCarrier(scene, c);

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

  // Scatter landmarks: hangars (boxes) and radio towers (thin cones).
  const rng = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
  const r = rng(7);
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, flatShading: true, roughness: 0.8 });
  for (let i = 0; i < 60; i++) {
    const x = (r() - 0.5) * TERRAIN_SIZE * 0.8;
    const z = (r() - 0.5) * TERRAIN_SIZE * 0.8;
    const gy = terrainHeight(x, z);
    if (gy < -100) continue; // not in the sea
    if (r() < 0.5) {
      const w = 30 + r() * 60, hh = 20 + r() * 40, d = 30 + r() * 60;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), hangarMat);
      m.position.set(x, gy + hh / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    } else {
      const h = 60 + r() * 140;
      const t = new THREE.Mesh(
        new THREE.ConeGeometry(6, h, 6),
        new THREE.MeshStandardMaterial({ color: 0xd24b4b, flatShading: true })
      );
      t.position.set(x, gy + h / 2, z);
      t.castShadow = true;
      scene.add(t);
    }
  }

  // ---- River surface: a translucent ribbon following the carved valley ----
  {
    const z0 = -6800, z1 = 6800, step = 300, half = 150;
    const positions = [], indices = [];
    let rows = 0;
    for (let z = z0; z <= z1; z += step) {
      const cx = riverCenterX(z);
      positions.push(cx - half, RIVER_SURFACE, z, cx + half, RIVER_SURFACE, z);
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
    const river = new THREE.Mesh(
      rgeo,
      new THREE.MeshStandardMaterial({ color: 0x2f6f8c, transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.5 })
    );
    river.receiveShadow = true;
    scene.add(river);
  }

  const rnd = mulberry32(0x1f2e3d);
  const m4 = new THREE.Matrix4();
  const noRot = new THREE.Quaternion();
  const tp = new THREE.Vector3();
  const ts = new THREE.Vector3();
  const onRiver = (x, z) => Math.abs(x - riverCenterX(z)) < RIVER_OUTER + 60;

  // ---- Trees (instanced): trunks + conifer foliage on lowland ----
  {
    const COUNT = 1700;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.7, 1.0, 7, 5),
      new THREE.MeshStandardMaterial({ color: 0x5b4326, flatShading: true, roughness: 1 }),
      COUNT
    );
    const foliage = new THREE.InstancedMesh(
      new THREE.ConeGeometry(4.6, 13, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f6d34, flatShading: true, roughness: 1 }),
      COUNT
    );
    let n = 0, guard = 0;
    while (n < COUNT && guard < COUNT * 8) {
      guard++;
      const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.85;
      const h = terrainHeight(x, z);
      if (h < -10 || h > 620 || onRiver(x, z)) continue;
      const s = 1.2 + rnd() * 1.8;
      tp.set(x, h + 3.5 * s, z); ts.set(s, s, s);
      trunks.setMatrixAt(n, m4.compose(tp, noRot, ts));
      tp.set(x, h + 13.5 * s, z);
      foliage.setMatrixAt(n, m4.compose(tp, noRot, ts));
      n++;
    }
    trunks.count = n; foliage.count = n;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    trunks.receiveShadow = foliage.receiveShadow = true;
    scene.add(trunks); scene.add(foliage);
  }

  // ---- Town clusters (instanced boxes) ----
  {
    const MAX = 200;
    const buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8b9098, flatShading: true, roughness: 0.85 }),
      MAX
    );
    buildings.castShadow = true; buildings.receiveShadow = true;
    const towns = [[3200, -3500], [-4200, 2600], [1600, 5200]];
    let n = 0;
    for (const [cx, cz] of towns) {
      for (let gx = -2; gx <= 2 && n < MAX; gx++) {
        for (let gz = -2; gz <= 2 && n < MAX; gz++) {
          const x = cx + gx * 115 + (rnd() - 0.5) * 36;
          const z = cz + gz * 115 + (rnd() - 0.5) * 36;
          const h = terrainHeight(x, z);
          if (h < -10 || onRiver(x, z)) continue;
          const bh = 30 + rnd() * 150, bw = 26 + rnd() * 26, bd = 26 + rnd() * 26;
          tp.set(x, h + bh / 2, z); ts.set(bw, bh, bd);
          buildings.setMatrixAt(n, m4.compose(tp, noRot, ts));
          n++;
        }
      }
    }
    buildings.count = n;
    buildings.instanceMatrix.needsUpdate = true;
    scene.add(buildings);
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

  // Floating ring checkpoints to give the player something to chase.
  const rings = [];
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b5a10, flatShading: true });
  const ringPath = [
    [0, 1200, -3000], [2500, 1600, -6000], [5000, 2200, -3000],
    [3000, 1800, 2000], [-2000, 2400, 4000], [-5000, 1700, 0],
  ];
  for (const [x, y, z] of ringPath) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 14, 8, 24), ringMat);
    ring.position.set(x, y, z);
    ring.lookAt(0, y, 0);
    scene.add(ring);
    rings.push(ring);
  }

  return { terrain, rings, sun, clouds };
}
