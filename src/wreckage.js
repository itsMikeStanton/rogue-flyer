import * as THREE from "three";

// Persistent crash wreckage: a scorch mark, charred debris that stays, a big
// crackling fire and a thick smoke column. It burns hard for a while, then
// slowly dies down — fire goes out, smoke thins, and finally the whole wreck
// fades away. (Spawned only on land; water crashes leave nothing.)
const BURN = 26;   // seconds at full intensity before it starts dying down
const LIFE = 70;   // total lifetime; fully gone after this
const FADE = 6;    // final shrink-out window

export class Wrecks {
  constructor(scene, smoke) {
    this.scene = scene;
    this.smoke = smoke; // Smokestacks — we push a (mutated) source per wreck
    this.wrecks = [];
    this.flameGeo = new THREE.ConeGeometry(3.6, 13, 8);
    this.scorchGeo = new THREE.CircleGeometry(15, 20);
  }

  spawn(pos, color = 0x3a3d42) {
    const g = new THREE.Group();
    g.position.copy(pos);

    const scorch = new THREE.Mesh(this.scorchGeo, new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 1, metalness: 0 }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.3; g.add(scorch);

    // Charred chunks that stay close to the crater.
    const debMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
    const charMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, flatShading: true, roughness: 1 });
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Mesh(
        new THREE.BoxGeometry(0.8 + Math.random() * 3.0, 0.5 + Math.random() * 1.4, 0.8 + Math.random() * 3.0),
        Math.random() < 0.5 ? debMat : charMat
      );
      const a = Math.random() * Math.PI * 2, r = Math.random() * 12;
      d.position.set(Math.cos(a) * r, 0.5 + Math.random() * 0.6, Math.sin(a) * r);
      d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      d.castShadow = true;
      g.add(d);
    }

    // Big crackling fire — a cluster of flickering additive flames.
    const fires = [];
    for (let i = 0; i < 11; i++) {
      const f = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xff7a1e : 0xffb13a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * 8;
      f.position.set(Math.cos(a) * r, 4.5, Math.sin(a) * r);
      f.userData.base = 0.9 + Math.random() * 0.9;
      f.userData.ph = Math.random() * 12;
      g.add(f); fires.push(f);
    }
    this.scene.add(g);

    // Thick smoke column (a source we throttle down as the fire dies).
    const baseRate = 12, baseSize = 11;
    const src = { x: pos.x, y: pos.y + 6, z: pos.z, size: baseSize, rate: baseRate, color: 0x202020, rise: 30, drift: 7, life: 6.5, grow: 4.6, wind: 6 };
    if (this.smoke) this.smoke.sources.push(src);

    this.wrecks.push({ group: g, fires, src, baseRate, baseSize, age: 0 });
  }

  update(dt, t) {
    for (let wi = this.wrecks.length - 1; wi >= 0; wi--) {
      const w = this.wrecks[wi];
      w.age += dt;
      // Intensity: full until BURN, then ramps to 0 by LIFE.
      const i = w.age < BURN ? 1 : Math.max(0, 1 - (w.age - BURN) / (LIFE - BURN));
      // Fire flicker, scaled by intensity (goes out as it dies).
      for (const f of w.fires) {
        if (i <= 0.02) { f.visible = false; continue; }
        f.visible = true;
        const fl = f.userData.base * i * (0.7 + 0.45 * Math.abs(Math.sin(t * 9 + f.userData.ph)) + Math.random() * 0.2);
        f.scale.set(fl, (0.8 + 0.5 * Math.random()) * (0.5 + 0.5 * i), fl);
        f.material.opacity = (0.5 + Math.random() * 0.35) * i;
      }
      // Smoke thins out with the fire (and smoulders a touch longer than flame).
      const si = Math.max(0, i * 1.15 - 0.1);
      w.src.rate = w.baseRate * si;
      w.src.size = w.baseSize * (0.55 + 0.45 * si);
      // Final shrink-out, then remove the whole wreck.
      if (w.age > LIFE - FADE) w.group.scale.setScalar(Math.max(0.001, (LIFE - w.age) / FADE));
      if (w.age >= LIFE) {
        this.scene.remove(w.group);
        if (this.smoke) { const k = this.smoke.sources.indexOf(w.src); if (k >= 0) this.smoke.sources.splice(k, 1); }
        this.wrecks.splice(wi, 1);
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
