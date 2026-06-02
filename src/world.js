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

// Public height sampler used for terrain mesh + ground collision.
export function terrainHeight(x, z) {
  const f = 0.00035;
  let h = 0;
  h += smoothNoise(x * f, z * f) * 900;
  h += smoothNoise(x * f * 3.1, z * f * 3.1) * 260;
  h += smoothNoise(x * f * 8.0, z * f * 8.0) * 70;
  h -= 600; // sink the baseline so there's lowland and ridges
  // Flatten a region around the origin for a runway / spawn.
  const d = Math.sqrt(x * x + z * z);
  if (d < 1400) {
    const t = THREE.MathUtils.clamp((d - 600) / 800, 0, 1);
    h = THREE.MathUtils.lerp(0, h, t);
  }
  return h;
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
  water.position.y = -180;
  scene.add(water);

  // Runway near spawn
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 1200),
    new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, terrainHeight(0, 0) + 0.5, 0);
  scene.add(runway);

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

  return { terrain, rings, sun };
}
