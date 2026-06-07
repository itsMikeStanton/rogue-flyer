import * as THREE from "three";
import { buildAircraftMesh } from "./aircraft.js";

// Enemy squadron manager. Two kinds of contact:
//   "drone"   – passive target that drifts in a circle (Target Practice)
//   "fighter" – AI jet that pursues the player and fires its gun (Dogfight)
// Entities are also the targets the player's weapons hit (shared interface:
// { position, radius, alive, hit(dmg) }). Downed contacts respawn so the
// action keeps going.

const EB_SPEED = 1100;   // enemy bullet speed (m/s)
const EB_LIFE = 2.2;
const EB_DAMAGE = 9;
// Fire in bursts, not a continuous stream: a handful of rounds close together,
// then a longer (slightly random) pause before the next burst.
const FIGHTER_SHOT = 0.09;        // seconds between rounds within a burst
const FIGHTER_BURST = 6;          // base rounds per burst (+0..3)
const FIGHTER_BURST_VAR = 4;
const FIGHTER_GAP = 1.1;          // base pause between bursts

const _to = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

// Rotate `dir` toward `desired` by at most maxRad; returns alignment dot.
function steer(dir, desired, maxRad) {
  const d = _desired.copy(desired).normalize();
  const dot = THREE.MathUtils.clamp(dir.dot(d), -1, 1);
  const ang = Math.acos(dot);
  if (ang > 1e-3) {
    const t = Math.min(1, maxRad / ang);
    dir.lerp(d, t).normalize();
  }
  return dot;
}

class Entity {
  constructor(manager, kind) {
    this.manager = manager;
    this.kind = kind;
    this.alive = true;
    this.respawn = 0;
    this.position = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.speed = 180;
    this.fireCd = Math.random();
    this.burstLeft = 0; // rounds remaining in the current burst

    if (kind === "fighter") {
      this.radius = 30;
      this.maxHealth = 30;
      this.mesh = buildAircraftMesh(Math.random() < 0.5 ? "fa18" : "f16", 0xb84a4a);
      if (this.mesh.userData.gear) this.mesh.userData.gear.visible = false; // gear up in the air
    } else {
      this.radius = 55;
      this.maxHealth = 1;
      this.mesh = this._buildDrone();
    }
    manager.scene.add(this.mesh);
    this.place();
  }

  _buildDrone() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.OctahedronGeometry(14, 0),
      new THREE.MeshStandardMaterial({ color: 0xd23b3b, flatShading: true, emissive: 0x401010 })
    );
    group.add(body);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(22, 3, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return group;
  }

  // (Re)spawn somewhere out in front of the spawn area, at altitude.
  place() {
    this.alive = true;
    this.health = this.maxHealth;
    this.mesh.visible = true;
    const cx = (Math.random() - 0.5) * 9000;
    const cz = -2500 - Math.random() * 7000;
    const cy = 900 + Math.random() * 1700;
    this.position.set(cx, cy, cz);

    if (this.kind === "drone") {
      this.center = new THREE.Vector3(cx, cy, cz);
      this.r = 300 + Math.random() * 700;
      this.angle = Math.random() * Math.PI * 2;
      this.angSpeed = (0.15 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1);
      this.bob = 30 + Math.random() * 50;
    } else {
      this.dir.set((Math.random() - 0.5), 0, -1).normalize();
      this.speed = 190;
      this.fireCd = 0.5 + Math.random();
    }
  }

  hit(dmg) {
    if (!this.alive) return;
    this.health -= dmg;
    if (this.health <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.mesh.visible = false;
    this.respawn = 4 + Math.random() * 3;
    this.manager.kills++;
    this.manager.fx.add(this.position, this.kind === "fighter" ? 2.4 : 1.4);
    if (this.kind === "fighter") this.manager.fx.burst(this.position, 0xb84a4a, 12);
  }

  update(dt, player) {
    if (this.kind === "drone") {
      this.angle += this.angSpeed * dt;
      this.position.set(
        this.center.x + Math.cos(this.angle) * this.r,
        this.center.y + Math.sin(this.angle * 2) * this.bob,
        this.center.z + Math.sin(this.angle) * this.r
      );
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y += dt * 0.8;
      return;
    }

    // Fighter AI: turn toward the player, hold altitude, fire when aligned.
    _to.copy(player.position).sub(this.position);
    const dist = _to.length();
    _desired.copy(_to).normalize();
    if (this.position.y < 500) _desired.y += 0.6;      // don't fly into the dirt
    if (dist < 350) _desired.multiplyScalar(-1);        // overshoot: extend for another pass
    const aim = steer(this.dir, _desired, 1.3 * dt);

    this.speed += (215 - this.speed) * Math.min(1, dt * 0.5);
    this.position.addScaledVector(this.dir, this.speed * dt);

    this.mesh.position.copy(this.position);
    this.mesh.lookAt(_look.copy(this.position).add(this.dir));

    // Fire only when nose is on the player and in range (and not extending) —
    // and in bursts: ~6-9 rounds, then a ~1s pause before the next volley.
    this.fireCd -= dt;
    if (dist > 200 && dist < 1700 && aim > 0.985 && this.fireCd <= 0) {
      if (this.burstLeft <= 0) this.burstLeft = FIGHTER_BURST + (Math.random() * FIGHTER_BURST_VAR | 0);
      _desired.copy(player.position).sub(this.position).normalize();
      this.manager.spawnBullet(this.position, _desired);
      this.burstLeft--;
      this.fireCd = this.burstLeft > 0 ? FIGHTER_SHOT : FIGHTER_GAP * (0.7 + Math.random() * 0.6);
    }
  }
}

export class Enemies {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.entities = [];
    this.bullets = [];
    this.kills = 0;
    this.mode = "free";
    this.onFire = null; // optional callback(position) for sound
    this.bulletGeo = new THREE.BoxGeometry(0.8, 0.8, 14);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  }

  get targets() { return this.entities; }

  alive() {
    let n = 0;
    for (const e of this.entities) if (e.alive) n++;
    return n;
  }

  clear() {
    for (const e of this.entities) this.scene.remove(e.mesh);
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.entities.length = 0;
    this.bullets.length = 0;
  }

  setMode(mode) {
    this.clear();
    this.mode = mode;
    this.kills = 0;
    if (mode === "practice") {
      for (let i = 0; i < 8; i++) this.entities.push(new Entity(this, "drone"));
    } else if (mode === "dogfight") {
      for (let i = 0; i < 5; i++) this.entities.push(new Entity(this, "fighter"));
    }
  }

  spawnBullet(pos, dir) {
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(pos);
    m.lookAt(_look.copy(pos).add(dir));
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(EB_SPEED), life: EB_LIFE });
    if (this.onFire) this.onFire(pos);
  }

  update(dt, player) {
    for (const e of this.entities) {
      if (!e.alive) {
        e.respawn -= dt;
        if (e.respawn <= 0) e.place();
        continue;
      }
      e.update(dt, player);
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (player.alive && b.mesh.position.distanceTo(player.position) < player.radius + 6) {
        player.applyDamage(EB_DAMAGE);
        hit = true;
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }
}
