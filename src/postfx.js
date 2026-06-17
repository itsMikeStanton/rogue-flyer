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
    uDistort: { value: 0.10 },   // barrel lens distortion (edge warp)
    uSpeed: { value: 0.0 },      // afterburner: extra radial warp + streak blur (0..1)
    uOverscan: { value: 0.03 },  // zoom so distorted edges don't sample past frame
    uRgbShift: { value: 0.3 },   // extra horizontal R/B channel split (pixels)
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
    uniform float uTime, uVignette, uGrain, uScan, uChroma, uWarm, uTealOrange, uContrast, uSat, uDistort, uOverscan, uRgbShift, uSpeed;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      // Zoom in a touch so the barrel-warped edges keep sampling inside the frame.
      vec2 uv = 0.5 + (vUv - 0.5) * (1.0 - uOverscan);
      vec2 toC = uv - 0.5;
      float r2 = dot(toC, toC);
      // Barrel lens distortion — bows the image out toward the edges (afterburner
      // adds a strong extra bow so the world warps as you tear forward).
      vec2 base = uv + toC * ((uDistort + uSpeed * 0.35) * r2);
      // Chromatic aberration grows toward the edges (real-lens CA) + a flat RGB shift.
      vec2 ca = toC * (uChroma + uSpeed * 0.004) * (0.35 + r2 * 2.0);
      vec2 px = vec2(uRgbShift / uResolution.x, 0.0);
      vec3 col;
      col.r = texture2D(tDiffuse, base + ca + px).r;
      col.g = texture2D(tDiffuse, base).g;
      col.b = texture2D(tDiffuse, base - ca - px).b;
      // Afterburner radial streak: a few taps pulled outward from centre, so the
      // world smears past you at the edges — cheap warp-speed motion blur.
      if (uSpeed > 0.001) {
        vec3 acc = col;
        acc += texture2D(tDiffuse, base + toC * (uSpeed * 0.05)).rgb;
        acc += texture2D(tDiffuse, base + toC * (uSpeed * 0.10)).rgb;
        acc += texture2D(tDiffuse, base + toC * (uSpeed * 0.16)).rgb;
        col = mix(col, acc * 0.25, clamp(uSpeed, 0.0, 1.0) * 0.7);
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
      // vignette (tightens at speed for a tunnel-vision rush)
      float v = 1.0 - (uVignette + uSpeed * 0.3) * dot(toC, toC) * 2.6;
      col *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// Per-look bloom + grade parameters.
// Preset templates. Each is a FLAT settings object covering every adjustable
// knob (bloom + tone exposure + every grade uniform). The menu applies one of
// these wholesale; tweaking any single value flips the user to "custom". `off`
// is a real (neutral) settings object too, so a player can start from nothing
// and dial a single effect up. Overscan is derived from distortion, not stored.
export const FX_PRESETS = {
  off:       { exposure: 1.06, bloomStrength: 0.0,  bloomRadius: 0.0,  bloomThreshold: 1.0,  dayBloomCut: 0.0, chroma: 0.0,   rgbShift: 0.0, distort: 0.0,  vignette: 0.0,  grain: 0.0,  scan: 0.0,  warm: 0.0,   tealOrange: 0.0,  contrast: 1.0,  sat: 1.0 },
  cinematic: { exposure: 1.06, bloomStrength: 0.70, bloomRadius: 0.78, bloomThreshold: 0.46, dayBloomCut: 0.6, chroma: 0.014, rgbShift: 1.6, distort: 0.38, vignette: 0.40, grain: 0.03, scan: 0.0,  warm: 0.25,  tealOrange: 0.28, contrast: 1.06, sat: 1.05 },
  vivid:     { exposure: 1.06, bloomStrength: 0.86, bloomRadius: 0.72, bloomThreshold: 0.40, dayBloomCut: 0.6, chroma: 0.024, rgbShift: 3.5, distort: 0.66, vignette: 0.47, grain: 0.07, scan: 0.05, warm: 0.07,  tealOrange: 0.30, contrast: 1.10, sat: 1.03 },
  retro:     { exposure: 1.06, bloomStrength: 0.98, bloomRadius: 0.66, bloomThreshold: 0.38, dayBloomCut: 0.6, chroma: 0.034, rgbShift: 5.5, distort: 0.95, vignette: 0.54, grain: 0.12, scan: 0.1,  warm: -0.12, tealOrange: 0.32, contrast: 1.14, sat: 1.0 },
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
    this._bloomBase = 0;
    this._dayCut = 0;
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uResolution.value.set(w, h);
  }
  // Apply a full settings object. `enabled` gates the composer (off = plain
  // render), but exposure is a renderer-level tone-map setting so it's applied
  // either way — lowering it tames an over-bright daytime sky even with FX off.
  apply(s, enabled) {
    this.enabled = !!enabled;
    if (this.renderer) this.renderer.toneMappingExposure = s.exposure;
    this._bloomBase = s.bloomStrength;
    this._dayCut = s.dayBloomCut || 0;
    this.bloom.strength = s.bloomStrength;
    this.bloom.radius = s.bloomRadius;
    this.bloom.threshold = s.bloomThreshold;
    const u = this.grade.uniforms;
    u.uChroma.value = s.chroma;
    u.uRgbShift.value = s.rgbShift;
    u.uDistort.value = s.distort;
    u.uOverscan.value = Math.min(0.3, s.distort * 0.29 + (s.distort > 0 ? 0.02 : 0)); // zoom tracks the bow
    u.uVignette.value = s.vignette;
    u.uGrain.value = s.grain;
    u.uScan.value = s.scan;
    u.uWarm.value = s.warm;
    u.uTealOrange.value = s.tealOrange;
    u.uContrast.value = s.contrast;
    u.uSat.value = s.sat;
  }
  // Fade bloom toward its daytime floor as the sun climbs (dayBloomCut = how much
  // of the bloom to remove at full daylight). Keeps bright noon skies legible.
  setDaylight(daylight) {
    if (!this.enabled) return;
    this.bloom.strength = this._bloomBase * THREE.MathUtils.lerp(1.0, 1.0 - this._dayCut, daylight || 0);
  }
  // Afterburner warp amount (0..1). Always settable; only visible while the grade
  // pass is enabled (an FX look other than "off").
  setSpeed(v) { this.grade.uniforms.uSpeed.value = v; }
  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render();
  }
}
