import * as THREE from "three";

// Shared pool of expanding/fading explosion puffs, used by player + enemy fire.
export class Explosions {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.debris = [];
    this.flares = [];
    this.sparks = [];
    this.rings = [];
    this.geo = new THREE.SphereGeometry(6, 8, 8);
    this.debrisGeo = new THREE.BoxGeometry(1, 0.4, 1);
    this.flareGeo = new THREE.SphereGeometry(1, 6, 6);
    this.sparkGeo = new THREE.SphereGeometry(0.6, 5, 4);
    this.ringGeo = new THREE.TorusGeometry(6, 0.5, 6, 28);
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

  // One expanding/fading billboard puff. opt: { life, grow, rise, additive, op }.
  _puff(pos, size, color, opt) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opt.op,
      depthWrite: false, blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.list.push({ mesh, life: opt.life, max: opt.life, size, grow: opt.grow, rise: opt.rise || 0, op: opt.op });
  }

  add(pos, size = 1, color = 0xffa233, silent = false) {
    if (this.onAdd && !silent) this.onAdd(size, pos);

    // Core fireball: orange, expands and fades fast.
    this._puff(pos, size, color, { life: 0.5, grow: 7, rise: 0, additive: false, op: 1 });

    // The bigger blasts get the full treatment; tiny ground/gun puffs stay cheap.
    if (size >= 0.8) {
      // Brilliant flash core — additive, very fast.
      this._puff(pos, size * 0.7, 0xfff4d2, { life: 0.16, grow: 10, rise: 0, additive: true, op: 1 });
      // Inner white-hot ball.
      this._puff(pos, size * 0.55, 0xffe08a, { life: 0.34, grow: 6, rise: 0, additive: true, op: 0.9 });
      // Lingering smoke that rises and darkens.
      this._puff(pos, size * 1.1, 0x2c2c2c, { life: 1.3 + size * 0.2, grow: 4.5, rise: 16, additive: false, op: 0.7 });

      // Shockwave ring (flat, expands out then fades).
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        color: 0xfff0c0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      ring.position.copy(pos);
      ring.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      ring.rotation.z = Math.random() * Math.PI;
      ring.scale.setScalar(size * 0.4);
      this.scene.add(ring);
      this.rings.push({ mesh: ring, life: 0.34, max: 0.34, size });

      // Sparks/embers flung outward.
      const n = Math.min(22, 7 + Math.round(size * 4));
      for (let i = 0; i < n; i++) {
        const s = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xfff2b0 : 0xff9c3c, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        s.position.copy(pos);
        s.scale.setScalar(size * (0.5 + Math.random() * 0.7));
        this.scene.add(s);
        this.sparks.push({
          mesh: s,
          vel: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.2) * 1.6, (Math.random() - 0.5) * 2)
            .normalize().multiplyScalar((26 + Math.random() * 60) * Math.max(1, size * 0.7)),
          life: 0.45 + Math.random() * 0.5,
          max: 0.95,
        });
      }
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.life -= dt;
      const k = 1 - e.life / e.max;
      e.mesh.scale.setScalar(e.size * (1 + k * e.grow));
      if (e.rise) e.mesh.position.y += e.rise * dt;
      e.mesh.material.opacity = Math.max(0, e.op * (1 - k));
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.material.dispose();
        this.list.splice(i, 1);
      }
    }

    // Shockwave rings: expand fast, thin out, fade.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.size * (0.4 + k * 4.5));
      r.mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
      if (r.life <= 0) { this.scene.remove(r.mesh); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }

    // Sparks: fly out, gravity, fade.
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vel.y -= 70 * dt;
      s.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, s.life / s.max);
      if (s.life <= 0) { this.scene.remove(s.mesh); s.mesh.material.dispose(); this.sparks.splice(i, 1); }
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
    for (const s of this.sparks) this.scene.remove(s.mesh);
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.list.length = 0;
    this.debris.length = 0;
    this.flares.length = 0;
    this.sparks.length = 0;
    this.rings.length = 0;
  }
}
