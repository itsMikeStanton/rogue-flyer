import * as THREE from "three";

// Arcade-plus aircraft definitions.
// Physical-ish numbers (SI) tuned for fun rather than fidelity.
//   mass         kg
//   maxThrust    N (afterburner-ish peak)
//   wingArea     m^2
//   cl0/clAlpha  base lift coeff + lift-curve slope (per radian of AoA)
//   clMax        peak lift coeff before stall
//   stallAngle   rad, AoA where lift starts to break down
//   cd0/k        parasitic drag + induced-drag factor (Cd = cd0 + k*Cl^2)
//   pitch/roll/yawRate  max commanded body rates (rad/s) at full control authority
export const AIRCRAFT = {
  f16: {
    name: "F-16 Falcon",
    role: "Agile dogfighter",
    color: 0xb8c4cf,
    mass: 9000,
    maxThrust: 165000,
    wingArea: 28,
    cl0: 0.08, clAlpha: 5.2, clMax: 1.55, stallAngle: 0.36,
    cd0: 0.020, k: 0.10,
    pitchRate: 1.25, rollRate: 2.7, yawRate: 0.55,
    stats: { speed: 0.85, agility: 0.95, toughness: 0.45 },
  },
  fa18: {
    name: "F/A-18 Hornet",
    role: "All-round multirole",
    color: 0x9aa7b3,
    mass: 11000,
    maxThrust: 178000,
    wingArea: 38,
    cl0: 0.10, clAlpha: 5.0, clMax: 1.6, stallAngle: 0.40,
    cd0: 0.022, k: 0.11,
    pitchRate: 1.1, rollRate: 2.3, yawRate: 0.55,
    stats: { speed: 0.75, agility: 0.8, toughness: 0.65 },
  },
  a10: {
    name: "A-10 Warthog",
    role: "Heavy ground-attack",
    color: 0x6f7a5e,
    mass: 14000,
    maxThrust: 108000,
    wingArea: 47,
    cl0: 0.14, clAlpha: 4.8, clMax: 1.75, stallAngle: 0.44,
    cd0: 0.028, k: 0.12,
    pitchRate: 0.85, rollRate: 1.7, yawRate: 0.5,
    stats: { speed: 0.4, agility: 0.5, toughness: 1.0 },
  },
};

function makeMaterials(def) {
  return {
    body: new THREE.MeshStandardMaterial({ color: def.color, flatShading: true, metalness: 0.3, roughness: 0.65 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x2b3138, flatShading: true, metalness: 0.4, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x111a22, flatShading: true, metalness: 0.1, roughness: 0.2, emissive: 0x0a1a24, transparent: true, opacity: 0.9 }),
  };
}

// A backward-pointing afterburner cone (hidden until throttled up).
function makeFlame(base = 1) {
  const fl = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 2.4, 8),
    new THREE.MeshBasicMaterial({ color: 0x7fd2ff, transparent: true, opacity: 0 })
  );
  fl.rotation.x = -Math.PI / 2; // tip points +Z (aft)
  fl.scale.setScalar(base);
  fl.userData.base = base;
  return fl;
}

function makeCanopy(glass, z, sx, sy, sz) {
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  c.scale.set(sx, sy, sz);
  c.position.set(0, 0.38, z);
  return c;
}

// ---- F-16: sleek, single engine, single tail, chin intake ----
function buildF16(def) {
  const g = new THREE.Group();
  const m = makeMaterials(def);

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.6, 7, 10), m.body);
  fuse.rotation.x = Math.PI / 2;
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.4, 10), m.body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.7;
  g.add(nose);

  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 1.9), m.accent);
  intake.position.set(0, -0.55, -1.0);
  g.add(intake);

  g.add(makeCanopy(m.glass, -1.9, 0.85, 0.8, 2.0));

  // cropped-delta wings
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.16, 2.4), m.body);
  wing.position.z = 0.9;
  g.add(wing);

  const hstab = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.14, 1.2), m.body);
  hstab.position.z = 3.0;
  g.add(hstab);

  const vtail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.0, 1.7), m.body);
  vtail.position.set(0, 1.0, 3.0);
  g.add(vtail);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.36, 0.9, 10), m.accent);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 3.7;
  g.add(nozzle);

  const fl = makeFlame(1);
  fl.position.z = 5.0;
  g.add(fl);
  g.userData.flames = [fl];
  return g;
}

// ---- F/A-18: twin canted tails, twin engines, broad LERX ----
function buildHornet(def) {
  const g = new THREE.Group();
  const m = makeMaterials(def);

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.9, 6.4), m.body);
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.6, 8), m.body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.3;
  g.add(nose);

  g.add(makeCanopy(m.glass, -1.7, 0.9, 0.85, 2.0));

  // leading-edge extensions (LERX) as flat triangles toward the nose
  for (const s of [-1, 1]) {
    const lerx = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 2.4), m.body);
    lerx.position.set(s * 0.9, 0.05, -1.0);
    g.add(lerx);
  }

  const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.16, 2.6), m.body);
  wing.position.z = 0.7;
  g.add(wing);

  // twin canted vertical tails
  for (const s of [-1, 1]) {
    const vt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 1.4), m.body);
    vt.position.set(s * 0.95, 0.85, 2.3);
    vt.rotation.z = s * 0.26;
    g.add(vt);
  }

  const hstab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 1.3), m.body);
  hstab.position.z = 3.1;
  g.add(hstab);

  // twin nozzles + flames
  g.userData.flames = [];
  for (const s of [-1, 1]) {
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.9, 8), m.accent);
    nz.rotation.x = Math.PI / 2;
    nz.position.set(s * 0.5, 0, 3.4);
    g.add(nz);
    const fl = makeFlame(0.8);
    fl.position.set(s * 0.5, 0, 4.6);
    g.add(fl);
    g.userData.flames.push(fl);
  }
  return g;
}

// ---- A-10: straight wings, twin pod engines high aft, twin tails, gun nose ----
function buildWarthog(def) {
  const g = new THREE.Group();
  const m = makeMaterials(def);

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 6.4, 12), m.body);
  fuse.rotation.x = Math.PI / 2;
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), m.body);
  nose.scale.z = 1.7;
  nose.position.z = -3.4;
  g.add(nose);

  // the famous gun barrel
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.0, 8), m.accent);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, -0.18, -4.4);
  g.add(gun);

  g.add(makeCanopy(m.glass, -2.0, 0.85, 0.85, 1.6));

  // long straight wings
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.22, 2.2), m.body);
  wing.position.z = 0.3;
  g.add(wing);

  // twin engine pods mounted high on the rear fuselage
  g.userData.flames = [];
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 12), m.accent);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(s * 1.15, 0.75, 2.1);
    g.add(nac);
    const fl = makeFlame(0.55);
    fl.position.set(s * 1.15, 0.75, 3.6);
    g.add(fl);
    g.userData.flames.push(fl);
  }

  // tailplane with twin vertical fins at the tips
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.18, 1.4), m.body);
  hstab.position.z = 3.4;
  g.add(hstab);
  for (const s of [-1, 1]) {
    const vt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 1.3), m.body);
    vt.position.set(s * 2.3, 0.7, 3.4);
    g.add(vt);
  }
  return g;
}

// Build the distinct low-poly mesh for a given aircraft type.
// `colorOverride` (optional) repaints the airframe — used for enemy jets.
export function buildAircraftMesh(type, colorOverride) {
  const base = AIRCRAFT[type] || AIRCRAFT.f16;
  const def = colorOverride != null ? { ...base, color: colorOverride } : base;
  let g;
  if (type === "a10") g = buildWarthog(def);
  else if (type === "fa18") g = buildHornet(def);
  else g = buildF16(def);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
