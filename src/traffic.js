import * as THREE from "three";
import { terrainHeight, SEA_LEVEL } from "./world.js";

// Ambient world traffic: large moving things that make the archipelago feel
// alive and double as juicy targets. Three kinds, all sharing the standard
// target interface ({ position, radius, alive, hit(dmg) }) so the player's
// weapons hit them like anything else:
//   • a freight TRAIN that shuttles along an offshore viaduct toward an island
//   • giant container SHIPS that sail slow lanes across the open ocean
//   • a war ZEPPELIN that drifts between islands at altitude, throwing flak
// Destroyed entities blow up / sink / fall and then respawn, so the world
// keeps breathing. Lanes are derived from the island centres passed in, so it
// works for any world the editor produces.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Flak (shared by the warship-grade gunners: ships + zeppelin).
const FLAK_RANGE = 3000;
const FLAK_SHOT = 0.18;     // seconds between rounds within a burst
const FLAK_BURST = 4;       // base rounds per burst (+0..3)
const FLAK_BURST_VAR = 4;
const FLAK_GAP = 1.6;       // base pause between bursts
const FLAK_SPEED = 1000;
const FLAK_LIFE = 3.2;
const FLAK_DAMAGE = 5;

const CONTAINER_COLORS = [0xb5462f, 0x2f6fb5, 0x3f9b54, 0xc8902f, 0x2f9ba0, 0x8a8f96, 0xa83f5e, 0x46618a];

function mat(c, o = {}) {
  return new THREE.MeshStandardMaterial({
    color: c, flatShading: true,
    roughness: o.r ?? 0.85, metalness: o.m ?? 0.0,
    emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1,
  });
}
function lit(c) { return mat(c, { e: c, ei: 0.9, r: 0.5 }); }
// A bright self-lit lamp that blooms at night (running lights, headlights).
function glow(c, i = 2.4) { return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 }); }
const LAMP_GEO = new THREE.SphereGeometry(0.7, 6, 5);

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// A container ship: blocky hull + boot-topping, a deck packed with coloured
// container stacks, an aft superstructure with bridge windows and a funnel.
// Built bow-toward +Z (the manager yaws it onto its heading). ~300 m long.
function buildCargoShip() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(46, 30, 300), mat(0x2c333b));
  hull.position.y = -1; g.add(hull);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(47, 7, 286), mat(0x7a2b25)); // waterline stripe
  boot.position.y = -13; g.add(boot);
  // Raised, narrowing forecastle so the bow reads as a prow, not a brick.
  const fore = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 40), mat(0x343c45));
  fore.position.set(0, 18, 132); g.add(fore);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), mat(0x2c333b));
  nose.position.set(0, 0, 150); nose.rotation.y = Math.PI / 4; nose.scale.set(0.7, 1, 0.7); g.add(nose);
  // Main deck the containers sit on.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(44, 3, 250), mat(0x3c454e));
  deck.position.set(0, 15, -8); g.add(deck);

  // Container stacks: rows down the deck, a few columns across, 1–3 high.
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let z = -120; z <= 95; z += 23) {
    for (let cx = -15; cx <= 15; cx += 15) {
      const high = 1 + (rnd() * 3 | 0);
      for (let h = 0; h < high; h++) {
        const c = CONTAINER_COLORS[rnd() * CONTAINER_COLORS.length | 0];
        const box = new THREE.Mesh(new THREE.BoxGeometry(13, 11, 21), mat(c, { r: 0.7 }));
        box.position.set(cx, 22 + h * 11.4, z); g.add(box);
      }
    }
  }

  // Aft superstructure (the white accommodation block) + bridge windows.
  const house = new THREE.Mesh(new THREE.BoxGeometry(34, 40, 30), mat(0xc9ccce, { r: 0.7 }));
  house.position.set(0, 36, -120); g.add(house);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(35, 5, 24), lit(0x213a4a));
  bridge.position.set(0, 52, -116); g.add(bridge);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 22, 10), mat(0x2a2f34));
  funnel.position.set(0, 70, -132); g.add(funnel);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 6, 10), mat(0xb5462f));
  band.position.set(0, 73, -132); g.add(band);
  for (const z of [60, -40]) { // a couple of masts/cranes
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 6), mat(0x5a626a));
    m.position.set(0, 32, z); g.add(m);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, gun: new THREE.Vector3(0, 55, -116), hull: { hx: 25, lo: -16, hi: 60, hz: 152 } };
}

// A war zeppelin: a long rigid envelope (scaled sphere), a cruciform tail, a
// gondola with bridge windows, side engine nacelles, and two ventral gun
// turrets that throw flak. Built nose-toward +Z. ~360 m long.
function buildZeppelin() {
  const g = new THREE.Group();
  const env = new THREE.Mesh(new THREE.SphereGeometry(60, 20, 14), mat(0x6c7065, { r: 0.6 }));
  env.scale.set(1, 1, 3); g.add(env);
  // A darker dorsal/belly ridge stripe so the huge envelope isn't a blank pill.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 320), mat(0x40443c));
  stripe.position.y = 60; g.add(stripe);
  const belly = stripe.clone(); belly.position.y = -60; g.add(belly);

  // Cruciform tail fins near the stern (−Z).
  const finMat = mat(0x595d52);
  const vfin = new THREE.Mesh(new THREE.BoxGeometry(4, 62, 46), finMat);
  vfin.position.set(0, 18, -150); g.add(vfin);
  const vfinB = vfin.clone(); vfinB.position.set(0, -18, -150); g.add(vfinB);
  const hfin = new THREE.Mesh(new THREE.BoxGeometry(62, 4, 46), finMat);
  hfin.position.set(18, 0, -150); g.add(hfin);
  const hfinB = hfin.clone(); hfinB.position.set(-18, 0, -150); g.add(hfinB);

  // Gondola slung under the bow third, with a lit bridge window band.
  const gond = new THREE.Mesh(new THREE.BoxGeometry(18, 16, 78), mat(0x4a4f45, { r: 0.7 }));
  gond.position.set(0, -64, 36); g.add(gond);
  const win = new THREE.Mesh(new THREE.BoxGeometry(19, 5, 70), lit(0x2a4250));
  win.position.set(0, -60, 40); g.add(win);

  // Side engine nacelles with spinning-look prop discs.
  const props = [];
  for (const sx of [-1, 1]) for (const z of [-10, 50]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 18, 8), mat(0x33372f));
    nac.rotation.x = Math.PI / 2;
    nac.position.set(sx * 58, -34, z); g.add(nac);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(1, 30, 1.5), mat(0x222420));
    prop.position.set(sx * 58, -34, z - 11); g.add(prop);
    props.push(prop);
  }

  // Two ventral ball turrets — the flak guns.
  const guns = [];
  for (const z of [-40, 70]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), mat(0x35392f));
    ball.position.set(0, -74, z); g.add(ball);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 16, 6), mat(0x22241f));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, -76, z + 9); g.add(barrel);
    guns.push(new THREE.Vector3(0, -78, z));
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, guns, props, hull: { rx: 64, ry: 64, rz: 184 } };
}

// One rail car. variant picks loco / boxcar / tanker / hopper. Built facing +Z.
function buildCar(variant, color) {
  const g = new THREE.Group();
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(11, 3, 24), mat(0x26282a));
  chassis.position.y = 4; g.add(g.userData.chassis = chassis);
  // Bogies / wheels (two axles each end) for a bit of running gear.
  for (const z of [-8, 8]) for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 10), mat(0x141518));
    w.rotation.z = Math.PI / 2; w.position.set(sx * 5.5, 2.4, z); g.add(w);
  }

  if (variant === "loco") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 11, 18), mat(color));
    body.position.set(0, 11, -2); g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 6), mat(color));
    nose.position.set(0, 9, 9); nose.rotation.x = -0.32; g.add(nose);          // sloped snout
    const cab = new THREE.Mesh(new THREE.BoxGeometry(10.4, 7, 7), mat(0x2f3a30));
    cab.position.set(0, 18, -7); g.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(10.6, 3.4, 3), lit(0x223844));
    glass.position.set(0, 19, -3.5); g.add(glass);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 4, 8), mat(0x1c1d20));
    stack.position.set(0, 18, 5); g.add(stack);
  } else if (variant === "tanker") {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 22, 12), mat(color, { m: 0.3, r: 0.5 }));
    tank.rotation.x = Math.PI / 2; tank.position.set(0, 12, 0); g.add(tank);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 2, 8), mat(0x3a3d40));
    dome.position.set(0, 18, 0); g.add(dome);
  } else if (variant === "hopper") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 22), mat(color));
    body.position.set(0, 11, 0); g.add(body);
    // open coal/ore load
    const load = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 21), mat(0x2a2620));
    load.position.set(0, 16.5, 0); g.add(load);
  } else { // boxcar
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 11, 23), mat(color));
    body.position.set(0, 12, 0); g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.6, 1.6, 23.4), mat(0x4a4d50));
    roof.position.set(0, 18, 0); g.add(roof);
  }

  // Running lights so the train reads at night: amber markers down both sides
  // of every car, plus white headlights and a red tail-lamp on the loco.
  for (const sx of [-1, 1]) for (const z of [-8, 8]) {
    const m = new THREE.Mesh(LAMP_GEO, glow(0xffc46a, 2.2));
    m.position.set(sx * 5.7, variant === "loco" ? 14 : 12, z); g.add(m);
  }
  if (variant === "loco") {
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(LAMP_GEO, glow(0xfff4d6, 3.0)); hl.scale.setScalar(1.3);
      hl.position.set(sx * 3, 9.5, 12.4); g.add(hl);                 // headlights (front, +Z)
    }
    const tail = new THREE.Mesh(LAMP_GEO, glow(0xff3b30, 2.6));
    tail.position.set(0, 13, -11.2); g.add(tail);                    // red tail-lamp (rear)
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// The fixed offshore viaduct the train runs on: deck, two rails, sleepers and
// pylons marching down into the sea. Returns the static group plus the lane
// geometry (a straight line at xLane from zFar→zNear, at deck height y).
function buildViaduct(xLane, zFar, zNear, y) {
  const g = new THREE.Group();
  const len = zNear - zFar;
  const cz = (zFar + zNear) / 2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 4, len + 40), mat(0x6f7479, { r: 0.95 }));
  deck.position.set(xLane, y - 2, cz); g.add(deck);
  for (const sx of [-4.2, 4.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, len + 40), mat(0x9aa0a6, { m: 0.4, r: 0.5 }));
    rail.position.set(xLane + sx, y + 0.8, cz); g.add(rail);
  }
  // Sleepers + pylons as instanced meshes (the deck is long).
  const nTies = Math.max(1, Math.floor((len + 40) / 14));
  const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(15, 1.2, 4), mat(0x46352a), nTies);
  const m4 = new THREE.Matrix4(), noRot = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < nTies; i++) {
    p.set(xLane, y - 0.4, zFar - 20 + i * 14 + 7);
    ties.setMatrixAt(i, m4.compose(p, noRot, one));
  }
  ties.instanceMatrix.needsUpdate = true; ties.castShadow = true; ties.receiveShadow = true; g.add(ties);

  const nPyl = Math.max(1, Math.floor(len / 360));
  const drop = (y) - (-220); // from deck down past the sea surface
  const pyl = new THREE.InstancedMesh(new THREE.BoxGeometry(7, drop, 7), mat(0x595f63, { r: 1 }), nPyl * 2);
  let k = 0;
  for (let i = 0; i <= nPyl; i++) {
    const z = zFar + (i / nPyl) * len;
    for (const sx of [-4, 4]) {
      if (k >= nPyl * 2) break;
      p.set(xLane + sx, y - 4 - drop / 2, z);
      pyl.setMatrixAt(k++, m4.compose(p, noRot, one));
    }
  }
  pyl.count = k; pyl.instanceMatrix.needsUpdate = true; pyl.castShadow = true; g.add(pyl);

  return { group: g, xLane, zFar, zNear, y };
}

// ---------------------------------------------------------------------------
// Entities (each implements the target interface)
// ---------------------------------------------------------------------------

// Shared base: a thing that travels a straight ping-pong lane and can die +
// respawn. Subclasses supply geometry, hull tests and (optionally) guns.
class Mover {
  constructor(mgr) {
    this.mgr = mgr;
    this.alive = true;
    this.position = new THREE.Vector3();
    this.dyingT = 0;   // >0 while playing the death animation
    this.respawnT = 0;
    this.pauseT = 0;
    this.fireCd = Math.random() * FLAK_GAP;
    this.burst = 0;
  }
  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) this.die();
  }
  // Advance s along the lane, ping-ponging with a short dwell at each end.
  travel(dt) {
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    this.s += this.dir * this.speed * dt;
    if (this.s >= this.laneLen) { this.s = this.laneLen; this.dir = -1; this.pauseT = this.dwell; }
    else if (this.s <= 0) { this.s = 0; this.dir = 1; this.pauseT = this.dwell; }
  }
}

class Ship extends Mover {
  constructor(mgr, lane) {
    super(mgr);
    const b = buildCargoShip();
    this.group = b.group; this.gunLocal = b.gun; this.hull = b.hull;
    this.radius = 150; this.maxHealth = 340;
    this.lane = lane; this.dwell = 0; // ships just turn around, no dwell
    mgr.scene.add(this.group);
    this.spawn();
  }
  spawn() {
    this.alive = true; this.health = this.maxHealth; this.dyingT = 0;
    this.group.visible = true;
    this.s = Math.random() * (this.laneLen = this.lane.len);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = this.lane.speed;
    this.sink = 0;
    this.place();
  }
  place() {
    const L = this.lane;
    if (L.axis === "x") this.position.set(L.min + this.s, L.y - this.sink, L.fixed);
    else this.position.set(L.fixed, L.y - this.sink, L.min + this.s);
    this.group.position.copy(this.position);
    this.group.rotation.y = Math.atan2(L.axis === "x" ? this.dir : 0, L.axis === "z" ? this.dir : 0);
    this.group.rotation.z = this.sink ? -0.18 * (this.sink / 30) : 0; // list as she goes down
  }
  die() {
    this.alive = false; this.dyingT = 5.5;
    const c = this.position;
    for (let i = 0; i < 10; i++) {
      _v.set(c.x + (Math.random() - 0.5) * 80, c.y + 10 + Math.random() * 50, c.z + (Math.random() - 0.5) * 280);
      this.mgr.fx.add(_v, 3.4 + Math.random() * 2);
    }
    this.mgr.fx.burst(c, 0x40464c, 30);
  }
  update(dt, player) {
    if (!this.alive) {
      this.dyingT -= dt;
      this.sink = Math.min(30, this.sink + dt * 6);      // settle under the waves
      this.place();
      if (this.dyingT <= 0) { this.group.visible = false; this.respawnT = 6 + Math.random() * 4; this.dyingT = -1; }
      else if (Math.random() < dt * 1.5) this.mgr.fx.add(_v.copy(this.position).addScaledVector(_d.set((Math.random() - 0.5) * 80, 8, (Math.random() - 0.5) * 200), 1), 2.2);
      return;
    }
    this.travel(dt);
    this.place();
    this._fire(dt, player);
  }
  _fire(dt, player) {
    if (!player || !player.alive) return;
    _v.copy(this.gunLocal).applyQuaternion(this.group.quaternion).add(this.position);
    if (_v.distanceTo(player.position) > FLAK_RANGE) return;
    this.fireCd -= dt;
    if (this.fireCd <= 0) this.fireCd = this.mgr.flakBurst(this, _v, player);
  }
  // Oriented-box hull test (for player crashes).
  hullHit(pos) {
    if (!this.alive) return false;
    _v.copy(pos).sub(this.position);
    _q.copy(this.group.quaternion).invert(); _v.applyQuaternion(_q);
    const h = this.hull;
    return Math.abs(_v.x) < h.hx && _v.y > h.lo && _v.y < h.hi && Math.abs(_v.z) < h.hz;
  }
}

class Zeppelin extends Mover {
  constructor(mgr, lane) {
    super(mgr);
    const b = buildZeppelin();
    this.group = b.group; this.gunsLocal = b.guns; this.props = b.props; this.hull = b.hull;
    this.radius = 190; this.maxHealth = 520;
    this.lane = lane; this.dwell = 4;
    mgr.scene.add(this.group);
    this.spawn();
  }
  spawn() {
    this.alive = true; this.health = this.maxHealth; this.dyingT = 0;
    this.group.visible = true;
    this.laneLen = this.lane.len;
    this.s = Math.random() * this.laneLen;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = this.lane.speed;
    this.group.scale.set(1, 1, 1);
    this.fall = 0; this.bob = Math.random() * 6.28;
    this.place();
  }
  place() {
    const L = this.lane;
    this.position.set(L.x0 + (L.x1 - L.x0) * (this.s / this.laneLen), L.y - this.fall + Math.sin(this.bob) * 14, L.z);
    this.group.position.copy(this.position);
    // Yaw onto the heading; gentle roll bob; nose pitches down as she falls.
    this.group.rotation.set(this.fall ? 0.6 * (this.fall / 400) : 0, this.dir > 0 ? Math.PI / 2 : -Math.PI / 2, Math.sin(this.bob * 0.7) * 0.04);
  }
  die() {
    this.alive = false; this.dyingT = 4.5;
    const c = this.position;
    for (let i = 0; i < 12; i++) {
      _v.set(c.x + (Math.random() - 0.5) * 280, c.y + (Math.random() - 0.5) * 90, c.z + (Math.random() - 0.5) * 90);
      this.mgr.fx.add(_v, 3.2 + Math.random() * 2.4);
    }
    this.mgr.fx.burst(c, 0xff7a3c, 40);
  }
  update(dt, player) {
    for (const p of this.props) p.rotation.z += dt * (this.alive ? 26 : 4);
    if (!this.alive) {
      this.dyingT -= dt;
      this.fall += dt * (60 + (4.5 - this.dyingT) * 30); // accelerate downward
      this.group.scale.lerp(_d.set(0.7, 0.5, 1), Math.min(1, dt * 0.6)); // envelope deflates
      this.place();
      if (Math.random() < dt * 4) this.mgr.fx.add(_v.copy(this.position).add(_d.set((Math.random() - 0.5) * 200, 0, (Math.random() - 0.5) * 60)), 2.4);
      if (this.dyingT <= 0) { this.group.visible = false; this.respawnT = 8 + Math.random() * 5; this.dyingT = -1; }
      return;
    }
    this.travel(dt);
    this.bob += dt * 0.6;
    this.place();
    // Both turrets share one burst cadence (keeps the flak from being a wall).
    if (!player || !player.alive) return;
    const g = this.gunsLocal[this.s % 2 < 1 ? 0 : 1];
    _v.copy(g).applyQuaternion(this.group.quaternion).add(this.position);
    if (_v.distanceTo(player.position) > FLAK_RANGE) return;
    this.fireCd -= dt;
    if (this.fireCd <= 0) this.fireCd = this.mgr.flakBurst(this, _v, player);
  }
  hullHit(pos) {
    if (!this.alive) return false;
    _v.copy(pos).sub(this.position);
    _q.copy(this.group.quaternion).invert(); _v.applyQuaternion(_q);
    const h = this.hull;
    return (_v.x * _v.x) / (h.rx * h.rx) + (_v.y * _v.y) / (h.ry * h.ry) + (_v.z * _v.z) / (h.rz * h.rz) < 1;
  }
}

// A single rail car target. Position is driven by the parent Train; the car
// only owns its own life/health and explodes in place when killed.
class RailCar {
  constructor(scene, fx, train, variant, color, isLoco) {
    this.fx = fx; this.train = train; this.isLoco = isLoco;
    this.group = buildCar(variant, color);
    this.position = new THREE.Vector3();
    this.radius = isLoco ? 16 : 14;
    this.maxHealth = isLoco ? 60 : 30;
    this.health = this.maxHealth;
    this.alive = true;
    scene.add(this.group);
  }
  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) this.die();
  }
  die() {
    this.alive = false; this.group.visible = false;
    this.fx.add(_v.copy(this.position).setY(this.position.y + 8), this.isLoco ? 3.2 : 2.4);
    this.fx.burst(this.position, 0x6a5040, this.isLoco ? 18 : 12);
    this.train.onCarDestroyed();
  }
  reset() { this.alive = true; this.health = this.maxHealth; this.group.visible = true; }
}

// The train: owns the cars, runs them along the viaduct lane, respawns the
// whole consist once it's been wiped out.
class Train {
  constructor(mgr, lane) {
    this.mgr = mgr; this.lane = lane;
    this.spacing = 30;
    const palette = [0x8a4a3a, 0x415a6a, 0x5a6a45, 0x7a6a3a];
    const variants = ["boxcar", "tanker", "hopper", "boxcar", "tanker"];
    this.cars = [new RailCar(mgr.scene, mgr.fx, this, "loco", 0x2f6b3a, true)];
    for (let i = 0; i < variants.length; i++)
      this.cars.push(new RailCar(mgr.scene, mgr.fx, this, variants[i], palette[i % palette.length], false));
    this.laneLen = lane.len - (this.cars.length - 1) * this.spacing - 40;
    this.spawn();
  }
  get targets() { return this.cars; }
  spawn() {
    this.s = 20; this.dir = 1; this.speed = this.lane.speed; this.pauseT = 0; this.respawnT = 0;
    for (const c of this.cars) c.reset();
    this.place();
  }
  onCarDestroyed() {
    if (this.cars.every((c) => !c.alive)) this.respawnT = 7 + Math.random() * 4;
  }
  place() {
    const L = this.lane;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const z = L.zFar + this.s + 20 + (this.cars.length - 1 - i) * this.spacing; // loco leads toward island
      c.position.set(L.xLane, L.y + 2, z);
      c.group.position.copy(c.position);
      c.group.rotation.y = this.dir > 0 ? 0 : Math.PI;
    }
  }
  update(dt) {
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) this.spawn(); return; }
    if (this.cars.every((c) => !c.alive)) return;
    if (this.pauseT > 0) this.pauseT -= dt;
    else {
      this.s += this.dir * this.speed * dt;
      if (this.s >= this.laneLen) { this.s = this.laneLen; this.dir = -1; this.pauseT = 2.5; }
      else if (this.s <= 0) { this.s = 0; this.dir = 1; this.pauseT = 2.5; }
    }
    this.place();
  }
  hullHit(pos) {
    for (const c of this.cars) {
      if (!c.alive) continue;
      const dx = pos.x - c.position.x, dz = pos.z - c.position.z;
      if (Math.abs(dx) < 8 && Math.abs(dz) < 14 && Math.abs(pos.y - (c.position.y + 12)) < 16) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Island loop train: a closed circuit that hugs the terrain, riding at sea
// level wherever the loop crosses water — so one continuous loop can run over
// land and bridge across rivers/bays and back.
// ---------------------------------------------------------------------------

const LOOP_N = 360;       // samples around the loop
const LAND_CLEAR = 3;     // how far the deck sits above terrain on land
const SEA_MIN = 70;       // minimum deck height above sea — an elevated trestle over water
const CAR_SCALE = 1.9;    // the loop cars run large so they read from altitude
const GAUGE = 9.5;        // half the rail-to-rail spacing (matches the scaled wheels)
const BED_HW = 13;        // ballast-bed half-width
const RAIL_HY = 1.7;      // rail height above the deck
const POST_STEP = 4;      // place a support bent every N samples
const POST_W = 3.2;       // support-leg thickness
const _lpPos = new THREE.Vector3(), _lpDir = new THREE.Vector3(), _lp = { pos: _lpPos, dir: _lpDir };

// Sample the closed loop centreline. Each point's deck height is
// max(terrain + LAND_CLEAR, sea + SEA_MIN): it hugs the ground on land but never
// drops below a fixed height over water, so water crossings become an elevated
// trestle. The deck is smoothed (then re-clamped above the surface) so grades
// are gentle, and `surf` records the actual ground/sea surface for the posts.
function buildLoopPath(cx, cz) {
  const xs = new Float32Array(LOOP_N), zs = new Float32Array(LOOP_N), ys = new Float32Array(LOOP_N), surf = new Float32Array(LOOP_N);
  const A = 7600, B = 6200;
  for (let i = 0; i < LOOP_N; i++) {
    const t = (i / LOOP_N) * Math.PI * 2;
    const x = cx + A * Math.cos(t) + 700 * Math.sin(2 * t);   // wobble off a plain ellipse
    const z = cz + B * Math.sin(t) + 600 * Math.cos(3 * t);
    const th = terrainHeight(x, z);
    xs[i] = x; zs[i] = z;
    surf[i] = Math.max(th, SEA_LEVEL);
    ys[i] = Math.max(th + LAND_CLEAR, SEA_LEVEL + SEA_MIN);
  }
  // Smooth the deck for gentle grades, then keep it above the surface.
  const tmp = new Float32Array(LOOP_N);
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < LOOP_N; i++) tmp[i] = (ys[(i - 1 + LOOP_N) % LOOP_N] + ys[i] * 2 + ys[(i + 1) % LOOP_N]) / 4;
    ys.set(tmp);
  }
  for (let i = 0; i < LOOP_N; i++) if (ys[i] < surf[i] + 1) ys[i] = surf[i] + 1;
  const cum = new Float32Array(LOOP_N + 1);
  for (let i = 0; i < LOOP_N; i++) {
    const j = (i + 1) % LOOP_N;
    cum[i + 1] = cum[i] + Math.hypot(xs[j] - xs[i], zs[j] - zs[i]); // horizontal arc length, closed
  }
  return { xs, zs, ys, surf, cum, L: cum[LOOP_N] };
}

// Position + 3D tangent at arc-length s (wraps around the loop).
function sampleLoop(p, s) {
  const L = p.L; s = ((s % L) + L) % L;
  let lo = 0, hi = LOOP_N;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= s) lo = mid; else hi = mid; }
  const i = lo, j = (i + 1) % LOOP_N, seg = (p.cum[i + 1] - p.cum[i]) || 1, t = (s - p.cum[i]) / seg;
  _lpPos.set(p.xs[i] + (p.xs[j] - p.xs[i]) * t, p.ys[i] + (p.ys[j] - p.ys[i]) * t, p.zs[i] + (p.zs[j] - p.zs[i]) * t);
  _lpDir.set(p.xs[j] - p.xs[i], p.ys[j] - p.ys[i], p.zs[j] - p.zs[i]);
  if (_lpDir.lengthSq() < 1e-6) _lpDir.set(0, 0, 1); else _lpDir.normalize();
  return _lp;
}

// A flat ribbon mesh following the loop, offset sideways by `off`, half-width
// `hw`, raised `hy` over the deck — used for the ballast bed and the two rails.
function loopRibbon(p, off, hw, hy, color, opts = {}) {
  const verts = new Float32Array(LOOP_N * 2 * 3), idx = [];
  for (let i = 0; i < LOOP_N; i++) {
    const ip = (i - 1 + LOOP_N) % LOOP_N, inx = (i + 1) % LOOP_N;
    let dx = p.xs[inx] - p.xs[ip], dz = p.zs[inx] - p.zs[ip];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const px = -dz, pz = dx;                       // left-perpendicular (horizontal)
    const ccx = p.xs[i] + px * off, ccz = p.zs[i] + pz * off, y = p.ys[i] + hy;
    const li = i * 6;
    verts[li] = ccx + px * hw; verts[li + 1] = y; verts[li + 2] = ccz + pz * hw;
    verts[li + 3] = ccx - px * hw; verts[li + 4] = y; verts[li + 5] = ccz - pz * hw;
  }
  for (let i = 0; i < LOOP_N; i++) {
    const j = (i + 1) % LOOP_N, a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const material = mat(color, opts);
  material.side = THREE.DoubleSide; // visible from above regardless of triangle winding
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true; m.castShadow = false;
  return m;
}

// Support bents (paired vertical legs at the rail offsets) marching down from the
// deck to the surface below — so the track stands on posts, especially over water.
function buildLoopPosts(p) {
  const legs = [];
  for (let i = 0; i < LOOP_N; i += POST_STEP) {
    const ip = (i - 1 + LOOP_N) % LOOP_N, inx = (i + 1) % LOOP_N;
    let dx = p.xs[inx] - p.xs[ip], dz = p.zs[inx] - p.zs[ip];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const px = -dz, pz = dx;
    const top = p.ys[i] + 0.4, bot = p.surf[i] - 4, h = top - bot;
    if (h < 3) continue;
    for (const s of [-GAUGE, GAUGE]) legs.push({ x: p.xs[i] + px * s, y: (top + bot) / 2, z: p.zs[i] + pz * s, h });
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x5a554e, { r: 1 }), Math.max(1, legs.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  legs.forEach((l, k) => { pos.set(l.x, l.y, l.z); sc.set(POST_W, l.h, POST_W); im.setMatrixAt(k, m4.compose(pos, q, sc)); });
  im.count = legs.length;
  im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
  return im;
}

class LoopTrain {
  constructor(mgr, cx, cz) {
    this.mgr = mgr;
    this.path = buildLoopPath(cx, cz);
    this.track = new THREE.Group();
    this.track.add(loopRibbon(this.path, 0, BED_HW, 0.4, 0x39342f, { r: 1 }));                      // ballast bed
    this.track.add(loopRibbon(this.path, GAUGE, 0.9, RAIL_HY, 0x9aa0a6, { m: 0.4, r: 0.5 }));        // rails
    this.track.add(loopRibbon(this.path, -GAUGE, 0.9, RAIL_HY, 0x9aa0a6, { m: 0.4, r: 0.5 }));
    this.track.add(buildLoopPosts(this.path));                                                       // support bents
    mgr.scene.add(this.track);

    this.spacing = 30 * CAR_SCALE; this.speed = 230;
    const palette = [0x6a4a3a, 0x40566a, 0x55663f, 0x7a6a3a, 0x4a4f55];
    const variants = ["boxcar", "tanker", "hopper", "boxcar", "tanker"];
    this.cars = [new RailCar(mgr.scene, mgr.fx, this, "loco", 0x394b3a, true)];
    for (let i = 0; i < variants.length; i++)
      this.cars.push(new RailCar(mgr.scene, mgr.fx, this, variants[i], palette[i % palette.length], false));
    for (const c of this.cars) { c.group.scale.setScalar(CAR_SCALE); c.radius *= CAR_SCALE; } // bigger cars + hit boxes
    this.spawn();
  }
  spawn() { this.s = 0; this.respawnT = 0; for (const c of this.cars) c.reset(); this.place(); }
  onCarDestroyed() { if (this.cars.every((c) => !c.alive)) this.respawnT = 8 + Math.random() * 5; }
  place() {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const sr = sampleLoop(this.path, this.s - i * this.spacing); // loco (i=0) leads
      c.position.copy(sr.pos); c.position.y += RAIL_HY;            // wheels sit on the rails
      c.group.position.copy(c.position);
      c.group.rotation.order = "YXZ";
      c.group.rotation.y = Math.atan2(sr.dir.x, sr.dir.z);         // yaw onto heading
      c.group.rotation.x = -Math.asin(THREE.MathUtils.clamp(sr.dir.y, -1, 1)); // pitch up/down slopes
    }
  }
  update(dt) {
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) this.spawn(); return; }
    if (this.cars.every((c) => !c.alive)) return;
    this.s += this.speed * dt;  // continuous — sampleLoop wraps it around the circuit
    this.place();
  }
  hullHit(pos) {
    for (const c of this.cars) {
      if (!c.alive) continue;
      const dx = pos.x - c.position.x, dz = pos.z - c.position.z;
      if (Math.abs(dx) < 16 && Math.abs(dz) < 26 && Math.abs(pos.y - (c.position.y + 18)) < 32) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class Traffic {
  constructor(scene, fx, opts = {}) {
    this.scene = scene;
    this.fx = fx;
    this.onFire = null; // callback(position) for flak sound
    this.movers = [];   // ships + zeppelin
    this.trains = [];
    this.bullets = [];
    this.bulletGeo = new THREE.BoxGeometry(0.9, 0.9, 15);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd23c });

    const islands = opts.islands && opts.islands.length ? opts.islands : [{ center: { x: 0, z: 0 } }];
    const sea = opts.sea ?? -180;
    const A = islands[0].center;
    const B = (islands[1] || islands[0]).center;

    // Container-ship lanes out in open water, clear of the islands.
    this.movers.push(new Ship(this, { axis: "x", fixed: A.z - 19000, y: sea, min: A.x - 17000, len: 34000, speed: 17 }));
    this.movers.push(new Ship(this, { axis: "z", fixed: A.x - 17000, y: sea, min: A.z - 16000, len: 32000, speed: 14 }));
    this.movers.push(new Ship(this, { axis: "x", fixed: B.z + 16000, y: sea, min: B.x - 15000, len: 30000, speed: 15 }));

    // War zeppelin drifting between the first two islands at altitude.
    this.movers.push(new Zeppelin(this, {
      x0: A.x + 2000, x1: B.x - 2000, z: (A.z + B.z) / 2 + 1500, y: sea + 1650, len: Math.max(8000, Math.abs(B.x - A.x) - 4000), speed: 13,
    }));

    // Freight train on an offshore viaduct south-west of the home island.
    const xLane = A.x - 6000, zFar = A.z - 14400, zNear = A.z - 8800, vy = sea + 95;
    this.viaduct = buildViaduct(xLane, zFar, zNear, vy);
    scene.add(this.viaduct.group);
    this.trains.push(new Train(this, { xLane, zFar, zNear, len: zNear - zFar, y: vy, speed: 60 }));

    // A second train running a continuous terrain-hugging loop on the home
    // island — bridges across rivers/bays at sea level and back onto land.
    this.trains.push(new LoopTrain(this, A.x, A.z));
  }

  // Live target list (ships, zeppelin, every surviving rail car).
  get targets() {
    const out = [];
    for (const m of this.movers) out.push(m);
    for (const t of this.trains) for (const c of t.cars) out.push(c);
    return out;
  }

  // Fire one round of a burst from gun world-pos `gp`; return the delay to the
  // next round (short within a burst, a longer randomised gap between bursts).
  flakBurst(ent, gp, player) {
    if (ent.burst <= 0) ent.burst = FLAK_BURST + (Math.random() * FLAK_BURST_VAR | 0);
    _d.copy(player.position).sub(gp).normalize();
    _d.x += (Math.random() - 0.5) * 0.045; _d.y += (Math.random() - 0.5) * 0.045; _d.z += (Math.random() - 0.5) * 0.045;
    _d.normalize();
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(gp); m.lookAt(_v.copy(gp).add(_d));
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: _d.clone().multiplyScalar(FLAK_SPEED), life: FLAK_LIFE });
    if (this.onFire) this.onFire(gp);
    ent.burst--;
    return ent.burst > 0 ? FLAK_SHOT : FLAK_GAP * (0.7 + Math.random() * 0.6);
  }

  update(dt, player) {
    for (const m of this.movers) {
      if (m.respawnT > 0) { m.respawnT -= dt; if (m.respawnT <= 0) m.spawn(); }
      else m.update(dt, player);
    }
    for (const t of this.trains) t.update(dt);

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (player && player.alive && b.mesh.position.distanceTo(player.position) < player.radius + 8) {
        player.applyDamage(FLAK_DAMAGE); hit = true;
      }
      if (hit || b.life <= 0) { this.scene.remove(b.mesh); this.bullets.splice(i, 1); }
    }
  }

  // True if a point sits inside any solid hull — used for player crashes.
  collides(pos) {
    for (const m of this.movers) if (m.hullHit && m.hullHit(pos)) return true;
    for (const t of this.trains) if (t.hullHit(pos)) return true;
    return false;
  }
}
