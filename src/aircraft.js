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
    loadout: { missiles: 6, rockets: 0, bombs: 4 },
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
    loadout: { missiles: 6, rockets: 0, bombs: 6 },
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
    loadout: { missiles: 2, rockets: 19, bombs: 6 },
    color: 0x6f7a5e,
    mass: 14000,
    maxThrust: 108000,
    wingArea: 47,
    cl0: 0.14, clAlpha: 4.8, clMax: 1.75, stallAngle: 0.44,
    cd0: 0.028, k: 0.12,
    pitchRate: 0.85, rollRate: 1.7, yawRate: 0.5,
    landing: { track: 2.2, mainZ: 0.5, noseZ: -2.8, legLen: 1.6, wheel: 0.5, bellyY: -0.45, flapX: 3.6, flapZ: 1.2, flapW: 3.0, flapC: 1.0, sbZ: 3.4 },
    stats: { speed: 0.4, agility: 0.5, toughness: 1.0 },
  },
  f15: {
    name: "F-15 Eagle",
    role: "Air-superiority fighter",
    loadout: { missiles: 8, rockets: 0, bombs: 0 },
    color: 0xb6bdc6,
    mass: 13000, maxThrust: 210000, wingArea: 56,
    cl0: 0.10, clAlpha: 5.0, clMax: 1.6, stallAngle: 0.40,
    cd0: 0.021, k: 0.10,
    pitchRate: 1.15, rollRate: 2.4, yawRate: 0.55,
    landing: { track: 1.8, mainZ: 1.0, noseZ: -3.2, legLen: 1.5, wheel: 0.5, bellyY: -0.4, flapX: 3.4, flapZ: 1.4, flapW: 3.0, sbZ: 2.8 },
    stats: { speed: 0.9, agility: 0.85, toughness: 0.6 },
  },
  f14: {
    name: "F-14 Tomcat",
    role: "Swing-wing interceptor",
    loadout: { missiles: 6, rockets: 0, bombs: 0 },
    color: 0x9aa3ad,
    mass: 16000, maxThrust: 220000, wingArea: 54,
    cl0: 0.10, clAlpha: 4.8, clMax: 1.6, stallAngle: 0.40,
    cd0: 0.024, k: 0.11,
    pitchRate: 1.0, rollRate: 2.1, yawRate: 0.55,
    landing: { track: 1.5, mainZ: 0.6, noseZ: -2.8, legLen: 1.4, wheel: 0.5, bellyY: -0.35, flapX: 2.4, flapZ: 1.6, flapW: 2.4 },
    stats: { speed: 0.85, agility: 0.7, toughness: 0.65 },
  },
  f22: {
    name: "F-22 Raptor",
    role: "Stealth air-dominance",
    loadout: { missiles: 8, rockets: 0, bombs: 0 },
    color: 0x4a525c,
    mass: 14000, maxThrust: 260000, wingArea: 50,
    cl0: 0.12, clAlpha: 5.4, clMax: 1.7, stallAngle: 0.46,
    cd0: 0.018, k: 0.09,
    pitchRate: 1.4, rollRate: 2.9, yawRate: 0.6,
    landing: { track: 1.7, mainZ: 1.0, noseZ: -3.0, legLen: 1.5, wheel: 0.5, bellyY: -0.4, flapX: 3.0, flapZ: 1.6, flapW: 2.6 },
    stats: { speed: 0.95, agility: 1.0, toughness: 0.6 },
  },
  mig29: {
    name: "MiG-29 Fulcrum",
    role: "Agile frontline fighter",
    loadout: { missiles: 6, rockets: 0, bombs: 0 },
    color: 0x8a96a6,
    mass: 11000, maxThrust: 162000, wingArea: 38,
    cl0: 0.10, clAlpha: 5.1, clMax: 1.65, stallAngle: 0.42,
    cd0: 0.022, k: 0.10,
    pitchRate: 1.2, rollRate: 2.6, yawRate: 0.55,
    landing: { track: 1.6, mainZ: 0.9, noseZ: -2.8, legLen: 1.4, wheel: 0.45, bellyY: -0.35, flapX: 2.8, flapZ: 1.5, flapW: 2.2 },
    stats: { speed: 0.8, agility: 0.9, toughness: 0.5 },
  },
  b2: {
    name: "B-2 Spirit",
    role: "Stealth flying-wing bomber",
    loadout: { missiles: 0, rockets: 0, bombs: 16 },
    color: 0x2b2f36,
    mass: 70000, maxThrust: 320000, wingArea: 230,
    cl0: 0.18, clAlpha: 4.6, clMax: 1.5, stallAngle: 0.34,
    cd0: 0.017, k: 0.06,
    pitchRate: 0.62, rollRate: 1.15, yawRate: 0.4,
    landing: { track: 2.2, mainZ: -1.0, noseZ: -4.6, legLen: 1.4, wheel: 0.6, bellyY: 0.1, flapX: 5.2, flapZ: 2.6, flapW: 3.6, flapC: 0.7, sbY: 0.85, sbZ: -1.0, sbW: 1.6, sbL: 2.0 },
    stats: { speed: 0.55, agility: 0.4, toughness: 0.85 },
  },
  b52: {
    name: "B-52 Stratofortress",
    role: "Heavy strategic bomber",
    loadout: { missiles: 0, rockets: 0, bombs: 24 },
    color: 0x5c6670,
    mass: 120000, maxThrust: 360000, wingArea: 380,
    cl0: 0.16, clAlpha: 4.6, clMax: 1.55, stallAngle: 0.36,
    cd0: 0.024, k: 0.07,
    pitchRate: 0.5, rollRate: 0.9, yawRate: 0.4,
    landing: { track: 1.2, mainZ: 2.2, noseZ: -5.0, legLen: 2.2, wheel: 0.7, bellyY: -0.8, flapX: 7.0, flapZ: 1.6, flapW: 5.0, flapC: 1.4, sbY: 0.9, sbZ: 5.0, sbW: 1.6, sbL: 2.6 },
    stats: { speed: 0.5, agility: 0.25, toughness: 1.0 },
  },

  // AV-8B Harrier — a real jet, but the nozzles vector down for VTOL. Flies the
  // fixed-wing model normally; with the nozzles down (controls.vtol) it switches
  // to the helicopter hover model, so it can take off and land vertically. The
  // `vtol` flag routes that, and the hover-model fields (twr/pull/grip/…) drive
  // it while hovering.
  harrier: {
    name: "AV-8B Harrier II",
    role: "VTOL jump jet",
    loadout: { missiles: 4, rockets: 14, bombs: 4 },
    color: 0x5a6552,
    vtol: true,
    mass: 9500, maxThrust: 120000, wingArea: 24,
    cl0: 0.12, clAlpha: 5.0, clMax: 1.6, stallAngle: 0.40,
    cd0: 0.024, k: 0.12,
    pitchRate: 1.15, rollRate: 2.5, yawRate: 0.9,
    landing: { track: 1.0, mainZ: 1.5, noseZ: -2.9, legLen: 1.45, wheel: 0.4, bellyY: -0.55, flapX: 2.7, flapZ: 1.7, flapW: 2.2 },
    // hover (nozzles down): can rise vertically, gentle forward pull, firm grip
    twr: 1.4, pull: 12, drag: 0.0013, grip: 1.5,
    maxPitch: 0.32, maxRoll: 0.5, atti: 5.2, bankTurn: 0.5,
    stats: { speed: 0.6, agility: 0.78, toughness: 0.55 },
  },

  // --- Rotorcraft ---------------------------------------------------------
  // Helicopters fly a Battlefield-style arcade model (flight.js stepHeli):
  //   rotor    routes to the hover/attitude-hold dynamics
  //   twr      collective thrust-to-weight (>1 climbs); hover at throttle 1/twr
  //   pull     arcade "tip the nose and get pulled forward" accel scale
  //   drag     quadratic forward drag — sets top speed
  //   grip     lateral velocity damping, so it tracks where the nose points
  //   maxPitch/maxRoll  attitude limits the airframe holds (can't flip)
  //   atti     how fast it snaps to the commanded attitude
  //   yawRate  tail-rotor pedal; bankTurn  how much banking carves a turn
  apache: {
    name: "AH-64 Apache",
    role: "Attack helicopter",
    loadout: { missiles: 8, rockets: 38, bombs: 0 },
    color: 0x444b3c,
    rotor: true,
    mass: 8000, maxThrust: 0, wingArea: 0,
    twr: 1.6, pull: 17, drag: 0.0016, grip: 1.6,
    maxPitch: 0.46, maxRoll: 0.7, atti: 6.5, yawRate: 1.5, bankTurn: 0.9,
    stats: { speed: 0.5, agility: 0.7, toughness: 0.8 },
  },
  blackhawk: {
    name: "UH-60 Black Hawk",
    role: "Utility helicopter",
    loadout: { missiles: 2, rockets: 14, bombs: 0 },
    color: 0x363b42,
    rotor: true,
    mass: 9000, maxThrust: 0, wingArea: 0,
    twr: 1.5, pull: 14, drag: 0.0019, grip: 1.5,
    maxPitch: 0.42, maxRoll: 0.6, atti: 5.5, yawRate: 1.3, bankTurn: 0.8,
    stats: { speed: 0.45, agility: 0.55, toughness: 0.7 },
  },
  littlebird: {
    name: "MH-6 Little Bird",
    role: "Light scout / special ops",
    loadout: { missiles: 0, rockets: 14, bombs: 0 },
    color: 0x202327,
    rotor: true,
    mass: 1400, maxThrust: 0, wingArea: 0,
    twr: 1.8, pull: 22, drag: 0.0014, grip: 1.9,
    maxPitch: 0.55, maxRoll: 0.85, atti: 8.5, yawRate: 1.9, bankTurn: 1.1,
    stats: { speed: 0.6, agility: 0.95, toughness: 0.3 },
  },
  chinook: {
    name: "CH-47 Chinook",
    role: "Tandem-rotor heavy lift",
    loadout: { missiles: 0, rockets: 0, bombs: 8 },
    color: 0x47503d,
    rotor: true, tandem: true,
    mass: 16000, maxThrust: 0, wingArea: 0,
    twr: 1.45, pull: 11, drag: 0.0024, grip: 1.3,
    maxPitch: 0.36, maxRoll: 0.48, atti: 4.0, yawRate: 0.95, bankTurn: 0.6,
    stats: { speed: 0.4, agility: 0.3, toughness: 1.0 },
  },
};

function makeMaterials(def) {
  const dark = new THREE.Color(def.color).multiplyScalar(0.66).getHex();
  return {
    body: new THREE.MeshStandardMaterial({ color: def.color, flatShading: true, metalness: 0.3, roughness: 0.62 }),
    panel: new THREE.MeshStandardMaterial({ color: dark, flatShading: true, metalness: 0.35, roughness: 0.6 }), // two-tone spine/accent
    accent: new THREE.MeshStandardMaterial({ color: 0x2b3138, flatShading: true, metalness: 0.4, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6a7077, flatShading: true, metalness: 0.75, roughness: 0.38 }), // nozzles/gun
    ord: new THREE.MeshStandardMaterial({ color: 0xccd1d6, flatShading: true, metalness: 0.2, roughness: 0.7 }),    // missiles/tanks
    glass: new THREE.MeshStandardMaterial({ color: 0x111a22, flatShading: true, metalness: 0.1, roughness: 0.2, emissive: 0x0a1a24, transparent: true, opacity: 0.9 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a20, emissiveIntensity: 1.5, roughness: 0.5 }),
    green: new THREE.MeshStandardMaterial({ color: 0x36ff6a, emissive: 0x22ff55, emissiveIntensity: 1.5, roughness: 0.5 }),
  };
}

// A flat, thin polygon (planform given as [x,z] points) extruded `thick` in Y
// and centred — used for tapered/swept wings, stabs and fins instead of boxes.
function flatPoly(mat, pts, thick) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);      // planform into XZ, thickness into Y
  geo.translate(0, thick / 2, 0); // centre thickness on y=0
  return new THREE.Mesh(geo, mat);
}
// Full (both-sides) swept, tapered wing centred on the fuselage.
function wing(mat, halfSpan, root, tip, sweep, thick) {
  return flatPoly(mat, [
    [-halfSpan, sweep + tip / 2], [-halfSpan, sweep - tip / 2],
    [0, -root / 2],
    [halfSpan, sweep - tip / 2], [halfSpan, sweep + tip / 2],
    [0, root / 2],
  ], thick);
}
// A single vertical fin (tapered, swept), standing up in Y.
function fin(mat, height, root, tip, sweep, thick) {
  const m = flatPoly(mat, [
    [0, -root / 2], [0, root / 2],
    [height, sweep + tip / 2], [height, sweep - tip / 2],
  ], thick);
  m.rotation.z = Math.PI / 2; // span -> height
  return m;
}

// Pylon + slung missile (low-poly). Origin at the wing underside attach point.
function ordnance(m) {
  const grp = new THREE.Group();
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.7), m.accent);
  pylon.position.y = -0.2; grp.add(pylon);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.7, 8), m.ord);
  body.rotation.x = Math.PI / 2; body.position.y = -0.46; grp.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 8), m.ord);
  tip.rotation.x = -Math.PI / 2; tip.position.set(0, -0.46, -1.05); grp.add(tip);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.28), m.accent);
    f.position.set(0, -0.46, 0.78); f.rotation.z = r; grp.add(f);
  }
  return grp;
}
function navLight(mat) { return new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat); }

// Layered afterburner: a wide cool cone + a bright inner core, both additive and
// hidden until throttled up. Pushes both meshes onto `flames` (main animates
// their opacity/scale).
function addAfterburner(g, x, y, z, base, flames) {
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 2.9, 10),
    new THREE.MeshBasicMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  // Cones taper to a point AFT (+Z): wide at the nozzle, trailing behind the jet.
  outer.rotation.x = Math.PI / 2; outer.position.set(x, y, z + 1.45);
  outer.scale.setScalar(base); outer.userData.base = base;
  g.add(outer); flames.push(outer);
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.7, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe7a6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  inner.rotation.x = Math.PI / 2; inner.position.set(x, y, z + 1.0);
  inner.scale.setScalar(base); inner.userData.base = base * 0.7;
  g.add(inner); flames.push(inner);
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

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.6, 7, 12), m.body);
  fuse.rotation.x = Math.PI / 2;
  g.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.4, 12), m.body);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.7;
  g.add(nose);
  // pitot probe + radome accent
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), m.metal);
  probe.rotation.x = Math.PI / 2; probe.position.z = -6.2; g.add(probe);
  // dorsal spine (two-tone)
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 4.2), m.panel);
  spine.position.set(0, 0.42, 0.6); g.add(spine);

  // chin intake with a dark inlet face
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 1.9), m.body);
  intake.position.set(0, -0.55, -1.0); g.add(intake);
  const inlet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.2), m.accent);
  inlet.position.set(0, -0.55, -1.95); g.add(inlet);

  g.add(makeCanopy(m.glass, -1.9, 0.85, 0.8, 2.0));

  // cropped-delta wings (swept, tapered) + LERX-ish blend
  const w = wing(m.body, 4.5, 2.6, 0.8, 1.2, 0.16);
  w.position.z = 0.9; g.add(w);

  const hs = wing(m.body, 2.0, 1.3, 0.5, 0.7, 0.14);
  hs.position.z = 3.1; g.add(hs);

  const vt = fin(m.body, 2.0, 1.7, 0.7, 0.6, 0.15);
  vt.position.set(0, 0.4, 2.9); g.add(vt);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.36, 0.9, 12), m.metal);
  nozzle.rotation.x = Math.PI / 2; nozzle.position.z = 3.7; g.add(nozzle);

  // underwing missiles + wingtip rails
  for (const s of [-1, 1]) {
    const o = ordnance(m); o.position.set(s * 2.2, -0.1, 1.0); g.add(o);
    const tip = ordnance(m); tip.position.set(s * 4.45, -0.02, 1.0); tip.scale.setScalar(0.8); g.add(tip);
  }
  // nav lights: red port, green starboard, white tail
  const rl = navLight(m.red); rl.position.set(-4.5, 0.05, 1.2); g.add(rl);
  const gl = navLight(m.green); gl.position.set(4.5, 0.05, 1.2); g.add(gl);

  g.userData.flames = [];
  addAfterburner(g, 0, 0, 3.7, 1, g.userData.flames);
  return g;
}

// ---- F/A-18: twin canted tails, twin engines, broad LERX ----
function buildHornet(def) {
  const g = new THREE.Group();
  const m = makeMaterials(def);

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.9, 6.4), m.body);
  g.add(fuse);
  // chamfered nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.6, 8), m.body);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -4.3; g.add(nose);
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), m.metal);
  probe.rotation.x = Math.PI / 2; probe.position.z = -5.7; g.add(probe);
  // dorsal spine accent
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 3.6), m.panel);
  spine.position.set(0, 0.5, 0.8); g.add(spine);

  g.add(makeCanopy(m.glass, -1.7, 0.9, 0.85, 2.0));

  // boxy side intakes
  for (const s of [-1, 1]) {
    const intk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 1.6), m.accent);
    intk.position.set(s * 0.95, -0.1, -1.2); g.add(intk);
  }
  // leading-edge extensions (LERX) sweeping to the nose
  for (const s of [-1, 1]) {
    const lerx = flatPoly(m.body, [[0, -1.4], [s * 1.9, 1.2], [s * 0.4, 1.4]], 0.1);
    lerx.position.set(0, 0.06, -0.6); g.add(lerx);
  }

  const w = wing(m.body, 5.0, 2.5, 0.9, 0.9, 0.16);
  w.position.z = 0.7; g.add(w);

  // twin canted vertical tails (shaped)
  for (const s of [-1, 1]) {
    const vt = fin(m.body, 1.7, 1.5, 0.7, 0.5, 0.14);
    vt.position.set(s * 0.95, 0.5, 2.2); vt.rotation.z = Math.PI / 2 + s * 0.26; g.add(vt);
  }
  const hs = wing(m.body, 2.4, 1.4, 0.5, 0.7, 0.14);
  hs.position.z = 3.2; g.add(hs);

  // underwing missiles
  for (const s of [-1, 1]) {
    const o = ordnance(m); o.position.set(s * 2.4, -0.05, 0.8); g.add(o);
    const t = ordnance(m); t.position.set(s * 4.9, 0.0, 0.8); t.scale.setScalar(0.8); g.add(t);
  }
  const rl = navLight(m.red); rl.position.set(-5.0, 0.05, 1.0); g.add(rl);
  const gl = navLight(m.green); gl.position.set(5.0, 0.05, 1.0); g.add(gl);

  // twin nozzles + layered flames
  g.userData.flames = [];
  for (const s of [-1, 1]) {
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.9, 10), m.metal);
    nz.rotation.x = Math.PI / 2; nz.position.set(s * 0.5, 0, 3.4); g.add(nz);
    addAfterburner(g, s * 0.5, 0, 3.4, 0.8, g.userData.flames);
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
  nose.scale.z = 1.7; nose.position.z = -3.4; g.add(nose);

  // the famous GAU-8 gun barrel (metal), slightly offset like the real jet
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8), m.metal);
  gun.rotation.x = Math.PI / 2; gun.position.set(-0.1, -0.2, -4.5); g.add(gun);

  g.add(makeCanopy(m.glass, -2.0, 0.85, 0.85, 1.6));

  // long, nearly-straight wings (slight taper, minimal sweep)
  const w = wing(m.body, 6.5, 2.3, 1.6, 0.2, 0.22);
  w.position.z = 0.3; g.add(w);

  // twin engine pods mounted high on the rear fuselage, with dark intakes
  g.userData.flames = [];
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 12), m.body);
    nac.rotation.x = Math.PI / 2; nac.position.set(s * 1.15, 0.75, 2.1); g.add(nac);
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), m.accent);
    inlet.rotation.x = Math.PI / 2; inlet.position.set(s * 1.15, 0.75, 0.95); g.add(inlet);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.4, 0.5, 12), m.metal);
    noz.rotation.x = Math.PI / 2; noz.position.set(s * 1.15, 0.75, 3.35); g.add(noz);
    addAfterburner(g, s * 1.15, 0.75, 3.3, 0.55, g.userData.flames);
  }

  // tailplane with twin vertical fins at the tips (A-10's signature "H" tail)
  const hs = wing(m.body, 2.6, 1.4, 1.0, 0.2, 0.18);
  hs.position.z = 3.5; g.add(hs);
  for (const s of [-1, 1]) {
    const vt = fin(m.body, 1.5, 1.3, 0.9, 0.2, 0.16);
    vt.position.set(s * 2.4, 0.1, 3.5); g.add(vt);
  }

  // heavy underwing stores (this is the ground-pounder)
  for (const s of [-1, 1]) {
    for (const dx of [1.8, 3.2, 4.6]) {
      const o = ordnance(m); o.position.set(s * dx, -0.12, 0.4); g.add(o);
    }
  }
  const rl = navLight(m.red); rl.position.set(-6.5, 0.05, 0.5); g.add(rl);
  const gl = navLight(m.green); gl.position.set(6.5, 0.05, 0.5); g.add(gl);
  return g;
}

// ---- F-15 Eagle: big twin-engine, twin tails, large wings ----
function buildEagle(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 7.2), m.body); g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.8, 10), m.body); nose.rotation.x = -Math.PI / 2; nose.position.z = -4.8; g.add(nose);
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), m.metal); probe.rotation.x = Math.PI / 2; probe.position.z = -6.3; g.add(probe);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 4.2), m.panel); spine.position.set(0, 0.55, 0.8); g.add(spine);
  g.add(makeCanopy(m.glass, -2.0, 1.0, 0.95, 2.2));
  for (const s of [-1, 1]) { const intk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 2.2), m.accent); intk.position.set(s * 0.95, -0.1, -1.2); g.add(intk); }
  const w = wing(m.body, 5.8, 3.0, 0.9, 0.9, 0.18); w.position.z = 0.7; g.add(w);
  for (const s of [-1, 1]) { const vt = fin(m.body, 2.0, 1.8, 0.7, 0.6, 0.14); vt.position.set(s * 1.0, 0.5, 2.6); vt.rotation.z = Math.PI / 2 + s * 0.08; g.add(vt); }
  const hs = wing(m.body, 3.0, 1.5, 0.6, 0.8, 0.14); hs.position.z = 3.4; g.add(hs);
  for (const s of [-1, 1]) { const o = ordnance(m); o.position.set(s * 2.6, -0.05, 0.9); g.add(o); const o2 = ordnance(m); o2.position.set(s * 4.2, 0, 0.9); o2.scale.setScalar(0.85); g.add(o2); }
  g.userData.flames = [];
  for (const s of [-1, 1]) { const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.9, 10), m.metal); nz.rotation.x = Math.PI / 2; nz.position.set(s * 0.55, 0, 3.6); g.add(nz); addAfterburner(g, s * 0.55, 0, 3.6, 0.85, g.userData.flames); }
  const rl = navLight(m.red); rl.position.set(-5.8, 0.05, 1.0); g.add(rl); const gl = navLight(m.green); gl.position.set(5.8, 0.05, 1.0); g.add(gl);
  return g;
}

// ---- F-14 Tomcat: flat wide fuselage, spaced engines, swept (swing) wings ----
function buildTomcat(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 6.2), m.body); g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.0, 10), m.body); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.05, -4.4); g.add(nose);
  g.userData.flames = [];
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 6.2, 12), m.body); nac.rotation.x = Math.PI / 2; nac.position.set(s * 1.05, 0, 0.6); g.add(nac);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.8, 12), m.metal); noz.rotation.x = Math.PI / 2; noz.position.set(s * 1.05, 0, 3.8); g.add(noz);
    addAfterburner(g, s * 1.05, 0, 3.8, 0.85, g.userData.flames);
  }
  g.add(makeCanopy(m.glass, -1.8, 0.85, 0.8, 2.6));
  const w = wing(m.body, 6.2, 1.8, 0.7, 2.4, 0.16); w.position.z = 0.4; g.add(w);
  for (const s of [-1, 1]) { const vt = fin(m.body, 1.9, 1.6, 0.7, 0.5, 0.14); vt.position.set(s * 1.05, 0.4, 2.6); vt.rotation.z = Math.PI / 2 + s * 0.18; g.add(vt); }
  const hs = wing(m.body, 3.2, 1.3, 0.5, 1.0, 0.14); hs.position.z = 3.4; g.add(hs);
  for (const s of [-1, 1]) { const o = ordnance(m); o.position.set(s * 1.6, -0.3, 0.5); g.add(o); }
  const rl = navLight(m.red); rl.position.set(-6.2, 0.05, 0.6); g.add(rl); const gl = navLight(m.green); gl.position.set(6.2, 0.05, 0.6); g.add(gl);
  return g;
}

// ---- F-22 Raptor: faceted stealth, diamond wings, canted twin tails ----
function buildRaptor(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.85, 7.0), m.body); g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.0, 4), m.body); nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.position.z = -4.9; g.add(nose);
  for (const s of [-1, 1]) { const ch = flatPoly(m.panel, [[0, -3.0], [s * 1.2, 1.2], [s * 0.3, 1.4]], 0.1); ch.position.set(0, 0.12, -0.8); g.add(ch); }
  g.add(makeCanopy(m.glass, -2.2, 0.9, 0.85, 2.2));
  const w = wing(m.body, 4.8, 3.8, 0.6, 1.6, 0.16); w.position.z = 0.9; g.add(w);
  for (const s of [-1, 1]) { const vt = fin(m.body, 1.7, 1.6, 0.6, 0.6, 0.14); vt.position.set(s * 1.0, 0.4, 2.4); vt.rotation.z = Math.PI / 2 + s * 0.5; g.add(vt); }
  const hs = wing(m.body, 3.0, 1.6, 0.5, 1.0, 0.14); hs.position.z = 3.3; g.add(hs);
  g.userData.flames = [];
  for (const s of [-1, 1]) { const nz = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 1.0), m.metal); nz.position.set(s * 0.5, 0, 3.5); g.add(nz); addAfterburner(g, s * 0.5, 0, 3.4, 0.8, g.userData.flames); }
  const rl = navLight(m.red); rl.position.set(-4.8, 0.05, 1.2); g.add(rl); const gl = navLight(m.green); gl.position.set(4.8, 0.05, 1.2); g.add(gl);
  return g;
}

// ---- MiG-29 Fulcrum: big LERX, twin canted tails, twin engines ----
function buildFulcrum(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 6.2), m.body); g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 10), m.body); nose.rotation.x = -Math.PI / 2; nose.position.z = -4.2; g.add(nose);
  for (const s of [-1, 1]) { const lerx = flatPoly(m.body, [[0, -1.6], [s * 1.8, 1.4], [s * 0.4, 1.6]], 0.1); lerx.position.set(0, 0.06, -0.5); g.add(lerx); }
  g.add(makeCanopy(m.glass, -1.7, 0.85, 0.8, 1.9));
  const w = wing(m.body, 5.0, 2.6, 0.9, 1.0, 0.16); w.position.z = 0.8; g.add(w);
  for (const s of [-1, 1]) { const vt = fin(m.body, 1.6, 1.4, 0.6, 0.5, 0.14); vt.position.set(s * 1.1, 0.5, 2.3); vt.rotation.z = Math.PI / 2 + s * 0.12; g.add(vt); }
  const hs = wing(m.body, 2.6, 1.3, 0.5, 0.7, 0.14); hs.position.z = 3.1; g.add(hs);
  g.userData.flames = [];
  for (const s of [-1, 1]) { const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.9, 10), m.metal); nz.rotation.x = Math.PI / 2; nz.position.set(s * 0.55, -0.05, 3.3); g.add(nz); addAfterburner(g, s * 0.55, -0.05, 3.3, 0.78, g.userData.flames); }
  for (const s of [-1, 1]) { const o = ordnance(m); o.position.set(s * 2.4, -0.05, 0.8); g.add(o); }
  const rl = navLight(m.red); rl.position.set(-5.0, 0.05, 1.0); g.add(rl); const gl = navLight(m.green); gl.position.set(5.0, 0.05, 1.0); g.add(gl);
  return g;
}

// ---- B-2 Spirit: flying-wing stealth bomber (swept LE, sawtooth W trailing) ----
function buildSpirit(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const planform = [
    [0, -9], [10, 1.5], [7.5, 3.2], [5.0, 1.6], [2.4, 3.4],
    [0, 1.7], [-2.4, 3.4], [-5.0, 1.6], [-7.5, 3.2], [-10, 1.5],
  ];
  const w = flatPoly(m.body, planform, 0.55); g.add(w);
  const center = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 6.4), m.body); center.position.set(0, 0.45, -2.0); g.add(center);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.glass);
  cockpit.scale.set(1.1, 0.7, 1.6); cockpit.position.set(0, 0.8, -4.2); g.add(cockpit);
  for (const s of [-1, 1]) { const intk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 2.0), m.accent); intk.position.set(s * 1.7, 0.78, -1.4); g.add(intk); }
  for (const s of [-1, 1]) { const ex = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.7), m.metal); ex.position.set(s * 1.7, 0.5, 1.7); g.add(ex); }
  g.userData.flames = []; // flush stealth exhausts — no visible flame
  const rl = navLight(m.red); rl.position.set(-9.6, 0.1, 1.5); g.add(rl); const gl = navLight(m.green); gl.position.set(9.6, 0.1, 1.5); g.add(gl);
  return g;
}

// ---- B-52 Stratofortress: long fuselage, huge swept wing, 8 podded engines ----
function buildStrato(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 16, 12), m.body); fuse.rotation.x = Math.PI / 2; g.add(fuse);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), m.body); nose.scale.z = 1.7; nose.position.z = -8.6; g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 12), m.body); tail.rotation.x = Math.PI / 2; tail.position.z = 9.2; g.add(tail);
  g.add(makeCanopy(m.glass, -7.4, 0.6, 0.6, 1.4));
  const w = wing(m.body, 13, 3.2, 1.0, 3.2, 0.22); w.position.set(0, 0.5, -0.5); g.add(w);
  for (const s of [-1, 1]) for (const wx of [4.0, 7.5]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.8), m.accent); pylon.position.set(s * wx, -0.3, -0.4); g.add(pylon);
    for (const e of [-0.55, 0.55]) {
      const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 2.2, 10), m.metal); nac.rotation.x = Math.PI / 2; nac.position.set(s * wx + e, -1.0, -0.2); g.add(nac);
    }
  }
  const vt = fin(m.body, 4.5, 2.6, 0.8, 1.0, 0.2); vt.position.set(0, 0.5, 8.0); g.add(vt);
  const hs = wing(m.body, 5.0, 2.0, 0.7, 1.0, 0.18); hs.position.set(0, 1.0, 8.3); g.add(hs);
  g.userData.flames = [];
  const rl = navLight(m.red); rl.position.set(-13, 0.6, -0.2); g.add(rl); const gl = navLight(m.green); gl.position.set(13, 0.6, -0.2); g.add(gl);
  return g;
}

// ---- AV-8B Harrier: shoulder wing, big side intakes, 4 vectoring nozzles ----
function buildHarrier(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 7.4), m.body); g.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.8, 10), m.body); nose.rotation.x = -Math.PI / 2; nose.position.z = -4.8; g.add(nose);
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), m.metal); probe.rotation.x = Math.PI / 2; probe.position.z = -6.3; g.add(probe);
  g.add(makeCanopy(m.glass, -2.1, 0.82, 0.85, 2.0));

  // big cheek intakes either side of the cockpit
  for (const s of [-1, 1]) {
    const intk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 2.0), m.accent); intk.position.set(s * 0.82, 0.1, -1.6); g.add(intk);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10), m.panel); lip.rotation.x = Math.PI / 2; lip.position.set(s * 0.82, 0.1, -2.6); g.add(lip);
  }

  // shoulder-mounted swept wing (sits high on the fuselage)
  const w = wing(m.body, 4.3, 2.7, 0.8, 1.1, 0.16); w.position.set(0, 0.5, 0.5); g.add(w);
  // tail
  const vt = fin(m.body, 1.9, 1.7, 0.7, 0.6, 0.14); vt.position.set(0, 0.45, 3.1); g.add(vt);
  const hs = wing(m.body, 2.2, 1.3, 0.5, 0.7, 0.14); hs.position.set(0, 0.2, 3.3); g.add(hs);

  // four vectoring nozzles on pivots (2 per side) — animated by main.js
  g.userData.nozzles = [];
  for (const s of [-1, 1]) for (const z of [-0.7, 1.7]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.78, -0.35, z);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.22, 1.0, 10), m.metal);
    noz.rotation.x = Math.PI / 2; noz.position.z = 0.5; pivot.add(noz);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10), m.accent); face.position.z = 1.0; pivot.add(face);
    g.add(pivot); g.userData.nozzles.push(pivot);
  }

  for (const s of [-1, 1]) { const o = ordnance(m); o.position.set(s * 2.1, -0.05, 0.6); g.add(o); }
  const rl = navLight(m.red); rl.position.set(-4.3, 0.5, 0.7); g.add(rl);
  const gl = navLight(m.green); gl.position.set(4.3, 0.5, 0.7); g.add(gl);
  g.userData.flames = []; // no afterburner on the Pegasus
  return g;
}

// ======================= Helicopters ====================================

// A spinning rotor: hub + thin blades on a group we hand back to main.js to
// rotate every frame. `blades` evenly spaced; `radius` is the full blade length.
function makeRotor(m, radius, blades, chord) {
  const grp = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 8), m.metal);
  grp.add(hub);
  for (let i = 0; i < blades; i++) {
    const arm = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(radius, 0.06, chord), m.accent);
    blade.position.x = radius / 2;
    // faint blade tip cap so the disc reads even at speed
    arm.add(blade);
    arm.rotation.y = (i / blades) * Math.PI * 2;
    grp.add(arm);
  }
  return grp;
}

// Twin landing skids (tube + two struts each), replacing wheeled gear.
function skids(m, span, len, drop) {
  const grp = new THREE.Group();
  const tubeMat = m.metal;
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 7), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(s * span, drop, 0.2);
    grp.add(tube);
    for (const z of [-len * 0.32, len * 0.32]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, Math.abs(drop) + 0.2, 6), tubeMat);
      strut.position.set(s * span * 0.78, drop / 2 + 0.1, z + 0.2);
      strut.rotation.x = s * 0.05;
      grp.add(strut);
    }
  }
  return grp;
}

// Boom-mounted tail rotor (vertical disc) on the port side of the tail.
function tailRotor(m, radius, x, z) {
  const tr = makeRotor(m, radius, 4, 0.14);
  tr.rotation.z = Math.PI / 2; // disc stands vertical
  tr.position.set(x, 0.25, z);
  return tr;
}

// ---- AH-64 Apache: tandem stepped cockpit, stub wings + rocket pods, chin gun
function buildApache(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  g.userData.flames = []; g.userData.rotors = [];

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 6.6), m.body); g.add(fuse);
  // stepped tandem canopies (gunner low/front, pilot raised/aft)
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 1.5), m.glass); c1.position.set(0, 0.55, -2.2); g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.8, 1.5), m.glass); c2.position.set(0, 0.78, -0.7); g.add(c2);
  // pointed nose with sensor turret + chin gun
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.2), m.body); nose.position.set(0, -0.1, -3.4); g.add(nose);
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), m.accent); sensor.position.set(0, -0.35, -3.9); g.add(sensor);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6), m.metal); gun.rotation.x = Math.PI / 2; gun.position.set(0, -0.7, -2.4); g.add(gun);

  // stub wings carrying rocket pods + missiles
  const w = wing(m.body, 2.7, 0.9, 0.6, 0.1, 0.16); w.position.set(0, 0.1, 0.6); g.add(w);
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 10), m.ord); pod.rotation.x = Math.PI / 2; pod.position.set(s * 1.6, -0.25, 0.6); g.add(pod);
    const o = ordnance(m); o.position.set(s * 2.4, -0.05, 0.6); o.scale.setScalar(0.8); g.add(o);
  }

  // tapering tailboom + swept tail fin + stabilizer
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.16, 4.4, 10), m.body); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.25, 4.6); g.add(boom);
  const tfin = fin(m.body, 1.3, 1.0, 0.5, 0.4, 0.12); tfin.position.set(0, 0.4, 6.4); g.add(tfin);
  const stab = wing(m.body, 1.2, 0.7, 0.4, 0.2, 0.1); stab.position.set(0, 0.3, 6.0); g.add(stab);

  // engines either side of the rotor mast
  for (const s of [-1, 1]) { const eng = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 1.8), m.panel); eng.position.set(s * 0.55, 0.95, 1.6); g.add(eng); }

  // main rotor on a mast, tail rotor on the fin
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 8), m.metal); mast.position.set(0, 1.35, 0.8); g.add(mast);
  const rotor = makeRotor(m, 7.4, 4, 0.3); rotor.position.set(0, 1.7, 0.8); g.add(rotor);
  g.userData.rotors.push({ m: rotor, axis: "y", spd: 1 });
  const tr = tailRotor(m, 1.3, 0.32, 6.4); g.add(tr);
  g.userData.rotors.push({ m: tr, axis: "x", spd: 1.5 });

  const rl = navLight(m.red); rl.position.set(-2.7, 0.1, 0.6); g.add(rl);
  const gl = navLight(m.green); gl.position.set(2.7, 0.1, 0.6); g.add(gl);
  g.add(skids(m, 1.05, 3.2, -1.0));
  return g;
}

// ---- UH-60 Black Hawk: boxy cabin, sloped nose, canted tail rotor ----
function buildBlackHawk(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  g.userData.flames = []; g.userData.rotors = [];

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.4, 5.0), m.body); cabin.position.z = -0.4; g.add(cabin);
  // sloped lower nose + windscreen
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.4), m.body); nose.position.set(0, -0.25, -3.2); g.add(nose);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.1), m.glass); glass.position.set(0, 0.45, -2.4); g.add(glass);
  for (const s of [-1, 1]) { const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 2.2), m.glass); win.position.set(s * 0.86, 0.2, -0.4); g.add(win); }

  // engine deck + main rotor mast
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 2.4), m.panel); deck.position.set(0, 0.95, 0.0); g.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 8), m.metal); mast.position.set(0, 1.4, 0.0); g.add(mast);
  const rotor = makeRotor(m, 8.2, 4, 0.34); rotor.position.set(0, 1.75, 0.0); g.add(rotor);
  g.userData.rotors.push({ m: rotor, axis: "y", spd: 1 });

  // down-sloped tailboom, swept fin, canted tail rotor
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.2, 4.6, 10), m.body); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.25, 4.0); g.add(boom);
  const tfin = fin(m.body, 1.5, 1.1, 0.6, 0.5, 0.13); tfin.position.set(0, 0.3, 6.0); g.add(tfin);
  const stab = wing(m.body, 1.5, 0.7, 0.5, 0.2, 0.1); stab.position.set(0, 0.3, 5.6); g.add(stab);
  const tr = tailRotor(m, 1.55, -0.3, 6.3); tr.rotation.x = 0.35; g.add(tr); // 20° cant like the real -60
  g.userData.rotors.push({ m: tr, axis: "x", spd: 1.4 });

  const rl = navLight(m.red); rl.position.set(-2.0, 0.0, -0.4); g.add(rl);
  const gl = navLight(m.green); gl.position.set(2.0, 0.0, -0.4); g.add(gl);
  g.add(skids(m, 1.15, 3.4, -1.2));
  return g;
}

// ---- MH-6 Little Bird: egg cabin, exposed boom, fast & nimble scout ----
function buildLittleBird(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  g.userData.flames = []; g.userData.rotors = [];

  const pod = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 10), m.body); pod.scale.set(1.0, 0.95, 1.25); pod.position.z = -0.4; g.add(pod);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m.glass);
  glass.scale.set(0.95, 0.85, 1.15); glass.position.set(0, 0.15, -0.7); glass.rotation.x = -0.5; g.add(glass);
  // bench seats (the SOAR "people on the skids" look)
  for (const s of [-1, 1]) { const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.3), m.panel); bench.position.set(s * 1.05, -0.5, -0.4); g.add(bench); }

  // thin exposed tailboom + small fin + tail rotor
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 3.8, 8), m.body); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.2, 2.6); g.add(boom);
  const tfin = fin(m.body, 0.9, 0.7, 0.4, 0.3, 0.1); tfin.position.set(0, 0.35, 4.2); g.add(tfin);
  const tr = tailRotor(m, 0.9, 0.22, 4.2); g.add(tr);
  g.userData.rotors.push({ m: tr, axis: "x", spd: 1.6 });

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8), m.metal); mast.position.set(0, 1.05, -0.3); g.add(mast);
  const rotor = makeRotor(m, 6.2, 5, 0.24); rotor.position.set(0, 1.35, -0.3); g.add(rotor);
  g.userData.rotors.push({ m: rotor, axis: "y", spd: 1 });

  const rl = navLight(m.red); rl.position.set(-1.1, 0.0, -0.4); g.add(rl);
  const gl = navLight(m.green); gl.position.set(1.1, 0.0, -0.4); g.add(gl);
  g.add(skids(m, 0.95, 2.6, -0.95));
  return g;
}

// ---- CH-47 Chinook: long fuselage, two contra-rotating tandem rotors ----
function buildChinook(def) {
  const g = new THREE.Group(); const m = makeMaterials(def);
  g.userData.flames = []; g.userData.rotors = [];

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 10.0), m.body); g.add(fuse);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.2), m.glass); glass.position.set(0, 0.4, -4.8); g.add(glass);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 1.0), m.body); nose.position.set(0, -0.3, -5.0); g.add(nose);
  // aft loading ramp + raised rear rotor pylon
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 1.2), m.body); ramp.position.set(0, -0.2, 5.0); g.add(ramp);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.8), m.panel); pylon.position.set(0, 1.5, 4.2); g.add(pylon);
  const fdeck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.6), m.panel); fdeck.position.set(0, 1.15, -3.6); g.add(fdeck);
  // side sponsons (fuel + wheels)
  for (const s of [-1, 1]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 4.0), m.panel); sp.position.set(s * 1.2, -0.7, 0.5); g.add(sp);
    for (const z of [-2.4, 2.6]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), m.accent); wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.35, -1.3, z); g.add(wh); }
  }

  // two big tandem rotors, counter-rotating (opposite spd sign)
  const front = makeRotor(m, 8.8, 3, 0.4); front.position.set(0, 1.85, -3.6); g.add(front);
  g.userData.rotors.push({ m: front, axis: "y", spd: 1 });
  const rear = makeRotor(m, 8.8, 3, 0.4); rear.position.set(0, 2.25, 4.2); g.add(rear);
  g.userData.rotors.push({ m: rear, axis: "y", spd: -1 });

  const rl = navLight(m.red); rl.position.set(-1.1, 0.6, -4.0); g.add(rl);
  const gl = navLight(m.green); gl.position.set(1.1, 0.6, -4.0); g.add(gl);
  return g;
}

// Retractable tricycle gear + droopable flaps + speedbrake (animated from
// main.js). Geometry is sized per-airframe from an optional `def.landing` spec
// so the gear/flaps sit right on every jet; the defaults fit an F-16.
//   track/mainZ/noseZ  wheel positions   legLen/wheel  strut + tyre size
//   bellyY             where the legs hang from (the underside)
//   flapX/Z/W/C        inboard flap pivot + panel span/chord
//   sbY/Z/W/L          dorsal speedbrake hinge + panel size
function addGearFlaps(g, def) {
  const L = (def && def.landing) || {};
  const track = L.track ?? 1.7, mainZ = L.mainZ ?? 1.2, noseZ = L.noseZ ?? -2.6;
  const legLen = L.legLen ?? 1.4, wheelR = L.wheel ?? 0.45, bellyY = L.bellyY ?? -0.2, strutR = L.strut ?? 0.12;
  const flapX = L.flapX ?? 2.6, flapZ = L.flapZ ?? 1.7, flapW = L.flapW ?? 2.2, flapC = L.flapC ?? 0.9;
  const sbY = L.sbY ?? 0.42, sbZ = L.sbZ ?? 2.4, sbW = L.sbW ?? 1.0, sbL = L.sbL ?? 1.6;

  const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, flatShading: true });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, flatShading: true });
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x868d95, flatShading: true });
  const leg = (x, z) => {
    const lg = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(strutR, strutR, legLen, 6), strutMat);
    strut.position.y = -legLen / 2; lg.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 0.66, 10), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.y = -legLen; lg.add(wheel);
    lg.position.set(x, bellyY, z);
    return lg;
  };
  const gear = new THREE.Group();
  gear.add(leg(0, noseZ)); gear.add(leg(-track, mainZ)); gear.add(leg(track, mainZ));
  g.add(gear);
  g.userData.gear = gear;

  const flaps = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * flapX, 0, flapZ);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(flapW, 0.12, flapC), flapMat);
    flap.position.set(0, 0, flapC / 2);
    pivot.add(flap);
    g.add(pivot);
    flaps.push(pivot);
  }
  g.userData.flaps = flaps;

  // Dorsal speedbrake panel near the tail — hinges up when the airbrake is out.
  const sbMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, flatShading: true, metalness: 0.3, roughness: 0.6 });
  const sb = new THREE.Group();
  sb.position.set(0, sbY, sbZ); // hinge at the front edge of the panel
  const panel = new THREE.Mesh(new THREE.BoxGeometry(sbW, 0.1, sbL), sbMat);
  panel.position.set(0, 0, sbL / 2);  // extends aft of the hinge
  sb.add(panel);
  g.add(sb);
  g.userData.speedbrake = sb;
}

// Build the distinct low-poly mesh for a given aircraft type.
// `colorOverride` (optional) repaints the airframe — used for enemy jets.
export function buildAircraftMesh(type, colorOverride) {
  const base = AIRCRAFT[type] || AIRCRAFT.f16;
  const def = colorOverride != null ? { ...base, color: colorOverride } : base;
  let g;
  if (type === "a10") g = buildWarthog(def);
  else if (type === "fa18") g = buildHornet(def);
  else if (type === "f15") g = buildEagle(def);
  else if (type === "f14") g = buildTomcat(def);
  else if (type === "f22") g = buildRaptor(def);
  else if (type === "mig29") g = buildFulcrum(def);
  else if (type === "b2") g = buildSpirit(def);
  else if (type === "b52") g = buildStrato(def);
  else if (type === "harrier") g = buildHarrier(def);
  else if (type === "apache") g = buildApache(def);
  else if (type === "blackhawk") g = buildBlackHawk(def);
  else if (type === "littlebird") g = buildLittleBird(def);
  else if (type === "chinook") g = buildChinook(def);
  else g = buildF16(def);
  if (!base.rotor) addGearFlaps(g, def); // helis carry skids/wheels in their own builders
  if (!g.userData.rotors) g.userData.rotors = [];
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
