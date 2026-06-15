import * as THREE from "three";

// Crash wreckage & ground fires. Each patch is scorch/debris (permanent) + smoke
// (Smokestacks) + a live flame driven by the shared FireField engine (fire.js).
// Two flavours, same machinery:
//   spawn()     — a full persistent crash wreck (scorch, debris, big tall fire,
//                 thick smoke) that burns hard then slowly dies out (~70s).
//   spawnFire() — a small, short-lived fire+smoke patch (missile ground hits,
//                 burning trees) that flares up then fades.
// Each patch burns at full intensity for `burn`s, ramps down to `life`s, then
// fades out over `fade`s. The flame's heat/size follow that same curve.
export class Wrecks {
  constructor(scene, smoke, fire) {
    this.scene = scene;
    this.smoke = smoke; // Smokestacks — we push a (mutated) source per patch
    this.fire = fire;   // FireField — we acquire one emitter per patch
    this.wrecks = [];
    this.permanent = []; // scorch marks + debris that stay until a full restart
  }

  _make(pos, o) {
    // ---- Permanent bits: scorch mark + strewn debris (never auto-removed) ----
    if (o.scorchSize || o.debris) {
      const pg = new THREE.Group();
      pg.position.copy(pos);
      if (o.scorchSize) {
        const sc = new THREE.Mesh(new THREE.CircleGeometry(o.scorchSize, 16),
          new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
        sc.rotation.x = -Math.PI / 2; sc.position.y = 0.25; sc.receiveShadow = true; pg.add(sc);
      }
      if (o.debris) {
        const debMat = new THREE.MeshStandardMaterial({ color: o.color, flatShading: true, roughness: 0.95 });
        const charMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, flatShading: true, roughness: 1 });
        for (let i = 0; i < o.debris; i++) {
          const d = new THREE.Mesh(
            new THREE.BoxGeometry(0.8 + Math.random() * 3.4, 0.5 + Math.random() * 1.5, 0.8 + Math.random() * 3.4),
            Math.random() < 0.5 ? debMat : charMat
          );
          const a = Math.random() * Math.PI * 2, r = Math.random() * (o.scorchSize ? o.scorchSize * 1.2 : 16);
          d.position.set(Math.cos(a) * r, 0.4 + Math.random() * 0.6, Math.sin(a) * r);
          d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
          d.castShadow = true;
          pg.add(d);
        }
      }
      this.scene.add(pg);
      this.permanent.push(pg);
      if (this.permanent.length > 220) this.scene.remove(this.permanent.shift()); // bound it
    }

    // ---- The live flame: one FireField emitter (no per-patch meshes). ----
    const fireId = this.fire ? this.fire.acquire() : -1;

    const src = { x: pos.x, y: pos.y + o.smokeY, z: pos.z, size: o.smokeSize, rate: o.smokeRate, color: o.smokeColor, rise: o.smokeRise, drift: o.drift, life: o.smokeLife, grow: o.smokeGrow, wind: o.wind };
    if (this.smoke) this.smoke.sources.push(src);

    this.wrecks.push({ pos: pos.clone(), fireId, fireRadius: o.fireRadius, fireHeight: o.fireHeight, fireSize: o.fireSize, src, baseRate: o.smokeRate, baseSize: o.smokeSize, burn: o.burn, life: o.life, fade: o.fade, age: 0 });
  }

  // Full crash wreck — permanent scorch + strewn debris, fading fire + smoke.
  spawn(pos, color = 0x3a3d42) {
    this._make(pos, {
      color, scorchSize: 15, debris: 16, fireRadius: 9, fireHeight: 26, fireSize: 11,
      smokeY: 6, smokeSize: 11, smokeRate: 12, smokeColor: 0x202020, smokeRise: 30, drift: 7, smokeLife: 6.5, smokeGrow: 4.6, wind: 6,
      burn: 26, life: 70, fade: 6,
    });
  }

  // Small temporary fire. Missile hits leave a permanent scorch; tree fires don't.
  spawnFire(pos, { scale = 1, life = 6, color = 0x232323, scorch = true } = {}) {
    this._make(pos, {
      color, scorchSize: scorch ? 4 * scale : 0, debris: 0, fireRadius: 3 * scale, fireHeight: 11 * scale, fireSize: 4.2 * scale,
      smokeY: 4, smokeSize: 4 * scale, smokeRate: 7, smokeColor: color, smokeRise: 22, drift: 5, smokeLife: 4, smokeGrow: 4, wind: 4,
      burn: life * 0.5, life, fade: Math.min(2.5, life * 0.4),
    });
  }

  update(dt, t) {
    for (let wi = this.wrecks.length - 1; wi >= 0; wi--) {
      const w = this.wrecks[wi];
      w.age += dt;
      const i = w.age < w.burn ? 1 : Math.max(0, 1 - (w.age - w.burn) / (w.life - w.burn)); // burn curve 1→0
      const fade = w.age > w.life - w.fade ? Math.max(0, (w.life - w.age) / w.fade) : 1;     // final shrink-out
      if (this.fire && w.fireId >= 0) {
        const k = i * fade; // combined intensity
        this.fire.set(w.fireId, w.pos.x, w.pos.y, w.pos.z, {
          intensity: k, radius: w.fireRadius, height: w.fireHeight * (0.45 + 0.55 * i), size: w.fireSize,
        });
      }
      const si = Math.max(0, i * 1.15 - 0.1);
      w.src.rate = w.baseRate * si;
      w.src.size = w.baseSize * (0.55 + 0.45 * si);
      if (w.age >= w.life) {
        if (this.fire) this.fire.release(w.fireId);
        if (this.smoke) { const k = this.smoke.sources.indexOf(w.src); if (k >= 0) this.smoke.sources.splice(k, 1); }
        this.wrecks.splice(wi, 1);
      }
    }
  }

  // Active small-fire count (so callers can throttle tree ignition).
  get fireCount() { return this.wrecks.length; }

  reset() {
    for (const w of this.wrecks) {
      if (this.fire) this.fire.release(w.fireId);
      if (this.smoke) { const i = this.smoke.sources.indexOf(w.src); if (i >= 0) this.smoke.sources.splice(i, 1); }
    }
    for (const pg of this.permanent) this.scene.remove(pg);
    this.wrecks.length = 0;
    this.permanent.length = 0;
  }
}
