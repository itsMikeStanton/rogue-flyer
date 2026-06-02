import * as THREE from "three";

// Shared pool of expanding/fading explosion puffs, used by player + enemy fire.
export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.SphereGeometry(6, 8, 8);
    this.onAdd = null; // optional callback(size) — used to trigger sound
  }

  add(pos, size = 1, color = 0xffa233) {
    if (this.onAdd) this.onAdd(size);
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
  }

  reset() {
    for (const e of this.list) this.scene.remove(e.mesh);
    this.list.length = 0;
  }
}
