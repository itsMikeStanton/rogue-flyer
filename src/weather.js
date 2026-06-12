import * as THREE from "three";

// Time-of-day / weather presets and the dynamic bits (stars, rain, lightning).
// Mutates scene.background / fog and the world's hemi + sun lights so it can
// switch live without rebuilding the world. Pairs beautifully with the bloom
// post-FX at night (city lights, beacons and afterburners glow).
// `body`: which disc is up — "sun", "moon" or null (overcast). The directional
// light is aimed along it so shadows match the sky.
const PRESETS = {
  day:   { sky: 0x8fc4e8, fog: 0x9fcbe6, near: 6000, far: 20000, hemi: 0.9,  hSky: 0xcfeaff, hGnd: 0x4a5a3a, sun: 1.4,  sunCol: 0xfff4e0, stars: 0,   rain: 0,   body: "sun" },
  sunset:{ sky: 0xf3a45b, fog: 0xe08a55, near: 5000, far: 18000, hemi: 0.7,  hSky: 0xffd0a0, hGnd: 0x4a3a2e, sun: 1.2,  sunCol: 0xffb066, stars: 0,   rain: 0,   body: "sun" },
  // Moonlit night — darker, but still readable by the moonlight (and the lights).
  night: { sky: 0x0a1322, fog: 0x0d1828, near: 6000, far: 21000, hemi: 0.46, hSky: 0x3a4f78, hGnd: 0x141c2c, sun: 0.6, sunCol: 0xb9c6e8, stars: 1,   rain: 0,   body: "moon" },
  rain:  { sky: 0x6a727c, fog: 0x79818b, near: 2500, far: 11000, hemi: 0.6,  hSky: 0x9aa7b3, hGnd: 0x44504a, sun: 0.5,  sunCol: 0xb9c2cc, stars: 0,   rain: 1,   body: null },
  storm: { sky: 0x131b2c, fog: 0x182132, near: 2400, far: 11000, hemi: 0.42, hSky: 0x35435e, hGnd: 0x141c28, sun: 0.5, sunCol: 0x9fb0d6, stars: 0.4, rain: 1.3, body: "moon" },
};

// Keyframes for the automatic day/night cycle (tod 0..1, wraps). Tuned so a full
// turn is roughly half daylight, half night with sunset/sunrise bridges.
const CYCLE = [
  { at: 0.00, m: "day" }, { at: 0.42, m: "day" }, { at: 0.50, m: "sunset" },
  { at: 0.58, m: "night" }, { at: 0.92, m: "night" }, { at: 0.97, m: "sunset" }, { at: 1.0, m: "day" },
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
const lerp = THREE.MathUtils.lerp;
function lerpHex(a, b, t) { _ca.setHex(a); _cb.setHex(b); _ca.lerp(_cb, t); return _ca.getHex(); }
function lerpPreset(a, b, t) {
  return {
    sky: lerpHex(a.sky, b.sky, t), fog: lerpHex(a.fog, b.fog, t), near: lerp(a.near, b.near, t), far: lerp(a.far, b.far, t),
    hemi: lerp(a.hemi, b.hemi, t), hSky: lerpHex(a.hSky, b.hSky, t), hGnd: lerpHex(a.hGnd, b.hGnd, t),
    sun: lerp(a.sun, b.sun, t), sunCol: lerpHex(a.sunCol, b.sunCol, t), stars: lerp(a.stars, b.stars, t), rain: lerp(a.rain, b.rain, t),
    body: t < 0.5 ? a.body : b.body,
  };
}

export class Weather {
  constructor(scene, world) {
    this.scene = scene;
    this.sun = world.sun;
    this.hemi = world.hemi;
    this.mode = "day";
    this._rainScale = 0;
    this._flash = 0; this._lt = 4;
    this._initSky();
    this._buildStars();
    this._buildRain();
  }

  // Random sun + moon directions for the session, and the glowing discs that
  // sit in those spots (camera-following, so they stay fixed against the sky).
  _initSky() {
    const az = Math.random() * Math.PI * 2;
    const el = 0.55 + Math.random() * 0.5;            // sun elevation ~31°..60°
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const maz = az + Math.PI + (Math.random() - 0.5) * 1.2; // moon roughly opposite
    const mel = 0.4 + Math.random() * 0.5;
    this.moonDir = new THREE.Vector3(Math.cos(mel) * Math.cos(maz), Math.sin(mel), Math.cos(mel) * Math.sin(maz));
    this._sunDist = this.sun.position.length() || 8000;
    this.sun.position.copy(this.sunDir).multiplyScalar(this._sunDist);

    this.sunSprite = this._disc(0xfff2c4, 1500, true);
    this.moonSprite = this._disc(0xd2dcf0, 950, false);
    this.scene.add(this.sunSprite);
    this.scene.add(this.moonSprite);
  }
  _disc(color, size, additive) {
    const mat = new THREE.SpriteMaterial({ map: Weather._discTex(), color, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    s.frustumCulled = false;
    s.visible = false;
    return s;
  }
  static _discTex() {
    if (Weather._tex) return Weather._tex;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0.0, "rgba(255,255,255,1)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.92)");
    grd.addColorStop(0.72, "rgba(255,255,255,0.30)");
    grd.addColorStop(1.0, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    Weather._tex = new THREE.CanvasTexture(c);
    return Weather._tex;
  }

  _buildStars() {
    const N = 1600, R = 14000;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(0.12 + 0.88 * Math.random()); // bias into the upper sky
      pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = R * Math.cos(phi);
      pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
      // Mostly tiny; a handful are bigger and brighter.
      const r = Math.random();
      size[i] = r < 0.72 ? 0.8 + Math.random() * 0.9 : r < 0.94 ? 1.7 + Math.random() * 0.8 : 2.6 + Math.random() * 1.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0xdfe8ff) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute float aSize; varying float vB; void main(){ vB = clamp(aSize/3.6, 0.2, 1.0); gl_PointSize = aSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform float uOpacity; uniform vec3 uColor; varying float vB; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(uColor * (0.6 + 0.4 * vB), a * uOpacity * (0.5 + 0.5 * vB)); }",
    });
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
    this.autoCycle = false;
    this.mode = PRESETS[mode] ? mode : "day";
    this._apply(PRESETS[this.mode]);
  }

  // Start/stop the automatic day→sunset→night→sunrise loop (period in seconds;
  // default 16 min ≈ 8 min day + 8 min night), with occasional rain spells.
  // Time-of-day is derived from the real wall clock, so it's deterministic and
  // refresh-stable: a full 16-min cycle is just the real day compressed ~90×.
  setAutoCycle(on, period = 16 * 60) {
    this.autoCycle = !!on; this.cyclePeriod = period;
    if (on) { this.tod = ((Date.now() / 1000) / this.cyclePeriod) % 1; this._advanceCycle(0); } // apply the right sky at once
  }

  // Apply a (possibly blended) preset to the sky/fog/lights/bodies.
  _apply(p) {
    if (this.scene.background && this.scene.background.isColor) this.scene.background.setHex(p.sky);
    else this.scene.background = new THREE.Color(p.sky);
    if (this.scene.fog) { this.scene.fog.color.setHex(p.fog); this.scene.fog.near = p.near; this.scene.fog.far = p.far; }
    this.hemi.intensity = p.hemi; this.hemi.color.setHex(p.hSky); this.hemi.groundColor.setHex(p.hGnd);
    this.sun.intensity = p.sun; this.sun.color.setHex(p.sunCol);
    this.stars.visible = p.stars > 0;
    this.stars.material.uniforms.uOpacity.value = Math.min(1, p.stars);
    this.rain.visible = p.rain > 0;
    this._rainScale = p.rain;
    this._baseHemi = p.hemi;
    this.daylight = THREE.MathUtils.clamp((p.sun - 0.5) / 0.9, 0, 1); // 1 = bright day, 0 = night
    this.sunSprite.visible = p.body === "sun";
    this.moonSprite.visible = p.body === "moon";
    if (p.body === "sun") this.sunSprite.material.color.setHex(p.sunCol);
    const dir = p.body === "moon" ? this.moonDir : this.sunDir;
    this.sun.position.copy(dir).multiplyScalar(this._sunDist);
  }

  // Advance the automatic day/night loop one step and apply the blended sky.
  _advanceCycle(dt) {
    // Anchor to the real clock (deterministic / refresh-stable) rather than
    // accumulating frame deltas — so reloading keeps the same time of day, and
    // the sky keeps turning even when the sim is paused or on the menu.
    this.tod = ((Date.now() / 1000) / this.cyclePeriod) % 1;
    let a = CYCLE[0], b = CYCLE[CYCLE.length - 1];
    for (let i = 0; i < CYCLE.length - 1; i++) { if (this.tod >= CYCLE[i].at && this.tod < CYCLE[i + 1].at) { a = CYCLE[i]; b = CYCLE[i + 1]; break; } }
    const t = (this.tod - a.at) / Math.max(1e-4, b.at - a.at);
    let p = lerpPreset(PRESETS[a.m], PRESETS[b.m], t);
    // Occasional rain spells (storm at night, rain by day).
    this._rainEvT = (this._rainEvT == null ? 90 : this._rainEvT) - dt;
    if (this._rainEvT <= 0) {
      this._rainEvT = 90 + Math.random() * 150;
      if (!this._raining && Math.random() < 0.4) { this._raining = true; this._rainDur = 60 + Math.random() * 100; }
    }
    if (this._raining) { this._rainDur -= dt; if (this._rainDur <= 0) this._raining = false; }
    this._rainAmt = lerp(this._rainAmt == null ? 0 : this._rainAmt, this._raining ? 1 : 0, Math.min(1, dt * 0.35));
    if (this._rainAmt > 0.01) p = lerpPreset(p, p.sun < 0.9 ? PRESETS.storm : PRESETS.rain, this._rainAmt);
    this._apply(p);
  }

  update(dt, camPos) {
    if (this.autoCycle) this._advanceCycle(dt);
    this.stars.position.copy(camPos);
    if (this.sunSprite.visible) this.sunSprite.position.copy(camPos).addScaledVector(this.sunDir, 12000);
    if (this.moonSprite.visible) this.moonSprite.position.copy(camPos).addScaledVector(this.moonDir, 12000);
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
      this.hemi.intensity = (this._baseHemi != null ? this._baseHemi : PRESETS[this.mode].hemi) + f * f * 1.9;
    }
  }
}
