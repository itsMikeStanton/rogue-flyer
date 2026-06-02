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
    maxThrust: 130000,
    wingArea: 28,
    cl0: 0.08, clAlpha: 5.2, clMax: 1.35, stallAngle: 0.26,
    cd0: 0.020, k: 0.10,
    pitchRate: 1.9, rollRate: 4.2, yawRate: 0.7,
    // relative stat bars for the menu (0..1)
    stats: { speed: 0.85, agility: 0.95, toughness: 0.45 },
  },
  fa18: {
    name: "F/A-18 Hornet",
    role: "All-round multirole",
    color: 0x9aa7b3,
    mass: 11000,
    maxThrust: 140000,
    wingArea: 38,
    cl0: 0.10, clAlpha: 5.0, clMax: 1.45, stallAngle: 0.30,
    cd0: 0.022, k: 0.11,
    pitchRate: 1.7, rollRate: 3.6, yawRate: 0.7,
    stats: { speed: 0.75, agility: 0.8, toughness: 0.65 },
  },
  a10: {
    name: "A-10 Warthog",
    role: "Heavy ground-attack",
    color: 0x6f7a5e,
    mass: 14000,
    maxThrust: 80000,
    wingArea: 47,
    cl0: 0.14, clAlpha: 4.8, clMax: 1.6, stallAngle: 0.34,
    cd0: 0.028, k: 0.12,
    pitchRate: 1.2, rollRate: 2.4, yawRate: 0.6,
    stats: { speed: 0.4, agility: 0.5, toughness: 1.0 },
  },
};

// Build a chunky low-poly jet from primitives. Faceted, flat-shaded, arcade.
export function buildAircraftMesh(type) {
  const def = AIRCRAFT[type];
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: def.color, flatShading: true, metalness: 0.3, roughness: 0.65,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x2b3138, flatShading: true, metalness: 0.4, roughness: 0.6,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x111a22, flatShading: true, metalness: 0.1, roughness: 0.2,
    emissive: 0x0a1a24, transparent: true, opacity: 0.9,
  });

  // Forward is -Z (Three.js convention used throughout the flight model).
  // Fuselage: tapered, nose forward.
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 7, 8), body);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 8), body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.6;
  group.add(nose);

  // Canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.9, 0.7, 1.8);
  canopy.position.set(0, 0.35, -1.8);
  group.add(canopy);

  // Main wings (swept). Slight dihedral varies per role via wingArea feel.
  const wingGeo = new THREE.BoxGeometry(9, 0.18, 2.6);
  const wing = new THREE.Mesh(wingGeo, body);
  wing.position.z = 0.6;
  wing.rotation.y = 0; // keep square; sweep faked by tail boxes
  group.add(wing);

  // Wing tips angled up a touch
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 2.0), accent);
  tipL.position.set(-4.0, 0.1, 0.7);
  group.add(tipL);
  const tipR = tipL.clone(); tipR.position.x = 4.0; group.add(tipR);

  // Horizontal stabilizers
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 1.4), body);
  hstab.position.z = 3.0;
  group.add(hstab);

  // Vertical tail
  const vtail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.8, 1.6), body);
  vtail.position.set(0, 0.9, 3.1);
  group.add(vtail);

  // Engine nozzle + glow
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.8, 8), accent);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 3.6;
  group.add(nozzle);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 2.4, 8),
    new THREE.MeshBasicMaterial({ color: 0x7fd2ff, transparent: true, opacity: 0.0 })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 5.0;
  flame.name = "afterburner";
  group.add(flame);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return group;
}
