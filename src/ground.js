import * as THREE from "three";
import { terrainHeight, riverCenterX, getMissionBases, buildPowerPlant } from "./world.js";

// Strike-mission ground targets: stationary structures sitting on the terrain
// that you destroy with guns/missiles. Same { position, radius, alive, hit }
// interface the player's weapons use. They don't respawn — clear them all to
// complete the mission.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

// SAM batteries: an airborne player within range gets engaged with guided
// missiles (their specialty) and the odd dumb-fire volley, via the shared
// EnemyOrdnance pool.
const SAM_RANGE = 3400;     // engagement radius
const SAM_RELOAD = 3.6;     // base seconds between launches
const SAM_MIN_ALT = 70;     // player must be this far above the deck to be shot at
const SAM_TURN = 1.5;       // seeker turn rate (still tamer than the player's)

// Carrier flak guns
const AA_RANGE = 2600;
// Flak fires in bursts, not a continuous stream.
const AA_SHOT = 0.16;      // seconds between rounds within a burst
const AA_BURST = 5;        // base rounds per burst (+0..3)
const AA_BURST_VAR = 4;
const AA_GAP = 1.4;        // base pause between bursts
const AA_BULLET_SPEED = 1000;
const AA_BULLET_LIFE = 3.0;
const AA_DAMAGE = 6;

// Light AA gun emplacements: scattered all around a base, they throw streams of
// tracer up at any airborne raider — long range so fire comes "from all over",
// but wildly inaccurate and barely scratch the paint. Pure atmosphere.
const AA_GUN_RANGE = 4600;     // they open up from a long way off
const AA_GUN_MIN_ALT = 45;     // ignore a target hugging the deck
const AA_GUN_SHOT = 0.1;       // seconds between rounds in a burst (a stream)
const AA_GUN_BURST = 5;        // base rounds per burst (+0..4)
const AA_GUN_BURST_VAR = 5;
const AA_GUN_GAP = 1.3;        // base pause between bursts
const AA_GUN_SPEED = 900;
const AA_GUN_LIFE = 2.8;
const AA_GUN_DAMAGE = 3;       // barely stings
const AA_GUN_SPREAD = 0.075;   // big cone — mostly misses (that's the point)

function gmat(c) {
  return new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85 });
}

class GTarget {
  constructor(scene, fx, type, x, z) {
    this.scene = scene;
    this.fx = fx;
    this.type = type;
    this.alive = true;
    this.objective = false; // set by MissionManager when this target is an objective
    this.spin = null;
    const g = new THREE.Group();

    if (type === "tank") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 18, 12), gmat(0xbfc4c8));
      body.position.y = 9; g.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 2, 12), gmat(0xd24b4b));
      cap.position.y = 18; g.add(cap);
      this.maxHealth = 50; this.radius = 32;
    } else if (type === "radar") {
      const base = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 16), gmat(0x6a7078));
      base.position.y = 4; g.add(base);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 10, 6), gmat(0x4a5058));
      mast.position.y = 10; g.add(mast);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gmat(0xdddddd));
      dish.position.y = 15; dish.rotation.x = -Math.PI / 3; g.add(dish);
      this.spin = dish;
      this.maxHealth = 30; this.radius = 26;
    } else if (type === "bunker") {
      const b = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 22), gmat(0x6d7358));
      b.position.y = 6; g.add(b);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 26), gmat(0x555a44));
      roof.position.y = 13; g.add(roof);
      this.maxHealth = 70; this.radius = 34;
    } else if (type === "powerplant") {
      const pp = buildPowerPlant();
      g.add(pp.group);
      this.maxHealth = 460; this.radius = 150;
      this._stacks = pp.stacks; // local smoke sources, lifted to world below
    } else if (type === "aa") {
      // A light flak gun: sandbagged ring, a swivelling mount, twin barrels
      // cocked skyward. The turret tracks the player; barrels stay elevated.
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 3, 8), gmat(0x5a5f4a));
      ring.position.y = 1.5; g.add(ring);
      const turret = new THREE.Group(); turret.position.y = 3;
      const mount = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 5), gmat(0x474b3a));
      mount.position.y = 1; turret.add(mount);
      const barrels = new THREE.Group(); barrels.position.set(0, 1.7, 0); barrels.rotation.x = -0.72; // elevated
      for (const s of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 11, 6), gmat(0x2c2f26));
        bar.rotation.x = Math.PI / 2; bar.position.set(s * 1.1, 0, 4.5); barrels.add(bar);
      }
      turret.add(barrels); g.add(turret);
      this.turret = turret;
      this.maxHealth = 22; this.radius = 22;
      this.fireCd = Math.random() * AA_GUN_GAP;
      this.burstLeft = 0;
      this.ambient = true; // flavour air-defense — doesn't gate mission/capture
    } else { // sam
      const b = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 16), gmat(0x4f5b3a));
      b.position.y = 2.5; g.add(b);
      this._tubes = [];
      for (const s of [-1, 1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 12, 6), gmat(0x33402a));
        tube.position.set(s * 3, 8, 0); tube.rotation.x = -0.5; g.add(tube);
        this._tubes.push(tube);
      }
      this.maxHealth = 40; this.radius = 26;
      this.reload = 1.5 + Math.random() * SAM_RELOAD; // stagger first launches
    }

    this.health = this.maxHealth;
    const gy = terrainHeight(x, z);
    g.position.set(x, gy, z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    this.group = g;
    // World-space smoke sources for the plumes (consumed by main.js while alive).
    if (this._stacks) this.smokeStacks = this._stacks.map((s) => ({
      x: x + s.lx, y: gy + s.ly, z: z + s.lz,
      size: s.size, rate: s.rate, color: s.color, rise: s.rise, drift: s.drift, life: s.life, grow: s.grow, wind: s.wind,
    }));
  }

  get position() { return this.group.position; }

  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) this.destroy();
  }

  destroy() {
    this.alive = false;
    this.group.visible = false;
    if (this.type === "powerplant") {
      // A big plant goes up in a long string of blasts (and the smoke stops).
      const c = this.group.position;
      for (let i = 0; i < 16; i++) {
        _v.set(c.x + (Math.random() - 0.5) * 200, c.y + 20 + Math.random() * 120, c.z + (Math.random() - 0.5) * 220);
        this.fx.add(_v, 3.0 + Math.random() * 2.4);
      }
      this.fx.burst(c, 0x70757a, 48);
    } else {
      this.fx.add(_v.copy(this.group.position).setY(this.group.position.y + 12), 3.4);
    }
  }

  update(dt, player, mgr) {
    if (!this.alive) return;
    if (this.spin) this.spin.rotation.z += dt * 1.2;

    // Light AA gun: hose tracer up at an airborne player — long reach, lousy aim.
    if (this.type === "aa" && mgr && player && player.alive) {
      const p = this.group.position;
      const d = p.distanceTo(player.position);
      const airborne = player.position.y > terrainHeight(player.position.x, player.position.z) + AA_GUN_MIN_ALT;
      if (d < AA_GUN_RANGE && airborne) {
        // Swivel the mount to track the threat (cosmetic).
        if (this.turret) {
          const yaw = Math.atan2(player.position.x - p.x, player.position.z - p.z);
          let dy = yaw - this.turret.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
          this.turret.rotation.y += dy * Math.min(1, dt * 3);
        }
        this.fireCd -= dt;
        if (this.fireCd <= 0) {
          const starting = this.burstLeft <= 0;
          if (starting) this.burstLeft = AA_GUN_BURST + (Math.random() * AA_GUN_BURST_VAR | 0);
          _v.set(p.x, p.y + 7, p.z); // muzzle, above the emplacement
          _dir.copy(player.position).sub(_v).normalize();
          _dir.x += (Math.random() - 0.5) * AA_GUN_SPREAD * 2;
          _dir.y += (Math.random() - 0.5) * AA_GUN_SPREAD * 2;
          _dir.z += (Math.random() - 0.5) * AA_GUN_SPREAD * 2;
          _dir.normalize();
          mgr.spawnBullet(_v, _dir, { tracer: true, dmg: AA_GUN_DAMAGE, speed: AA_GUN_SPEED, life: AA_GUN_LIFE, hitR: 5, silent: true });
          if (starting) { this.fx.add(_v, 0.5, 0xffd27d, true); if (mgr.onFire) mgr.onFire(p); } // muzzle flash + a single thump per burst
          this.burstLeft--;
          this.fireCd = this.burstLeft > 0 ? AA_GUN_SHOT : AA_GUN_GAP * (0.6 + Math.random() * 0.9);
          // Now and then, a flak airburst pops near the player for spectacle.
          if (this.burstLeft <= 0 && d < AA_GUN_RANGE * 0.7 && Math.random() < 0.45) mgr.flakBurst(player.position);
        }
      }
      return;
    }

    // SAM engagement: track + launch at an airborne player in range.
    if (this.type === "sam" && mgr && mgr.ordnance && player && player.alive) {
      const p = this.group.position;
      const d = p.distanceTo(player.position);
      // Slew the launch tubes to roughly face the threat (cosmetic).
      if (d < SAM_RANGE && this._tubes) {
        const yaw = Math.atan2(player.position.x - p.x, player.position.z - p.z);
        this.group.rotation.y += (yaw - this.group.rotation.y) * Math.min(1, dt * 2);
      }
      this.reload -= dt;
      const airborne = player.position.y > terrainHeight(player.position.x, player.position.z) + SAM_MIN_ALT;
      if (this.reload <= 0 && d < SAM_RANGE && airborne) {
        _v.set(p.x, p.y + 9, p.z); // launch from the tube tops
        if (Math.random() < 0.78) mgr.ordnance.fireSeeker(_v, player, { turn: SAM_TURN });
        else mgr.ordnance.fireDumb(_v, player.position);
        this.fx.add(_v, 0.5, 0xffd27d, true); // launch flash
        this.reload = SAM_RELOAD * (0.7 + Math.random() * 0.7);
        if (mgr.onLaunch) mgr.onLaunch(p);
      }
    }
  }
}

// The enemy carrier as a big, high-health strike target.
class CarrierTarget {
  constructor(fx, mesh, info) {
    this.fx = fx;
    this.mesh = mesh;
    this.alive = true;
    this.objective = false;
    this.radius = 140;
    this.maxHealth = 320;
    this.health = 320;
    this._pos = new THREE.Vector3(info.x, info.deckY + 8, info.z);
    this.info = info;
    // Flak guns at the bow and stern.
    this.forePos = new THREE.Vector3(info.x, info.deckY + 7, info.z - info.halfL * 0.85);
    this.aftPos = new THREE.Vector3(info.x, info.deckY + 7, info.z + info.halfL * 0.85);
    this.foreCd = Math.random() * AA_GAP;
    this.aftCd = AA_GAP * 0.5 + Math.random() * AA_GAP; // stagger the two guns
    this.foreBurst = 0; this.aftBurst = 0;
  }
  get position() { return this._pos; }
  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) this.destroy();
  }

  _fireFrom(gp, player, mgr) {
    _dir.copy(player.position).sub(gp).normalize();
    // a little spread so it's flak, not a laser
    _dir.x += (Math.random() - 0.5) * 0.04;
    _dir.y += (Math.random() - 0.5) * 0.04;
    _dir.z += (Math.random() - 0.5) * 0.04;
    _dir.normalize();
    mgr.spawnBullet(gp, _dir);
  }
  destroy() {
    this.alive = false;
    // A string of explosions the length of the deck + flying wreckage.
    for (let i = 0; i < 9; i++) {
      const p = this._pos.clone();
      p.x += (Math.random() - 0.5) * 64;
      p.z += (Math.random() - 0.5) * this.info.halfL * 1.8;
      p.y += Math.random() * 24;
      this.fx.add(p, 3.8);
    }
    this.fx.burst(this._pos, 0x556070, 26);
    if (this.mesh) this.mesh.visible = false;
  }
  update(dt, player, mgr) {
    if (!this.alive || !player || !player.alive) return;
    if (this._pos.distanceTo(player.position) > AA_RANGE) return;
    this.foreCd -= dt;
    this.aftCd -= dt;
    if (this.foreCd <= 0) this.foreCd = this._burstShot("fore", this.forePos, player, mgr);
    if (this.aftCd <= 0) this.aftCd = this._burstShot("aft", this.aftPos, player, mgr);
  }
  // Fire one round of a burst; return the delay until the next round (short
  // inside a burst, a longer randomised gap once the burst is spent).
  _burstShot(which, gp, player, mgr) {
    const key = which + "Burst";
    if (this[key] <= 0) this[key] = AA_BURST + (Math.random() * AA_BURST_VAR | 0);
    this._fireFrom(gp, player, mgr);
    this[key]--;
    return this[key] > 0 ? AA_SHOT : AA_GAP * (0.75 + Math.random() * 0.5);
  }
}

export class GroundTargets {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.list = [];
    this.total = 0;
    this.bullets = [];
    this.onFire = null; // callback(position) for sound (carrier flak)
    this.ordnance = null; // shared EnemyOrdnance pool (set by main.js) for SAM missiles
    this.onLaunch = null; // callback(position) — SAM launch sound
    this.bulletGeo = new THREE.BoxGeometry(0.9, 0.9, 16);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xff7a2c });
    // Bright, glowing tracer rounds for the light AA guns — a long streak in a
    // few alternating tracer colours, drawn additively so they pop against the
    // sky and sell the "raid under fire" curtain of tracer.
    this.tracerGeo = new THREE.BoxGeometry(0.6, 0.6, 26);
    this.tracerMats = [0xffd24a, 0xff8a3c, 0x9dff5a].map((c) =>
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  }

  // opts: { tracer, dmg, speed, life, hitR, silent }. Defaults reproduce the
  // carrier flak round.
  spawnBullet(pos, dir, opts = {}) {
    const tracer = !!opts.tracer;
    const m = new THREE.Mesh(tracer ? this.tracerGeo : this.bulletGeo,
      tracer ? this.tracerMats[(Math.random() * this.tracerMats.length) | 0] : this.bulletMat);
    m.position.copy(pos);
    m.lookAt(_v.copy(pos).add(dir));
    this.scene.add(m);
    this.bullets.push({
      mesh: m, vel: dir.clone().multiplyScalar(opts.speed || AA_BULLET_SPEED),
      life: opts.life || AA_BULLET_LIFE, dmg: opts.dmg != null ? opts.dmg : AA_DAMAGE, hitR: opts.hitR || 8,
    });
    if (this.onFire && !opts.silent) this.onFire(pos);
  }

  // A cosmetic flak airburst: a quick dark puff (and a faint spark) near a point,
  // offset by a random miss. No damage — it's all theatre.
  flakBurst(near) {
    _v2.set(near.x + (Math.random() - 0.5) * 130, near.y + 8 + (Math.random() - 0.5) * 70, near.z + (Math.random() - 0.5) * 130);
    this.fx.add(_v2.clone(), 1.2 + Math.random() * 0.6, 0x2b2f35, true); // soot puff, silent
  }

  get targets() { return this.list; }
  get destroyed() { let n = 0; for (const t of this.list) if (!t.alive) n++; return n; }
  get remaining() { return this.total - this.destroyed; }

  clear() {
    for (const t of this.list) if (t.group) this.scene.remove(t.group);
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.list = [];
    this.bullets = [];
    this.total = 0;
  }

  // active=true builds a mission's worth of targets; false clears them.
  // enemyMesh/enemyInfo (optional) add the enemy carrier as a target.
  setActive(active, enemyMesh, enemyInfo) {
    this.clear();
    if (enemyMesh) enemyMesh.visible = true; // restore if a prior mission sank it
    if (!active) return;
    const types = ["tank", "radar", "bunker", "sam"];
    // bases placed ahead of spawn (player starts facing -Z)
    const bases = getMissionBases();
    for (const [bx, bz] of bases) {
      const count = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        let x = bx, z = bz, tries = 0;
        do {
          x = bx + (Math.random() - 0.5) * 520;
          z = bz + (Math.random() - 0.5) * 520;
          tries++;
        } while (tries < 12 && (terrainHeight(x, z) < -20 || Math.abs(x - riverCenterX(z)) < 480));
        const type = types[Math.floor(Math.random() * types.length)];
        this.list.push(new GTarget(this.scene, this.fx, type, x, z));
      }
      // A ring of light AA guns spread WIDE around the base, so a raid flies into
      // tracer coming up from all directions.
      const aaCount = 4 + Math.floor(Math.random() * 3); // 4-6 per base
      for (let i = 0; i < aaCount; i++) {
        let x = bx, z = bz, tries = 0;
        do {
          const ang = Math.random() * Math.PI * 2, r = 260 + Math.random() * 560;
          x = bx + Math.cos(ang) * r; z = bz + Math.sin(ang) * r;
          tries++;
        } while (tries < 14 && (terrainHeight(x, z) < -10 || Math.abs(x - riverCenterX(z)) < 300));
        this.list.push(new GTarget(this.scene, this.fx, "aa", x, z));
      }
    }
    // A power plant at the first base — a big, smoking, high-value target.
    if (bases.length) {
      const [bx, bz] = bases[0];
      let px = bx + 620, pz = bz + 120;
      if (terrainHeight(px, pz) < -20) { px = bx - 620; pz = bz - 120; }
      this.list.push(new GTarget(this.scene, this.fx, "powerplant", px, pz));
    }
    if (enemyMesh && enemyInfo) {
      this.list.push(new CarrierTarget(this.fx, enemyMesh, enemyInfo));
    }
    this.total = this.list.length;
  }

  update(dt, player) {
    for (const t of this.list) t.update(dt, player, this);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (player && player.alive && b.mesh.position.distanceTo(player.position) < player.radius + b.hitR) {
        player.applyDamage(b.dmg);
        hit = true;
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }
}
