import * as THREE from "three";
import { terrainHeight, riverCenterX } from "./world.js";

// Strike-mission ground targets: stationary structures sitting on the terrain
// that you destroy with guns/missiles. Same { position, radius, alive, hit }
// interface the player's weapons use. They don't respawn — clear them all to
// complete the mission.

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

// Carrier flak guns
const AA_RANGE = 2600;
const AA_INTERVAL = 0.22;  // seconds per gun
const AA_BULLET_SPEED = 1000;
const AA_BULLET_LIFE = 3.0;
const AA_DAMAGE = 6;

function gmat(c) {
  return new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85 });
}

class GTarget {
  constructor(scene, fx, type, x, z) {
    this.scene = scene;
    this.fx = fx;
    this.type = type;
    this.alive = true;
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
    } else { // sam
      const b = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 16), gmat(0x4f5b3a));
      b.position.y = 2.5; g.add(b);
      for (const s of [-1, 1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 12, 6), gmat(0x33402a));
        tube.position.set(s * 3, 8, 0); tube.rotation.x = -0.5; g.add(tube);
      }
      this.maxHealth = 40; this.radius = 26;
    }

    this.health = this.maxHealth;
    g.position.set(x, terrainHeight(x, z), z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    this.group = g;
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
    this.fx.add(_v.copy(this.group.position).setY(this.group.position.y + 12), 3.4);
  }

  update(dt) {
    if (this.alive && this.spin) this.spin.rotation.z += dt * 1.2;
  }
}

// The enemy carrier as a big, high-health strike target.
class CarrierTarget {
  constructor(fx, mesh, info) {
    this.fx = fx;
    this.mesh = mesh;
    this.alive = true;
    this.radius = 140;
    this.maxHealth = 320;
    this.health = 320;
    this._pos = new THREE.Vector3(info.x, info.deckY + 8, info.z);
    this.info = info;
    // Flak guns at the bow and stern.
    this.forePos = new THREE.Vector3(info.x, info.deckY + 7, info.z - info.halfL * 0.85);
    this.aftPos = new THREE.Vector3(info.x, info.deckY + 7, info.z + info.halfL * 0.85);
    this.foreCd = Math.random() * AA_INTERVAL;
    this.aftCd = AA_INTERVAL * 0.5 + Math.random() * AA_INTERVAL;
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
    // A string of explosions the length of the deck.
    for (let i = 0; i < 7; i++) {
      const p = this._pos.clone();
      p.x += (Math.random() - 0.5) * 60;
      p.z += (Math.random() - 0.5) * this.info.halfL * 1.8;
      p.y += Math.random() * 22;
      this.fx.add(p, 3.6);
    }
    if (this.mesh) this.mesh.visible = false;
  }
  update(dt, player, mgr) {
    if (!this.alive || !player || !player.alive) return;
    if (this._pos.distanceTo(player.position) > AA_RANGE) return;
    this.foreCd -= dt;
    this.aftCd -= dt;
    if (this.foreCd <= 0) { this.foreCd = AA_INTERVAL; this._fireFrom(this.forePos, player, mgr); }
    if (this.aftCd <= 0) { this.aftCd = AA_INTERVAL; this._fireFrom(this.aftPos, player, mgr); }
  }
}

export class GroundTargets {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.list = [];
    this.total = 0;
    this.bullets = [];
    this.onFire = null; // callback(position) for sound
    this.bulletGeo = new THREE.BoxGeometry(0.9, 0.9, 16);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xff7a2c });
  }

  spawnBullet(pos, dir) {
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    m.position.copy(pos);
    m.lookAt(_v.copy(pos).add(dir));
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().multiplyScalar(AA_BULLET_SPEED), life: AA_BULLET_LIFE });
    if (this.onFire) this.onFire(pos);
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
    const bases = [[0, -3800], [2600, -6500], [-2800, -5200]];
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
      if (player && player.alive && b.mesh.position.distanceTo(player.position) < player.radius + 8) {
        player.applyDamage(AA_DAMAGE);
        hit = true;
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }
}
