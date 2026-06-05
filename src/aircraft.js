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
  outer.rotation.x = -Math.PI / 2; outer.position.set(x, y, z + 1.45);
  outer.scale.setScalar(base); outer.userData.base = base;
  g.add(outer); flames.push(outer);
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.7, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe7a6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  inner.rotation.x = -Math.PI / 2; inner.position.set(x, y, z + 1.0);
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

// Retractable landing gear + droopable flaps (animated from main.js).
function addGearFlaps(g) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x20242a, flatShading: true });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, flatShading: true });
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x868d95, flatShading: true });
  const leg = (x, z) => {
    const lg = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), strutMat);
    strut.position.y = -0.7; lg.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.y = -1.4; lg.add(wheel);
    lg.position.set(x, -0.2, z);
    return lg;
  };
  const gear = new THREE.Group();
  gear.add(leg(0, -2.6)); gear.add(leg(-1.7, 1.2)); gear.add(leg(1.7, 1.2));
  g.add(gear);
  g.userData.gear = gear;

  const flaps = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 2.6, 0, 1.7);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.9), flapMat);
    flap.position.set(0, 0, 0.45);
    pivot.add(flap);
    g.add(pivot);
    flaps.push(pivot);
  }
  g.userData.flaps = flaps;
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
  addGearFlaps(g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
