import * as THREE from "three";

// Shared pool of expanding/fading explosion puffs, used by player + enemy fire.
export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.debris = [];
    this.flares = [];
    this.geo = new THREE.SphereGeometry(6, 8, 8);
    this.debrisGeo = new THREE.BoxGeometry(1, 0.4, 1);
    this.flareGeo = new THREE.SphereGeometry(1, 6, 6);
    this.onAdd = null; // optional callback(size) — used to trigger sound
  }

  // Scatter plane bits when something blows up.
  burst(pos, color = 0xb8c4cf, count = 14) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.debrisGeo, new THREE.MeshStandardMaterial({ color, flatShading: true }));
      m.position.copy(pos);
      m.scale.setScalar(1.5 + Math.random() * 3);
      this.scene.add(m);
      this.debris.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 0.9 + 0.2, (Math.random() - 0.5) * 2).multiplyScalar(40 + Math.random() * 70),
        spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
        life: 2.4 + Math.random(),
      });
    }
  }

  // Eject a countermeasure flare.
  flare(pos, away) {
    const m = new THREE.Mesh(this.flareGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    m.position.copy(pos);
    m.scale.setScalar(2.4);
    this.scene.add(m);
    this.flares.push({
      mesh: m,
      vel: away.clone().multiplyScalar(0.25).add(new THREE.Vector3((Math.random() - 0.5) * 36, -12 - Math.random() * 22, (Math.random() - 0.5) * 36)),
      life: 1.7,
    });
  }

  add(pos, size = 1, color = 0xffa233, silent = false) {
    if (this.onAdd && !silent) this.onAdd(size, pos);
    const mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.list.push({ mesh, life: 0.5, max: 0.5, size });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.life -= dt;
      const k = 1 - e.life / e.max;
      e.mesh.scale.setScalar(e.size * (1 + k * 7));
      e.mesh.material.opacity = Math.max(0, 1 - k);
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.list.splice(i, 1);
      }
    }

    // Debris: gravity + tumble.
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.vel.y -= 32 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }

    // Flares: fall, slow, shrink/fade.
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.vel.y -= 16 * dt;
      f.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      f.mesh.position.addScaledVector(f.vel, dt);
      f.life -= dt;
      f.mesh.scale.setScalar(2.4 * Math.max(0.1, f.life / 1.7));
      if (f.life <= 0) { this.scene.remove(f.mesh); this.flares.splice(i, 1); }
    }
  }

  reset() {
    for (const e of this.list) this.scene.remove(e.mesh);
    for (const d of this.debris) this.scene.remove(d.mesh);
    for (const f of this.flares) this.scene.remove(f.mesh);
    this.list.length = 0;
    this.debris.length = 0;
    this.flares.length = 0;
  }
}
