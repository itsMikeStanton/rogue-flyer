import * as THREE from "three";

// FireField — a GPU-driven, reusable fire engine.
//
// One instanced billboard mesh holds ALL flames in the world; every quad is a
// flame particle whose whole life (rise, turbulent lick, temperature colour,
// flicker, fade) is computed analytically in the vertex/fragment shader from a
// per-particle seed + the wall clock. The CPU never touches a particle — it only
// drives a small set of EMITTERS (≤ MAX) through uniform arrays.
//
// An emitter is a hot spot: a position + radius + height + base particle size +
// intensity (0 = off). Anything that should be on fire (crash wrecks, ground
// hits, burning trees, a torched building, the volcano vent…) just `acquire()`s
// an emitter, drives its `set()` each frame, and `release()`s it when out. The
// flames bloom hot-white at the core (the post bloom pass loves them) and cool
// through yellow → orange → red → ember smoke as they rise.
const MAX = 40;          // max simultaneous emitters (uniform-array budget)
const PER = 80;          // particles per emitter

const VERT = /* glsl */`
  #define MAX ${MAX}
  uniform float uTime;
  uniform vec4 uEPos[MAX];   // xyz = world position, w = intensity (0..1, 0 = off)
  uniform vec4 uEShape[MAX]; // x = radius, y = height, z = particle size, w = life speed
  attribute float aEmitter;  // which emitter this particle belongs to
  attribute float aSeed;     // random 0..1 — angle / spread / phase salt
  attribute float aSeed2;    // random 0..1 — speed / flicker salt
  attribute float aPhase;    // random 0..1 — life offset so particles don't pulse together
  varying float vLife;
  varying float vAlpha;
  varying vec2 vUv;
  void main() {
    int idx = int(aEmitter + 0.5);
    vec4 ep = uEPos[idx];
    vec4 es = uEShape[idx];
    float intensity = ep.w;
    // Looping normalized life 0..1, speed varied per particle.
    float life = fract(uTime * es.w * (0.6 + 0.8 * aSeed2) + aPhase);
    // Horizontal: a ring offset that converges as the flame rises, plus a
    // wandering turbulent lick that grows with height.
    float ang = aSeed * 6.2831853;
    float baseR = es.x * (0.12 + 0.78 * aSeed) * (1.0 - 0.55 * life);
    float t = uTime;
    float wobX = sin(t * 3.1 + aSeed * 40.0) + 0.5 * sin(t * 6.7 + aSeed2 * 25.0);
    float wobZ = cos(t * 3.7 + aSeed2 * 33.0) + 0.5 * sin(t * 5.3 + aSeed * 19.0);
    vec3 wp = ep.xyz;
    wp.x += cos(ang) * baseR + wobX * es.x * 0.22 * life;
    wp.z += sin(ang) * baseR + wobZ * es.x * 0.22 * life;
    wp.y += es.y * pow(life, 0.85);             // rise, easing upward
    // Size: fat at the base, tapering as it climbs; flicker; killed when the
    // emitter is off (intensity 0) so spare slots cost nothing on screen.
    float flick = 0.78 + 0.22 * sin(t * 17.0 + aSeed * 60.0);
    float size = es.z * (1.0 - 0.5 * life) * (0.65 + 0.5 * aSeed) * flick * step(0.001, intensity);
    vAlpha = intensity * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life)) * flick;
    vLife = life;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);  // mesh untransformed → modelView == view
    mv.xy += position.xy * size;                 // billboard: offset in view space
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying float vLife;
  varying float vAlpha;
  varying vec2 vUv;
  // Temperature ramp: hot near-white → yellow → orange → red → dark ember.
  vec3 ramp(float t) {
    vec3 c1 = vec3(1.0, 0.96, 0.78);
    vec3 c2 = vec3(1.0, 0.62, 0.16);
    vec3 c3 = vec3(0.96, 0.22, 0.05);
    vec3 c4 = vec3(0.30, 0.07, 0.03);
    vec3 c = mix(c1, c2, smoothstep(0.0, 0.30, t));
    c = mix(c, c3, smoothstep(0.25, 0.66, t));
    c = mix(c, c4, smoothstep(0.62, 1.0, t));
    return c;
  }
  void main() {
    float d = length(vUv - 0.5) * 2.0;          // 0 at centre → 1 at edge
    float soft = smoothstep(1.0, 0.15, d);       // round, soft-edged
    if (soft * vAlpha < 0.003) discard;
    vec3 col = ramp(vLife) * (1.35 - 0.35 * vLife); // brighten the core for bloom
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

export class FireField {
  constructor(scene) {
    this.scene = scene;
    const n = MAX * PER;
    const base = new THREE.PlaneGeometry(1, 1); // unit billboard quad (xy plane)
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("uv", base.attributes.uv);
    const emit = new Float32Array(n), seed = new Float32Array(n), seed2 = new Float32Array(n), phase = new Float32Array(n);
    for (let e = 0; e < MAX; e++) {
      for (let p = 0; p < PER; p++) {
        const i = e * PER + p;
        emit[i] = e; seed[i] = Math.random(); seed2[i] = Math.random(); phase[i] = Math.random();
      }
    }
    geo.setAttribute("aEmitter", new THREE.InstancedBufferAttribute(emit, 1));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute("aSeed2", new THREE.InstancedBufferAttribute(seed2, 1));
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    geo.instanceCount = n;

    const ePos = [], eShape = [];
    for (let i = 0; i < MAX; i++) { ePos.push(new THREE.Vector4(0, 0, 0, 0)); eShape.push(new THREE.Vector4(1, 1, 1, 1)); }
    this.uniforms = { uTime: { value: 0 }, uEPos: { value: ePos }, uEShape: { value: eShape } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; // particles live in the shader; bounding sphere is meaningless
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    this._free = []; for (let i = MAX - 1; i >= 0; i--) this._free.push(i); // slot free-list
  }

  // Grab a free emitter slot. Returns an id, or -1 if all MAX are in use.
  acquire() { const id = this._free.pop(); return id == null ? -1 : id; }

  // Drive an emitter. intensity 0 hides it (but keeps the slot reserved).
  set(id, x, y, z, { intensity = 1, radius = 4, height = 12, size = 4 } = {}) {
    if (id < 0) return;
    this.uniforms.uEPos.value[id].set(x, y, z, Math.max(0, intensity));
    // life speed ~ how fast a particle completes its rise (taller → a touch slower).
    const lifeSpeed = 1.0 / (0.55 + height * 0.018);
    this.uniforms.uEShape.value[id].set(radius, height, size, lifeSpeed);
  }

  // Give a slot back (and switch it off).
  release(id) { if (id < 0) return; this.uniforms.uEPos.value[id].w = 0; if (!this._free.includes(id)) this._free.push(id); }

  update(dt) { this.uniforms.uTime.value += dt; }

  reset() {
    for (let i = 0; i < MAX; i++) this.uniforms.uEPos.value[i].w = 0;
    this._free.length = 0; for (let i = MAX - 1; i >= 0; i--) this._free.push(i);
  }
}
