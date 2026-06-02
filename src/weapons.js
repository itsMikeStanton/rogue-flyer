import * as THREE from "three";

// Player offensive weapons: a forward-firing tracer cannon and lock-on homing
// missiles. Operates on a target list supplied each frame (the enemy entities),
// using the shared { position, radius, alive, hit(dmg) } interface.

const BULLET_SPEED = 1400;
const BULLET_LIFE = 2.0;
const FIRE_INTERVAL = 0.08;
const GUN_DAMAGE = 12;

const MSL_SPEED = 360;      // slower so you can watch them track
const MSL_LIFE = 8;
const MSL_TURN = 2.6;       // rad/s homing turn rate
const MSL_PROX = 75;        // detonation proximity (m)
const MSL_DAMAGE = 120;
const SMOKE_INTERVAL = 0.025; // seconds between smoke puffs
const SMOKE_LIFE = 0.9;

const LOCK_RANGE = 4800;
const LOCK_COS = Math.cos((26 * Math.PI) / 180); // forward cone half-angle

const _fwd = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _to = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

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
    this.lock = null; // current lock target (entity) for the HUD

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
  }

  fire(position, quaternion) {
    if (this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _nose.copy(position).addScaledVector(_fwd, 7);
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(_nose);
    m.quaternion.copy(quaternion);
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: _fwd.clone().multiplyScalar(BULLET_SPEED), life: BULLET_LIFE });
  }

  // Returns true if a missile launched.
  fireMissile(position, quaternion) {
    if (this.missileCount <= 0 || !this.lock || !this.lock.alive) return false;
    this.missileCount--;
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _nose.copy(position).addScaledVector(_fwd, 6);
    const m = new THREE.Mesh(this.mslGeo, this.mslMat);
    m.position.copy(_nose);
    m.quaternion.copy(quaternion);
    this.scene.add(m);
    this.missiles.push({
      mesh: m,
      dir: _fwd.clone(),
      target: this.lock,
      life: MSL_LIFE,
      smokeTimer: 0,
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

  _acquireLock(position, quaternion, targets) {
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
    this.lock = best;
  }

  update(dt, position, quaternion, targets) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this._acquireLock(position, quaternion, targets);

    // Cannon rounds.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      for (const t of targets) {
        if (!t.alive) continue;
        if (b.mesh.position.distanceTo(t.position) < t.radius) {
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

    // Homing missiles.
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.target && m.target.alive) {
        _desired.copy(m.target.position).sub(m.mesh.position).normalize();
        steer(m.dir, _desired, MSL_TURN * dt);
      }
      m.mesh.position.addScaledVector(m.dir, MSL_SPEED * dt);
      m.mesh.lookAt(_look.copy(m.mesh.position).add(m.dir));
      m.life -= dt;

      // lay a smoke trail
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = SMOKE_INTERVAL;
        this._emitSmoke(m.mesh.position);
      }

      let detonate = false;
      if (m.target && m.target.alive &&
          m.mesh.position.distanceTo(m.target.position) < MSL_PROX) {
        m.target.hit(MSL_DAMAGE);
        this.fx.add(m.mesh.position, 3.0, 0xffd23f);
        detonate = true;
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
