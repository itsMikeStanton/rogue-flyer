import * as THREE from "three";

// Rising smoke / vapour plumes for chimneys, power-plant stacks and cooling
// towers. Static `sources` are added once (world scenery); `dynamic` sources are
// replaced each frame (e.g. a live strike target — they stop smoking when it's
// destroyed). Each source is { x, y, z, size, rate, color, rise, drift, life,
// grow, wind }. Puffs rise, drift downwind, billow outward and fade.
export class Smokestacks {
  constructor(scene, { max = 820 } = {}) {
    this.scene = scene;
    this.sources = [];   // persistent
    this.dynamic = [];   // replaced each frame
    this.puffs = [];
    this.max = max;
    this.geo = new THREE.SphereGeometry(1, 6, 6);
  }
  addSources(list) { if (list) for (const s of list) this.sources.push(s); }

  _emit(s) {
    if (this.puffs.length >= this.max) return;
    const size = (s.size || 5) * (0.65 + Math.random() * 0.7);
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      color: s.color != null ? s.color : 0x46464a, transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.position.set(s.x + (Math.random() - 0.5) * size, s.y, s.z + (Math.random() - 0.5) * size);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    const rise = s.rise || 18, drift = s.drift || 4, wind = s.wind != null ? s.wind : 3;
    this.puffs.push({
      mesh, size, life: s.life || 4.0, max: s.life || 4.0, grow: s.grow || 4,
      vel: new THREE.Vector3((Math.random() - 0.5) * drift + wind, rise * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * drift),
      peak: 0.45 + Math.random() * 0.22,
    });
  }

  update(dt, camPos) {
    const emitFrom = (s) => {
      if (camPos) { const dx = s.x - camPos.x, dz = s.z - camPos.z; if (dx * dx + dz * dz > 9000 * 9000) return; }
      if (Math.random() < (s.rate || 5) * dt) this._emit(s);
    };
    for (const s of this.sources) emitFrom(s);
    for (const s of this.dynamic) emitFrom(s);

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.vel.y *= (1 - 0.15 * dt); // buoyancy eases as it cools
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.max; // 0..1
      p.mesh.scale.setScalar(p.size * (1 + k * p.grow));
      // quick fade-in, slow fade-out
      const op = k < 0.12 ? (k / 0.12) * p.peak : p.peak * (1 - (k - 0.12) / 0.88);
      p.mesh.material.opacity = Math.max(0, op);
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.puffs.splice(i, 1); }
    }
  }
  reset() { for (const p of this.puffs) this.scene.remove(p.mesh); this.puffs.length = 0; }
}
