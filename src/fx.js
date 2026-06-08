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
    this.pending = []; // scheduled secondary blasts: { t, pos, size, color }
    this.geo = new THREE.SphereGeometry(6, 8, 8);
    this.debrisGeo = new THREE.BoxGeometry(1, 0.4, 1);
    this.flareGeo = new THREE.SphereGeometry(1, 6, 6);
    this.sparkGeo = new THREE.SphereGeometry(0.6, 5, 4);
    this.ringGeo = new THREE.TorusGeometry(6, 0.5, 6, 28);
    this.onAdd = null; // optional callback(size, pos) — used to trigger sound
    this.onScorch = null; // optional callback(pos, size) — set nearby trees alight
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

  // Scatter actual pieces of a model (clones of its mesh parts) — used so a
  // crashing jet throws recognisable bits of itself, not just generic cubes.
  shards(pos, sourceMesh, quaternion, count = 12) {
    const parts = [];
    sourceMesh.traverse((o) => { if (o.isMesh && o.geometry) parts.push(o); });
    if (!parts.length) { this.burst(pos, 0xb8c4cf, count); return; }
    for (let i = 0; i < count; i++) {
      const src = parts[(Math.random() * parts.length) | 0];
      const m = new THREE.Mesh(src.geometry, src.material); // share geo/mat (read-only)
      m.position.copy(pos);
      if (quaternion) m.quaternion.copy(quaternion);
      m.scale.copy(src.scale).multiplyScalar(0.8 + Math.random() * 0.6);
      m.castShadow = true;
      this.scene.add(m);
      this.debris.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.0 + 0.35, (Math.random() - 0.5) * 2).multiplyScalar(55 + Math.random() * 85),
        spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        life: 2.4 + Math.random() * 1.4,
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

  // A single small flame lick (additive, glows) for a burning/damaged thing.
  ember(pos, scale = 1) {
    this._puff(pos, (1.0 + Math.random() * 0.7) * scale, Math.random() < 0.5 ? 0xff8a2a : 0xffb347,
      { life: 0.3 + Math.random() * 0.22, grow: 3.0, rise: 11, additive: true, op: 0.8 });
  }

  // One expanding/fading billboard puff. opt: { life, grow, rise, additive, op, delay }.
  _puff(pos, size, color, opt) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opt.op,
      depthWrite: false, blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    if (opt.delay) mesh.visible = false; // off-time pop: hold until its delay elapses
    this.scene.add(mesh);
    this.list.push({ mesh, life: opt.life, max: opt.life, size, grow: opt.grow, rise: opt.rise || 0, op: opt.op, delay: opt.delay || 0 });
  }

  add(pos, size = 1, color = 0xffa233, silent = false) {
    if (this.onAdd && !silent) this.onAdd(size, pos);
    this._blast(pos, size, color);
    // Sometimes one or two more equal-size balls go off right afterward.
    if (size >= 0.8 && Math.random() < 0.5) {
      const n = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * size * 9, (Math.random() - 0.2) * size * 7, (Math.random() - 0.5) * size * 9));
        this.pending.push({ t: 0.10 + i * 0.14 + Math.random() * 0.10, pos: p, size, color });
      }
    }
  }

  _blast(pos, size, color) {
    // Core fireball: orange, expands and fades fast.
    this._puff(pos, size, color, { life: 0.5, grow: 7, rise: 0, additive: false, op: 1 });

    // The bigger blasts get the full treatment; tiny ground/gun puffs stay cheap.
    if (size >= 0.8) {
      if (this.onScorch) this.onScorch(pos, size); // ignite trees in the vicinity
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

      // Sparks/embers flung outward — wide, fast, mostly lateral so they really
      // spray off the ground / a ship deck.
      const n = Math.min(34, 10 + Math.round(size * 6));
      for (let i = 0; i < n; i++) {
        const s = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xfff2b0 : 0xff9c3c, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        s.position.copy(pos);
        s.scale.setScalar(size * (0.5 + Math.random() * 0.7));
        this.scene.add(s);
        this.sparks.push({
          mesh: s,
          vel: new THREE.Vector3((Math.random() - 0.5) * 3.0, (Math.random() - 0.05) * 1.2, (Math.random() - 0.5) * 3.0)
            .normalize().multiplyScalar((50 + Math.random() * 110) * Math.max(1, size * 0.8)),
          life: 0.5 + Math.random() * 0.7,
          max: 1.2,
        });
      }

      // 10-15 small fast pops scattered through the ball, slightly off-time —
      // a central blast riddled with secondary combustion popping off.
      const pops = 10 + (Math.random() * 6 | 0);
      for (let i = 0; i < pops; i++) {
        const off = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.8, Math.random() - 0.5).multiplyScalar(size * 7);
        this._puff(pos.clone().add(off), size * (0.22 + Math.random() * 0.32), Math.random() < 0.5 ? 0xffd27a : 0xff8a2c,
          { life: 0.12 + Math.random() * 0.13, grow: 5.5, additive: true, op: 1, delay: Math.random() * 0.3 });
      }
    }
  }

  update(dt) {
    // Fire any scheduled secondary blasts whose delay has elapsed.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this._blast(p.pos, p.size, p.color); this.pending.splice(i, 1); }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.delay > 0) { e.delay -= dt; continue; } // off-time pop still waiting
      if (!e.mesh.visible) e.mesh.visible = true;
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
    this.pending.length = 0;
  }
}
