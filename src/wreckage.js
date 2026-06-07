import * as THREE from "three";

// Persistent crash wreckage: a scorch mark, a little scattered debris that
// stays at the site, a crackling fire, and a smoke column (registered with the
// Smokestacks system so it rises and drifts like the chimney plumes). Wrecks
// are left in the world until a full restart, so you can fly back and find them.
export class Wrecks {
  constructor(scene, smoke) {
    this.scene = scene;
    this.smoke = smoke; // Smokestacks — we push a persistent source per wreck
    this.wrecks = [];
    this.flameGeo = new THREE.ConeGeometry(2.4, 8, 7);
    this.scorchGeo = new THREE.CircleGeometry(10, 18);
  }

  spawn(pos, color = 0x3a3d42) {
    const g = new THREE.Group();
    g.position.copy(pos);

    const scorch = new THREE.Mesh(this.scorchGeo, new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 1, metalness: 0 }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.3; g.add(scorch);

    // A handful of charred chunks that stay close to the crater.
    const debMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
    const charMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, flatShading: true, roughness: 1 });
    for (let i = 0; i < 10; i++) {
      const d = new THREE.Mesh(
        new THREE.BoxGeometry(0.7 + Math.random() * 2.4, 0.4 + Math.random() * 1.1, 0.7 + Math.random() * 2.4),
        Math.random() < 0.5 ? debMat : charMat
      );
      const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
      d.position.set(Math.cos(a) * r, 0.4 + Math.random() * 0.5, Math.sin(a) * r);
      d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      d.castShadow = true;
      g.add(d);
    }

    // Crackling fire — a few flickering additive flames.
    const fires = [];
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xff7a1e : 0xffb13a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * 5.5;
      f.position.set(Math.cos(a) * r, 2.6, Math.sin(a) * r);
      f.userData.base = 0.7 + Math.random() * 0.7;
      f.userData.ph = Math.random() * 12;
      g.add(f); fires.push(f);
    }
    this.scene.add(g);

    // Smoke column from the wreck (persistent source).
    const src = { x: pos.x, y: pos.y + 5, z: pos.z, size: 6, rate: 8, color: 0x232323, rise: 24, drift: 6, life: 5.5, grow: 4.2, wind: 5 };
    if (this.smoke) this.smoke.sources.push(src);

    this.wrecks.push({ group: g, fires, src, age: 0 });
  }

  update(dt, t) {
    for (const w of this.wrecks) {
      w.age += dt;
      for (const f of w.fires) {
        const fl = f.userData.base * (0.7 + 0.45 * Math.abs(Math.sin(t * 9 + f.userData.ph)) + Math.random() * 0.2);
        f.scale.set(fl, 0.8 + 0.5 * Math.random(), fl);
        f.material.opacity = 0.55 + Math.random() * 0.35;
      }
    }
  }

  reset() {
    for (const w of this.wrecks) {
      this.scene.remove(w.group);
      if (this.smoke) { const i = this.smoke.sources.indexOf(w.src); if (i >= 0) this.smoke.sources.splice(i, 1); }
    }
    this.wrecks.length = 0;
  }
}
