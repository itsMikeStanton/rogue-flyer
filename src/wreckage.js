import * as THREE from "three";

// Fire + smoke patches. Two flavours, same machinery:
//   spawn()     — a full persistent crash wreck (scorch, debris, big tall fire,
//                 thick smoke) that burns hard then slowly dies out (~70s).
//   spawnFire() — a small, short-lived fire+smoke patch (missile ground hits,
//                 burning trees) that flares up then fades.
// Each patch burns at full intensity for `burn`s, ramps down to `life`s, then
// shrinks out over `fade`s. Smoke is registered with the Smokestacks system.
export class Wrecks {
  constructor(scene, smoke) {
    this.scene = scene;
    this.smoke = smoke; // Smokestacks — we push a (mutated) source per patch
    this.wrecks = [];
    // Flame cone anchored at its base (y=0) so scaling Y stretches it upward.
    this.flameGeo = new THREE.ConeGeometry(3.0, 16, 8);
    this.flameGeo.translate(0, 8, 0);
  }

  _make(pos, o) {
    const g = new THREE.Group();
    g.position.copy(pos);

    if (o.scorchSize) {
      const sc = new THREE.Mesh(new THREE.CircleGeometry(o.scorchSize, 16),
        new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 1, metalness: 0 }));
      sc.rotation.x = -Math.PI / 2; sc.position.y = 0.3; g.add(sc);
    }

    if (o.debris) {
      const debMat = new THREE.MeshStandardMaterial({ color: o.color, flatShading: true, roughness: 0.95 });
      const charMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, flatShading: true, roughness: 1 });
      for (let i = 0; i < o.debris; i++) {
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
    }

    // Tall, flickering, randomly-sized flames.
    const fires = [];
    for (let i = 0; i < o.fireCount; i++) {
      const f = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xff7a1e : 0xffb13a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * o.spread;
      f.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
      f.userData.base = 0.8 + Math.random() * 0.9;   // width
      f.userData.h = 0.9 + Math.random() * 1.6;       // height — taller + more varied
      f.userData.ph = Math.random() * 12;
      g.add(f); fires.push(f);
    }
    this.scene.add(g);

    const src = { x: pos.x, y: pos.y + o.smokeY, z: pos.z, size: o.smokeSize, rate: o.smokeRate, color: o.smokeColor, rise: o.smokeRise, drift: o.drift, life: o.smokeLife, grow: o.smokeGrow, wind: o.wind };
    if (this.smoke) this.smoke.sources.push(src);

    this.wrecks.push({ group: g, fires, src, baseRate: o.smokeRate, baseSize: o.smokeSize, fscale: o.fscale, burn: o.burn, life: o.life, fade: o.fade, age: 0 });
  }

  // Full crash wreck (persistent).
  spawn(pos, color = 0x3a3d42) {
    this._make(pos, {
      color, scorchSize: 15, debris: 12, fireCount: 12, spread: 8, fscale: 1,
      smokeY: 6, smokeSize: 11, smokeRate: 12, smokeColor: 0x202020, smokeRise: 30, drift: 7, smokeLife: 6.5, smokeGrow: 4.6, wind: 6,
      burn: 26, life: 70, fade: 6,
    });
  }

  // Small temporary fire (missile ground impact, burning tree, …).
  spawnFire(pos, { scale = 1, life = 6, color = 0x232323 } = {}) {
    this._make(pos, {
      color, scorchSize: 4 * scale, debris: 0, fireCount: 4, spread: 3 * scale, fscale: 0.5 * scale,
      smokeY: 4, smokeSize: 4 * scale, smokeRate: 7, smokeColor: color, smokeRise: 22, drift: 5, smokeLife: 4, smokeGrow: 4, wind: 4,
      burn: life * 0.5, life, fade: Math.min(2.5, life * 0.4),
    });
  }

  update(dt, t) {
    for (let wi = this.wrecks.length - 1; wi >= 0; wi--) {
      const w = this.wrecks[wi];
      w.age += dt;
      const i = w.age < w.burn ? 1 : Math.max(0, 1 - (w.age - w.burn) / (w.life - w.burn));
      for (const f of w.fires) {
        if (i <= 0.02) { f.visible = false; continue; }
        f.visible = true;
        const width = f.userData.base * w.fscale * i * (0.7 + 0.45 * Math.abs(Math.sin(t * 9 + f.userData.ph)) + Math.random() * 0.2);
        const height = f.userData.h * w.fscale * (0.6 + 0.7 * Math.random()) * (0.5 + 0.5 * i);
        f.scale.set(width, height, width);
        f.material.opacity = (0.5 + Math.random() * 0.35) * i;
      }
      const si = Math.max(0, i * 1.15 - 0.1);
      w.src.rate = w.baseRate * si;
      w.src.size = w.baseSize * (0.55 + 0.45 * si);
      if (w.age > w.life - w.fade) w.group.scale.setScalar(Math.max(0.001, (w.life - w.age) / w.fade));
      if (w.age >= w.life) {
        this.scene.remove(w.group);
        if (this.smoke) { const k = this.smoke.sources.indexOf(w.src); if (k >= 0) this.smoke.sources.splice(k, 1); }
        this.wrecks.splice(wi, 1);
      }
    }
  }

  // Active small-fire count (so callers can throttle tree ignition).
  get fireCount() { return this.wrecks.length; }

  reset() {
    for (const w of this.wrecks) {
      this.scene.remove(w.group);
      if (this.smoke) { const i = this.smoke.sources.indexOf(w.src); if (i >= 0) this.smoke.sources.splice(i, 1); }
    }
    this.wrecks.length = 0;
  }
}
