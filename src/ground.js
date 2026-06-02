import * as THREE from "three";
import { terrainHeight, riverCenterX } from "./world.js";

// Strike-mission ground targets: stationary structures sitting on the terrain
// that you destroy with guns/missiles. Same { position, radius, alive, hit }
// interface the player's weapons use. They don't respawn — clear them all to
// complete the mission.

const _v = new THREE.Vector3();

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

export class GroundTargets {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.list = [];
    this.total = 0;
  }

  get targets() { return this.list; }
  get destroyed() { let n = 0; for (const t of this.list) if (!t.alive) n++; return n; }
  get remaining() { return this.total - this.destroyed; }

  clear() {
    for (const t of this.list) this.scene.remove(t.group);
    this.list = [];
    this.total = 0;
  }

  // active=true builds a mission's worth of targets; false clears them.
  setActive(active) {
    this.clear();
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
    this.total = this.list.length;
  }

  update(dt) {
    for (const t of this.list) t.update(dt);
  }
}
