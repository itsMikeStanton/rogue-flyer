import * as THREE from "three";
import { groundHeightAt, SEA_LEVEL } from "./world.js";

// Impact height: solid ground/deck, but never below the sea surface.
function surfaceAt(x, z) {
  return Math.max(groundHeightAt(x, z), SEA_LEVEL);
}

// Player offensive weapons: a forward-firing tracer cannon and lock-on homing
// missiles. Operates on a target list supplied each frame (the enemy entities),
// using the shared { position, radius, alive, hit(dmg) } interface.

const BULLET_SPEED = 1400;
const BULLET_LIFE = 2.0;
const FIRE_INTERVAL = 0.08;
const GUN_DAMAGE = 12;

const MSL_DROP = 0.55;      // unpowered coast before the motor lights (the "hang")
const MSL_ACCEL = 1700;     // boost acceleration once lit (units/s^2)
const MSL_MAX = 1900;       // top speed — clearly faster than the jets
const MSL_G = 9.8;          // gravity during the coast (drops away from the jet)
const MSL_LIFE = 8;
const MSL_TURN = 3.0;       // rad/s homing turn rate (only while powered)
const MSL_PROX = 75;        // detonation proximity (m)
const MSL_DAMAGE = 120;
const SMOKE_INTERVAL = 0.02; // seconds between smoke puffs
const SMOKE_LIFE = 0.9;

const LOCK_RANGE = 2900;                          // ~ missile reach (speed * life)
const LOCK_COS = Math.cos((22 * Math.PI) / 180);  // must be loosely pointed at it
const LOCK_TIME = 1.6;                             // seconds holding it in the box to lock
const LOCK_DECAY = 0.6;                            // seconds to lose progress once it leaves

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _to = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _mdir = new THREE.Vector3();

function steer(dir, desired, maxRad) {
  const d = _desired.copy(desired).normalize();
  const dot = THREE.MathUtils.clamp(dir.dot(d), -1, 1);
  const ang = Math.acos(dot);
  if (ang > 1e-3) dir.lerp(d, Math.min(1, maxRad / ang)).normalize();
}

export class Weapons {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.bullets = [];
    this.missiles = [];
    this.smoke = [];
    this.cooldown = 0;
    this.missileCount = 0;
    // Intent-based lock: hold a target in the box to earn a guided launch.
    this.lock = null;          // target the HUD draws a box around (candidate or locked)
    this.lockProgress = 0;     // 0..1 acquisition progress
    this.locked = false;       // solid lock — missiles will guide
    this._mslSide = -1;        // alternate which wing missiles launch from

    this.bulletGeo = new THREE.BoxGeometry(0.7, 0.7, 16);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff066 });
    this.mslGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.6, 6);
    this.mslGeo.rotateX(Math.PI / 2); // align length with -Z when using lookAt
    this.mslMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x331100, flatShading: true });
    this.smokeGeo = new THREE.SphereGeometry(1.6, 6, 6);
  }

  reset(missileCount) {
    for (const b of this.bullets) this.scene.remove(b.mesh);
    for (const m of this.missiles) this.scene.remove(m.mesh);
    for (const s of this.smoke) this.scene.remove(s.mesh);
    this.bullets.length = 0;
    this.missiles.length = 0;
    this.smoke.length = 0;
    this.cooldown = 0;
    this.missileCount = missileCount || 0;
    this.lock = null;
    this.lockProgress = 0;
    this.locked = false;
  }

  fire(position, quaternion) {
    if (this.cooldown > 0) return false;
    this.cooldown = FIRE_INTERVAL;
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(quaternion).normalize();
    // Muzzle: ahead of and a touch below the jet, so rounds come from the gun
    // area — not out of the camera/your face in cockpit & chase views.
    _nose.copy(position).addScaledVector(_fwd, 6).addScaledVector(_up, -1.1);
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(_nose);
    m.quaternion.copy(quaternion);
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: _fwd.clone().multiplyScalar(BULLET_SPEED), life: BULLET_LIFE });
    return true;
  }

  // Returns true if a missile launched. It guides only on a SOLID lock; with no
  // lock (or only a partial one) it fires straight ahead as a dumb rocket.
  fireMissile(position, quaternion, jetVel) {
    if (this.missileCount <= 0) return false;
    this.missileCount--;
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _up.set(0, 1, 0).applyQuaternion(quaternion).normalize();
    _right.set(1, 0, 0).applyQuaternion(quaternion).normalize();
    // Alternate left/right underwing pylon.
    this._mslSide = -this._mslSide;
    _nose.copy(position)
      .addScaledVector(_right, this._mslSide * 2.8)
      .addScaledVector(_up, -0.6)
      .addScaledVector(_fwd, 1.0);
    const m = new THREE.Mesh(this.mslGeo, this.mslMat);
    m.position.copy(_nose);
    m.quaternion.copy(quaternion);
    this.scene.add(m);
    // Launch with the jet's velocity (so it hangs alongside) plus a downward
    // eject off the rail; the motor lights after MSL_DROP and it boosts away.
    const vel = new THREE.Vector3();
    if (jetVel) vel.copy(jetVel).multiplyScalar(1.6); // match the jet's ground speed
    vel.addScaledVector(_up, -16);                    // ejected down off the pylon
    this.missiles.push({
      mesh: m, vel,
      target: (this.locked && this.lock && this.lock.alive) ? this.lock : null,
      age: 0, lit: false, life: MSL_LIFE, smokeTimer: 0,
    });
    return true;
  }

  _emitSmoke(pos) {
    const mesh = new THREE.Mesh(
      this.smokeGeo,
      new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.55 })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.smoke.push({ mesh, life: SMOKE_LIFE });
  }

  // Pick the best target inside the lock box, then ramp/decay lock progress so
  // you must keep it in the reticle to earn a solid (guiding) lock.
  _acquireLock(dt, position, quaternion, targets) {
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    let best = null;
    let bestDot = LOCK_COS;
    for (const t of targets) {
      if (!t.alive) continue;
      _to.copy(t.position).sub(position);
      const dist = _to.length();
      if (dist > LOCK_RANGE || dist < 1) continue;
      _to.multiplyScalar(1 / dist);
      const dot = _fwd.dot(_to);
      if (dot > bestDot) { bestDot = dot; best = t; }
    }
    if (best) {
      if (best !== this.lock) { this.lock = best; this.lockProgress = 0; } // new candidate — start over
      else this.lockProgress = Math.min(1, this.lockProgress + dt / LOCK_TIME);
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt / LOCK_DECAY);
      if (this.lockProgress <= 0) this.lock = null;
    }
    this.locked = !!this.lock && this.lock.alive && this.lockProgress >= 1;
  }

  update(dt, position, quaternion, targets) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this._acquireLock(dt, position, quaternion, targets);

    // Cannon rounds.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      const bp = b.mesh.position;
      // Ground/sea impact: kick up a small (silent) puff.
      if (bp.y <= surfaceAt(bp.x, bp.z)) {
        this.fx.add(bp, 0.4, 0x9a8a6a, true);
        hit = true;
      }
      if (!hit) for (const t of targets) {
        if (!t.alive) continue;
        if (bp.distanceTo(t.position) < t.radius) {
          t.hit(GUN_DAMAGE);
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // Missiles: drop & coast, then the motor lights and they boost + home.
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      if (m.age < MSL_DROP) {
        // Unpowered coast — falls away from the jet, bleeds a little speed.
        m.vel.y -= MSL_G * dt;
        m.vel.multiplyScalar(1 - 0.5 * dt);
      } else {
        if (!m.lit) { m.lit = true; this.fx.add(m.mesh.position, 0.7, 0xffd27d, true); } // ignition flash
        let sp = m.vel.length() || 1;
        _mdir.copy(m.vel).multiplyScalar(1 / sp);
        if (m.target && m.target.alive) {
          _desired.copy(m.target.position).sub(m.mesh.position).normalize();
          steer(_mdir, _desired, MSL_TURN * dt);
        }
        sp = Math.min(MSL_MAX, sp + MSL_ACCEL * dt);
        m.vel.copy(_mdir).multiplyScalar(sp);
      }
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.lookAt(_look.copy(m.mesh.position).add(m.vel));
      m.life -= dt;

      // Smoke trail only once the motor is burning.
      if (m.lit) {
        m.smokeTimer -= dt;
        if (m.smokeTimer <= 0) {
          m.smokeTimer = SMOKE_INTERVAL;
          this._emitSmoke(m.mesh.position);
        }
      }

      let detonate = false;
      const mp = m.mesh.position;
      // Ground/sea impact.
      if (mp.y <= surfaceAt(mp.x, mp.z)) {
        this.fx.add(mp, 2.4);
        detonate = true;
      }
      // Proximity-detonate near ANY target, so unguided rockets also score hits.
      if (!detonate) for (const t of targets) {
        if (!t.alive) continue;
        if (mp.distanceTo(t.position) < MSL_PROX) {
          t.hit(MSL_DAMAGE);
          this.fx.add(mp, 3.0, 0xffd23f);
          detonate = true;
          break;
        }
      }
      if (detonate || m.life <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }

    // Age the smoke trail: fade and gently expand.
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life -= dt;
      const k = 1 - s.life / SMOKE_LIFE;
      s.mesh.scale.setScalar(1 + k * 3);
      s.mesh.material.opacity = Math.max(0, 0.55 * (1 - k));
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.smoke.splice(i, 1);
      }
    }
  }
}
