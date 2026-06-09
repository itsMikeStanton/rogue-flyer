import * as THREE from "three";
import { groundHeightAt, SEA_LEVEL } from "./world.js";
import { Ribbon } from "./weapons.js";

// Enemy ordnance shared by fighters AND ground sites (SAMs): guided seekers and
// unguided dumb-fire rockets, all aimed at the player. Kept in one place so both
// the air picket (enemies.js) and the SAM batteries (ground.js) fire the same
// projectiles — they just call fireSeeker()/fireDumb() and this manager flies,
// guides, draws, and resolves them against the player each frame.
//
// Design intent:
//   - Seekers home on the player but are DELIBERATELY dumber than the player's
//     own missiles: slower, a much wider turn radius, shorter legs, and far
//     easier to spoof with flares. Break hard across the nose and they go
//     ballistic.
//   - Dumb-fire rockets are sprayed straight at where you are. Roughly half are
//     "duds": they streak in and detonate close by for a heart-stopping flash —
//     but do no damage. The live ones only bite on a tight near-direct hit.

function surfaceAt(x, z) { return Math.max(groundHeightAt(x, z), SEA_LEVEL); }

// Seeker tuning — note how much tamer than the player's missiles (MSL_MAX 1900,
// MSL_TURN 3.0). The player keeps the edge.
const SEEK = {
  speed: 360, accel: 680, max: 940,
  turn: 1.3,          // rad/s — sloppy seeker head
  life: 7.5, prox: 46, dmg: 24,
  giveUpDot: -0.15,   // once the target slips this far behind the nose, go dumb
};
// Dumb rocket tuning.
const ROCKET = {
  speed: 600, life: 3.6, prox: 16,
  scareProx: 58,      // a dud detonates within this of you — a near miss, no harm
  dmg: 18, spread: 0.05, dudChance: 0.5,
};
// Player flares spoof enemy seekers MORE readily than the player's own missiles.
const FLARE_LIFE = 2.6, FLARE_SEEK = 360, FLARE_CONE = 0.18, FLARE_DIVERT = 4.4;
// Detonations within this of the player are reported for screen-shake / cues.
const NEARMISS = 95;

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _look = new THREE.Vector3();

function steer(dir, desired, maxRad) {
  _sd.copy(desired).normalize();
  const dot = THREE.MathUtils.clamp(dir.dot(_sd), -1, 1);
  const ang = Math.acos(dot);
  if (ang > 1e-3) dir.lerp(_sd, Math.min(1, maxRad / ang)).normalize();
  return dot;
}

export class EnemyOrdnance {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.missiles = [];    // seekers + dumb rockets (guided flag distinguishes)
    this.flares = [];      // player countermeasure decoys
    this.deadTrails = [];  // ribbons finishing their fade after detonation
    this.onLaunch = null;  // callback(pos, kind) — launch whoosh
    this.onNearMiss = null; // callback(pos, didDamage) — shake / suspense cue

    this.seekGeo = new THREE.CylinderGeometry(0.26, 0.26, 2.4, 6); this.seekGeo.rotateX(Math.PI / 2);
    this.rocketGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.4, 6); this.rocketGeo.rotateX(Math.PI / 2);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x34383d, emissive: 0x220606, flatShading: true });
    this.flameGeo = new THREE.ConeGeometry(0.22, 1.3, 8);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a3c, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  clear() {
    for (const m of this.missiles) { this.scene.remove(m.mesh); if (m.trail) m.trail.dispose(); }
    for (const t of this.deadTrails) t.dispose();
    this.missiles.length = 0;
    this.deadTrails.length = 0;
    this.flares.length = 0;
  }
  reset() { this.clear(); }

  // The player popped flares: drop a few decoy points seekers may chase.
  addFlares(pos) {
    for (let i = 0; i < 4; i++) {
      this.flares.push({
        position: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 12, pos.y + (Math.random() - 0.5) * 7, pos.z + (Math.random() - 0.5) * 12),
        life: FLARE_LIFE * (0.7 + Math.random() * 0.6),
      });
    }
  }

  _spawn(geo, origin, dir, flameZ, flameScale) {
    const m = new THREE.Mesh(geo, this.bodyMat);
    m.position.copy(origin);
    m.lookAt(_look.copy(origin).add(dir));
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat.clone());
    flame.rotation.x = Math.PI / 2; flame.position.z = flameZ; if (flameScale) flame.scale.setScalar(flameScale);
    m.add(flame);
    this.scene.add(m);
    return { m, flame };
  }

  // Guided shot at a moving target (the player object: { position, alive }).
  fireSeeker(origin, target, opts = {}) {
    _dir.copy(target.position).sub(origin).normalize();
    const { m, flame } = this._spawn(this.seekGeo, origin, _dir, 1.5);
    this.missiles.push({
      mesh: m, flame, guided: true, target,
      vel: _dir.clone().multiplyScalar(opts.speed || SEEK.speed),
      max: opts.max || SEEK.max, turn: opts.turn != null ? opts.turn : SEEK.turn,
      life: SEEK.life, dmg: opts.dmg != null ? opts.dmg : SEEK.dmg, prox: SEEK.prox,
      ballistic: false, decoyed: false, smokeT: 0,
      trail: new Ribbon(this.scene, { color: 0xd89c9c, baseW: 0.4, expand: 9, alpha: 0.45 }),
    });
    if (this.onLaunch) this.onLaunch(origin, "seeker");
  }

  // Unguided shot toward a point (the player's position at fire time), with
  // scatter. Some are duds — theatrical near-misses that deal no damage.
  fireDumb(origin, aimPoint, opts = {}) {
    _dir.copy(aimPoint).sub(origin).normalize();
    _dir.x += (Math.random() - 0.5) * ROCKET.spread * 2;
    _dir.y += (Math.random() - 0.5) * ROCKET.spread * 2;
    _dir.z += (Math.random() - 0.5) * ROCKET.spread * 2;
    _dir.normalize();
    const { m, flame } = this._spawn(this.rocketGeo, origin, _dir, 1.0, 0.7);
    this.missiles.push({
      mesh: m, flame, guided: false, target: null,
      vel: _dir.clone().multiplyScalar(opts.speed || ROCKET.speed),
      life: ROCKET.life, dmg: opts.dmg != null ? opts.dmg : ROCKET.dmg, prox: ROCKET.prox,
      dud: opts.dud != null ? opts.dud : Math.random() < ROCKET.dudChance,
      lastD: Infinity, smokeT: 0,
      trail: new Ribbon(this.scene, { color: 0xb0b4b8, baseW: 0.25, expand: 6, alpha: 0.35 }),
    });
    if (this.onLaunch) this.onLaunch(origin, "rocket");
  }

  _detonate(m, pos, size, color, silent) {
    this.fx.add(pos, size, color, silent);
    this.scene.remove(m.mesh);
    if (m.trail) { this.deadTrails.push(m.trail); m.trail = null; }
  }
  _report(pos, dmg, player) {
    if (this.onNearMiss && player && player.alive && pos.distanceTo(player.position) < NEARMISS) this.onNearMiss(pos, dmg > 0);
  }

  update(dt, player) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      this.flares[i].life -= dt;
      if (this.flares[i].life <= 0) this.flares.splice(i, 1);
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      let sp = m.vel.length() || 1;

      if (m.guided && !m.ballistic) {
        _dir.copy(m.vel).multiplyScalar(1 / sp);
        // Flare spoof: a decoy close and roughly ahead can steal the lock.
        if (!m.decoyed && this.flares.length) {
          for (const f of this.flares) {
            _to.copy(f.position).sub(m.mesh.position);
            const d = _to.length();
            if (d > 1 && d < FLARE_SEEK && _to.multiplyScalar(1 / d).dot(_dir) > FLARE_CONE && Math.random() < FLARE_DIVERT * dt) {
              m.target = { position: f.position, alive: true, isFlare: true }; m.decoyed = true; break;
            }
          }
        }
        const tgt = m.target && (m.target.alive || m.target.isFlare) ? m.target : null;
        if (tgt) {
          _sd.copy(tgt.position).sub(m.mesh.position);
          const dot = steer(_dir, _sd, m.turn * dt);
          if (!m.decoyed && dot < SEEK.giveUpDot) m.ballistic = true; // lost the angle → coast on
        } else {
          m.ballistic = true;
        }
        sp = Math.min(m.max, sp + SEEK.accel * dt);
        m.vel.copy(_dir).multiplyScalar(sp);
      }

      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.lookAt(_look.copy(m.mesh.position).add(m.vel));
      m.life -= dt;

      // Motor flame flicker + smoke ribbon.
      const fl = 0.7 + Math.random() * 0.6;
      m.flame.scale.set(fl, fl, 0.9 + Math.random() * 0.5);
      m.flame.material.opacity = 0.6 + Math.random() * 0.3;
      m.trail.push(m.mesh.position, m.vel);
      m.trail.update(dt);

      const mp = m.mesh.position;
      let done = false;

      // Ground / sea impact (a hit right beside you still rattles the cockpit).
      if (mp.y <= surfaceAt(mp.x, mp.z)) { this._detonate(m, mp, m.guided ? 2.2 : 1.5); this._report(mp, 0, player); done = true; }

      // Seeker that took a flare burns off harmlessly at the decoy.
      if (!done && m.decoyed && m.target && mp.distanceTo(m.target.position) < m.prox) {
        this._detonate(m, mp, 1.6, 0xffd23f); done = true;
      }

      // Against the player.
      if (!done && player && player.alive) {
        const d = mp.distanceTo(player.position);
        if (m.guided) {
          if (d < m.prox) { this._detonate(m, mp, 2.6, 0xffd23f); this._report(mp, m.dmg, player); player.applyDamage(m.dmg); done = true; }
        } else if (m.dud) {
          // Dud: blow at closest approach inside the scare bubble — a near miss.
          if (d < ROCKET.scareProx && d > m.lastD) { this._detonate(m, mp, 1.9, 0xffcaa0); this._report(mp, 0, player); done = true; }
        } else {
          if (d < m.prox) { this._detonate(m, mp, 2.0, 0xffd23f); this._report(mp, m.dmg, player); player.applyDamage(m.dmg); done = true; }
        }
        m.lastD = d;
      }

      // Burn out: a small silent fizzle so it doesn't just vanish.
      if (!done && m.life <= 0) { this._detonate(m, mp, m.guided ? 1.4 : 1.1, 0x9a8a6a, true); done = true; }

      if (done) this.missiles.splice(i, 1);
    }

    for (let i = this.deadTrails.length - 1; i >= 0; i--) {
      if (!this.deadTrails[i].update(dt)) { this.deadTrails[i].dispose(); this.deadTrails.splice(i, 1); }
    }
  }
}
