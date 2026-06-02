import * as THREE from "three";

// Arcade weapons: a forward-firing cannon with tracer rounds, drifting enemy
// drone targets, hit detection, particle explosions, and a kill score.
// Targets respawn so there's always something to chase.

const BULLET_SPEED = 1400;   // m/s tracer
const BULLET_LIFE = 2.2;     // seconds
const FIRE_INTERVAL = 0.08;  // seconds between rounds (full-auto cannon)
const TARGET_HIT_RADIUS = 55; // generous arcade hitbox
const RESPAWN_DELAY = 4;      // seconds before a downed target returns

const _fwd = new THREE.Vector3();
const _nose = new THREE.Vector3();

export class Weapons {
  constructor(scene) {
    this.scene = scene;
    this.bullets = [];
    this.targets = [];
    this.explosions = [];
    this.score = 0;
    this.cooldown = 0;

    this.bulletGeo = new THREE.BoxGeometry(0.7, 0.7, 16);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff066 });
    this.expGeo = new THREE.SphereGeometry(6, 8, 8);

    this._buildTargets(8);
  }

  _buildTargets(n) {
    for (let i = 0; i < n; i++) {
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
      this.scene.add(group);

      const t = { group, alive: true, radius: TARGET_HIT_RADIUS, respawn: 0 };
      this._placeTarget(t);
      this.targets.push(t);
    }
  }

  _placeTarget(t) {
    // Patrol a circle at altitude somewhere out in front of the spawn area.
    const cx = (Math.random() - 0.5) * 9000;
    const cz = -2000 - Math.random() * 7000;
    t.center = new THREE.Vector3(cx, 900 + Math.random() * 1800, cz);
    t.r = 300 + Math.random() * 700;
    t.speed = (0.15 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1);
    t.angle = Math.random() * Math.PI * 2;
    t.bob = 30 + Math.random() * 50;
    t.alive = true;
    t.group.visible = true;
  }

  reset() {
    for (const b of this.bullets) this.scene.remove(b.mesh);
    for (const e of this.explosions) this.scene.remove(e.mesh);
    this.bullets.length = 0;
    this.explosions.length = 0;
    this.score = 0;
    this.cooldown = 0;
    for (const t of this.targets) this._placeTarget(t);
  }

  // Fire from the aircraft nose along its forward axis.
  fire(position, quaternion) {
    if (this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;
    _fwd.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _nose.copy(position).addScaledVector(_fwd, 7);

    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(_nose);
    m.quaternion.copy(quaternion);
    this.scene.add(m);
    this.bullets.push({
      mesh: m,
      vel: _fwd.clone().multiplyScalar(BULLET_SPEED),
      life: BULLET_LIFE,
    });
  }

  _explode(pos) {
    const mesh = new THREE.Mesh(
      this.expGeo,
      new THREE.MeshBasicMaterial({ color: 0xffa233, transparent: true, opacity: 1 })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.explosions.push({ mesh, life: 0.5, max: 0.5 });
  }

  _destroy(t) {
    t.alive = false;
    t.group.visible = false;
    t.respawn = RESPAWN_DELAY;
    this.score++;
    this._explode(t.group.position);
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;

    // Advance bullets; test against live targets.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      for (const t of this.targets) {
        if (!t.alive) continue;
        if (b.mesh.position.distanceTo(t.group.position) < t.radius) {
          this._destroy(t);
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // Move / respawn targets.
    for (const t of this.targets) {
      if (!t.alive) {
        t.respawn -= dt;
        if (t.respawn <= 0) this._placeTarget(t);
        continue;
      }
      t.angle += t.speed * dt;
      t.group.position.set(
        t.center.x + Math.cos(t.angle) * t.r,
        t.center.y + Math.sin(t.angle * 2) * t.bob,
        t.center.z + Math.sin(t.angle) * t.r
      );
      t.group.rotation.y += dt * 0.8;
    }

    // Expand & fade explosions.
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= dt;
      const k = 1 - e.life / e.max;
      e.mesh.scale.setScalar(1 + k * 7);
      e.mesh.material.opacity = Math.max(0, 1 - k);
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.explosions.splice(i, 1);
      }
    }
  }

  targetsAlive() {
    let n = 0;
    for (const t of this.targets) if (t.alive) n++;
    return n;
  }
}
