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

const MSL_DROP = 0.44;      // unpowered coast before the motor lights (the "hang")
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

// A smoke ribbon that traces the missile's path and widens + fades with age, so
// the trail looks like a dynamic, dissipating stream rather than a hard line.
const _UP = new THREE.Vector3(0, 1, 0);
class Ribbon {
  constructor(scene, { color = 0xccd1d6, maxPts = 46, maxAge = 0.8, baseW = 0.5, expand = 11, alpha = 0.5 } = {}) {
    this.scene = scene; this.maxPts = maxPts; this.maxAge = maxAge; this.baseW = baseW; this.expand = expand; this.alpha = alpha;
    this.pts = [];
    const pos = new Float32Array(maxPts * 2 * 3);
    const al = new Float32Array(maxPts * 2);
    const idx = new Uint16Array((maxPts - 1) * 6);
    for (let i = 0; i < maxPts - 1; i++) {
      const a = i * 2, o = i * 6;
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = a + 2;
      idx[o + 3] = a + 1; idx[o + 4] = a + 3; idx[o + 5] = a + 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(al, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: "attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uColor; varying float vA; void main(){ gl_FragColor=vec4(uColor, vA); }",
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._perp = new THREE.Vector3();
  }
  push(p, vel) {
    this._perp.crossVectors(vel, _UP);
    if (this._perp.lengthSq() < 1e-4) this._perp.set(1, 0, 0);
    this._perp.normalize();
    this.pts.push({ p: p.clone(), perp: this._perp.clone(), age: 0 });
    if (this.pts.length > this.maxPts) this.pts.shift();
  }
  // Returns false once the ribbon has fully dissipated (no points left).
  update(dt) {
    for (const s of this.pts) s.age += dt;
    while (this.pts.length && this.pts[0].age > this.maxAge) this.pts.shift();
    const n = this.pts.length;
    if (n < 2) { this.geo.setDrawRange(0, 0); return n > 0; }
    const pos = this.geo.attributes.position.array;
    const al = this.geo.attributes.aAlpha.array;
    for (let i = 0; i < n; i++) {
      const s = this.pts[i];
      const hw = this.baseW + s.age * this.expand;     // older segments fan out
      const a = Math.max(0, 1 - s.age / this.maxAge) * this.alpha;
      const v = i * 6;
      pos[v] = s.p.x + s.perp.x * hw; pos[v + 1] = s.p.y + s.perp.y * hw; pos[v + 2] = s.p.z + s.perp.z * hw;
      pos[v + 3] = s.p.x - s.perp.x * hw; pos[v + 4] = s.p.y - s.perp.y * hw; pos[v + 5] = s.p.z - s.perp.z * hw;
      al[i * 2] = a; al[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
    return true;
  }
  dispose() { this.scene.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }
}

export class Weapons {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.bullets = [];
    this.missiles = [];
    this.smoke = [];
    this.deadTrails = []; // orphaned ribbons finishing their fade after detonation
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
    // Little rocket-motor flame trailing the missile (lit after ignition).
    this.mslFlameGeo = new THREE.ConeGeometry(0.24, 1.5, 8);
    this.mslFlameMat = new THREE.MeshBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  reset(missileCount) {
    for (const b of this.bullets) this.scene.remove(b.mesh);
    for (const m of this.missiles) { this.scene.remove(m.mesh); if (m.trail) m.trail.dispose(); }
    for (const t of this.deadTrails) t.dispose();
    for (const s of this.smoke) this.scene.remove(s.mesh);
    this.bullets.length = 0;
    this.missiles.length = 0;
    this.deadTrails.length = 0;
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
    // Rocket flame child, trailing aft (+Z local); hidden until the motor lights.
    const flame = new THREE.Mesh(this.mslFlameGeo, this.mslFlameMat.clone());
    flame.rotation.x = Math.PI / 2; flame.position.z = 1.7; flame.visible = false;
    m.add(flame);
    this.scene.add(m);
    // Launch with the jet's velocity (so it hangs alongside) plus a downward
    // eject off the rail; the motor lights after MSL_DROP and it boosts away.
    const vel = new THREE.Vector3();
    if (jetVel) vel.copy(jetVel).multiplyScalar(1.6); // match the jet's ground speed
    vel.addScaledVector(_up, -16);                    // ejected down off the pylon
    this.missiles.push({
      mesh: m, vel, flame,
      trail: new Ribbon(this.scene),
      target: (this.locked && this.lock && this.lock.alive) ? this.lock : null,
      age: 0, lit: false, life: MSL_LIFE, smokeTimer: 0,
    });
    return true;
  }

  _emitSmoke(pos) {
    const s0 = 0.55 + Math.random() * 1.25;       // much wider size variation per puff
    const op0 = 0.35 + Math.random() * 0.3;
    const mesh = new THREE.Mesh(
      this.smokeGeo,
      new THREE.MeshBasicMaterial({ color: 0xc8ccd2, transparent: true, opacity: op0, depthWrite: false })
    );
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 1.4;
    mesh.position.y += (Math.random() - 0.5) * 1.4;
    mesh.position.z += (Math.random() - 0.5) * 1.4;
    mesh.scale.setScalar(s0);
    this.scene.add(mesh);
    this.smoke.push({ mesh, life: SMOKE_LIFE * (0.8 + Math.random() * 0.5), max: SMOKE_LIFE, s0, op0 });
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

      // Motor visuals once burning: flickering flame, smoke puffs + path ribbon.
      if (m.lit) {
        m.flame.visible = true;
        const fl = 0.7 + Math.random() * 0.6;
        m.flame.scale.set(fl, fl, 0.9 + Math.random() * 0.6);
        m.flame.material.opacity = 0.55 + Math.random() * 0.35;
        m.trail.push(m.mesh.position, m.vel);
        m.smokeTimer -= dt;
        if (m.smokeTimer <= 0) { m.smokeTimer = SMOKE_INTERVAL; this._emitSmoke(m.mesh.position); }
      }
      m.trail.update(dt);

      let detonate = false;
      const mp = m.mesh.position;
      // Ground/sea impact.
      if (mp.y <= surfaceAt(mp.x, mp.z)) {
        this.fx.add(mp, 2.4);
        if (this.onGroundImpact) this.onGroundImpact(mp); // leave a burning patch on land
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
        if (m.trail) { this.deadTrails.push(m.trail); m.trail = null; } // let the ribbon linger & fade out
        this.missiles.splice(i, 1);
      }
    }

    // Orphaned ribbons keep aging until they've fully dissipated.
    for (let i = this.deadTrails.length - 1; i >= 0; i--) {
      if (!this.deadTrails[i].update(dt)) { this.deadTrails[i].dispose(); this.deadTrails.splice(i, 1); }
    }

    // Age the smoke puffs: fade and gently expand (each its own size/opacity).
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life -= dt;
      const k = 1 - s.life / s.max;
      s.mesh.scale.setScalar(s.s0 * (1 + k * 3));
      s.mesh.material.opacity = Math.max(0, s.op0 * (1 - k));
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.smoke.splice(i, 1);
      }
    }
  }
}
