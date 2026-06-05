import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// A single post pass that does chromatic aberration, colour grade (warm/cool +
// teal-orange split), saturation/contrast, scanlines, film grain and vignette —
// all driven by uniforms so one shader serves every "look".
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.03 },
    uScan: { value: 0.0 },
    uChroma: { value: 0.0016 },
    uWarm: { value: 0.25 },
    uTealOrange: { value: 0.25 },
    uContrast: { value: 1.06 },
    uSat: { value: 1.04 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uVignette, uGrain, uScan, uChroma, uWarm, uTealOrange, uContrast, uSat;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 toC = uv - 0.5;
      vec3 col;
      if (uChroma > 0.0) {
        vec2 off = toC * uChroma;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // contrast about mid-grey
      col = (col - 0.5) * uContrast + 0.5;
      // saturation
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      // overall warm/cool
      col += vec3(uWarm * 0.06, 0.0, -uWarm * 0.06);
      // teal shadows / orange highlights
      if (uTealOrange > 0.0) {
        float t = smoothstep(0.15, 0.85, l);
        vec3 shadow = vec3(0.0, 0.10, 0.16);
        vec3 high = vec3(0.16, 0.07, -0.04);
        col += mix(shadow, high, t) * uTealOrange;
      }
      // scanlines
      if (uScan > 0.0) {
        float s = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159);
        col *= 1.0 - uScan * (1.0 - s);
      }
      // film grain
      if (uGrain > 0.0) {
        col += (hash(uv * uResolution + fract(uTime)) - 0.5) * uGrain;
      }
      // vignette
      float v = 1.0 - uVignette * dot(toC, toC) * 2.6;
      col *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// Per-look bloom + grade parameters.
const LOOKS = {
  cinematic: { bloom: [0.55, 0.7, 0.55], grade: { uVignette: 0.35, uGrain: 0.03, uScan: 0.0, uChroma: 0.0016, uWarm: 0.25, uTealOrange: 0.28, uContrast: 1.06, uSat: 1.05 } },
  golden:    { bloom: [0.95, 0.8, 0.45], grade: { uVignette: 0.42, uGrain: 0.02, uScan: 0.0, uChroma: 0.0020, uWarm: 0.6, uTealOrange: 0.55, uContrast: 1.05, uSat: 1.14 } },
  retro:     { bloom: [0.8, 0.6, 0.5], grade: { uVignette: 0.5, uGrain: 0.12, uScan: 0.1, uChroma: 0.004, uWarm: -0.12, uTealOrange: 0.32, uContrast: 1.14, uSat: 1.0 } },
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), 0.55, 0.7, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass()); // tone map + sRGB before the grade
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uResolution.value.copy(size);
    this.composer.addPass(this.grade);
    this.enabled = false;
    this.look = "off";
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uResolution.value.set(w, h);
  }
  setLook(name) {
    this.look = name;
    this.enabled = name !== "off" && LOOKS[name] != null;
    if (!this.enabled) return;
    const L = LOOKS[name];
    this.bloom.strength = L.bloom[0]; this.bloom.radius = L.bloom[1]; this.bloom.threshold = L.bloom[2];
    for (const k in L.grade) this.grade.uniforms[k].value = L.grade[k];
  }
  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render();
  }
}
