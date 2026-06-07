import * as THREE from "three";

// Time-of-day / weather presets and the dynamic bits (stars, rain, lightning).
// Mutates scene.background / fog and the world's hemi + sun lights so it can
// switch live without rebuilding the world. Pairs beautifully with the bloom
// post-FX at night (city lights, beacons and afterburners glow).
const PRESETS = {
  day:   { sky: 0x8fc4e8, fog: 0x9fcbe6, near: 6000, far: 20000, hemi: 0.9,  hSky: 0xcfeaff, hGnd: 0x4a5a3a, sun: 1.4,  sunCol: 0xfff4e0, stars: 0,   rain: 0 },
  sunset:{ sky: 0xf3a45b, fog: 0xe08a55, near: 5000, far: 18000, hemi: 0.7,  hSky: 0xffd0a0, hGnd: 0x4a3a2e, sun: 1.2,  sunCol: 0xffb066, stars: 0,   rain: 0 },
  night: { sky: 0x05080f, fog: 0x070b16, near: 4000, far: 17000, hemi: 0.22, hSky: 0x223049, hGnd: 0x0a1018, sun: 0.4,  sunCol: 0x9fb4e0, stars: 1,   rain: 0 },
  rain:  { sky: 0x6a727c, fog: 0x79818b, near: 2500, far: 11000, hemi: 0.6,  hSky: 0x9aa7b3, hGnd: 0x44504a, sun: 0.5,  sunCol: 0xb9c2cc, stars: 0,   rain: 1 },
  storm: { sky: 0x0c1018, fog: 0x10151f, near: 2000, far: 9000,  hemi: 0.3,  hSky: 0x2a3344, hGnd: 0x0c1218, sun: 0.35, sunCol: 0x8a9bc0, stars: 0.3, rain: 1.3 },
};

export class Weather {
  constructor(scene, world) {
    this.scene = scene;
    this.sun = world.sun;
    this.hemi = world.hemi;
    this.mode = "day";
    this._rainScale = 0;
    this._flash = 0; this._lt = 4;
    this._buildStars();
    this._buildRain();
  }

  _buildStars() {
    const N = 1400, R = 14000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(0.12 + 0.88 * Math.random()); // bias into the upper sky
      pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = R * Math.cos(phi);
      pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false, fog: false });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.scene.add(this.stars);
  }

  _buildRain() {
    const N = 2600;
    this._rainN = N; this._rainH = 380;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 760, y = (Math.random() - 0.5) * 760, z = (Math.random() - 0.5) * 760;
      const len = 10 + Math.random() * 9, k = i * 6;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      pos[k + 3] = x + 2.5; pos[k + 4] = y - len; pos[k + 5] = z; // slight wind slant
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaebac8, transparent: true, opacity: 0.32 });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  setMode(mode) {
    const p = PRESETS[mode] || PRESETS.day;
    this.mode = PRESETS[mode] ? mode : "day";
    this.scene.background = new THREE.Color(p.sky);
    if (this.scene.fog) { this.scene.fog.color.setHex(p.fog); this.scene.fog.near = p.near; this.scene.fog.far = p.far; }
    this.hemi.intensity = p.hemi; this.hemi.color.setHex(p.hSky); this.hemi.groundColor.setHex(p.hGnd);
    this.sun.intensity = p.sun; this.sun.color.setHex(p.sunCol);
    this.stars.visible = p.stars > 0;
    this.stars.material.opacity = Math.min(1, p.stars);
    this.rain.visible = p.rain > 0;
    this._rainScale = p.rain;
  }

  update(dt, camPos) {
    this.stars.position.copy(camPos);
    if (this.rain.visible) {
      this.rain.position.copy(camPos);
      const a = this.rain.geometry.attributes.position.array;
      const fall = 520 * dt * this._rainScale, H = this._rainH;
      for (let i = 0; i < this._rainN; i++) {
        const k = i * 6;
        a[k + 1] -= fall; a[k + 4] -= fall;
        if (a[k + 1] < -H) { a[k + 1] += 2 * H; a[k + 4] += 2 * H; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this._rainScale > 1) { // storm: occasional lightning flash on the hemi light
      this._lt -= dt;
      if (this._lt <= 0) { this._lt = 4 + Math.random() * 9; this._flash = 0.18; }
      this._flash = Math.max(0, this._flash - dt);
      const f = this._flash / 0.18;
      this.hemi.intensity = PRESETS[this.mode].hemi + f * f * 1.9;
    }
  }
}
