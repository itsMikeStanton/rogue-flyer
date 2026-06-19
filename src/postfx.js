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
      // Slight zoom so the chromatic-aberration taps never sample past the frame.
      vec2 uv = 0.5 + (vUv - 0.5) * (1.0 - uOverscan);
      vec2 toC = uv - 0.5;
      float r2 = dot(toC, toC);
      // CRT tube warp: bow each axis by the SQUARE of the other (Timothy Lottes
      // style) so the whole picture bulges like an old curved screen and the
      // corners round off into the bezel below. uDistort = curvature amount;
      // the afterburner bulges it harder for a warp-speed fishbowl.
      float warp = (uDistort + uSpeed * 0.9) * 0.25;
      vec2 cc = uv * 2.0 - 1.0;                 // -1..1 from screen centre
      vec2 woff = abs(cc.yx) * warp;            // x bends by y², y bends by x²
      cc += cc * woff * woff;
      vec2 base = cc * 0.5 + 0.5;               // back to 0..1 sample coords
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
      // CRT bezel: the warped corners push off-screen — read those as black with a
      // soft rounded edge so you get the curved-tube border. No-op when warp is 0.
      vec2 edge = smoothstep(vec2(0.0), vec2(0.004), base) * (1.0 - smoothstep(vec2(1.0) - 0.004, vec2(1.0), base));
      col *= mix(1.0, edge.x * edge.y, clamp(warp * 6.0, 0.0, 1.0));
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
    this._hudOn = false;
    this._hudTex = null;
    this._hudScene = null;
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.grade.uniforms.uResolution.value.set(w, h);
  }
  // Build a fullscreen overlay quad that draws the 2D HUD canvas through the SAME
  // CRT warp as the scene. Rendered as an ordinary mesh AFTER the composer (the
  // standard, reliable texture path) so the instruments bow with the picture.
  setHudCanvas(canvas) {
    if (!canvas || this._hudScene) return;
    // Upload an offscreen COPY of the HUD, not the live DOM canvas: a CSS-hidden
    // DOM canvas can read back empty via texImage2D in some browsers. We blit the
    // live HUD into this canvas (which is never in the DOM) each frame instead.
    this._hudSrc = canvas;
    this._hudCopy = document.createElement("canvas");
    this._hudCopyCtx = this._hudCopy.getContext("2d");
    this._hudTex = new THREE.CanvasTexture(this._hudCopy);
    this._hudTex.minFilter = THREE.LinearFilter;
    this._hudTex.magFilter = THREE.LinearFilter;
    this._hudTex.generateMipmaps = false;
    this._hudTex.colorSpace = THREE.SRGBColorSpace;
    this._hudMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uHud: { value: this._hudTex },
        uWarp: { value: 0 }, uScan: { value: 0 }, uHudScale: { value: 1 },
        uRes: { value: this.grade.uniforms.uResolution.value },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uHud;
        uniform float uWarp, uScan, uHudScale;
        uniform vec2 uRes;
        void main() {
          vec2 cc = (vUv * 2.0 - 1.0) * uHudScale; // >1 expands the sampled area, so the
          vec2 woff = abs(cc.yx) * uWarp;          // whole HUD is displayed smaller, inset
          cc += cc * woff * woff;                   // from the edges with transparent margin
          vec2 base = cc * 0.5 + 0.5;               // (counters the scene's fill-zoom crop)
          if (base.x < 0.0 || base.x > 1.0 || base.y < 0.0 || base.y > 1.0) discard;
          vec4 h = texture2D(uHud, base);
          if (uScan > 0.0) { float s = 0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159); h.rgb *= 1.0 - uScan * (1.0 - s); }
          gl_FragColor = h;
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._hudMat);
    quad.frustumCulled = false;
    this._hudScene = new THREE.Scene();
    this._hudScene.add(quad);
    this._hudCam = new THREE.Camera(); // clip-space quad; no projection needed
  }
  // Toggle whether the HUD overlay is drawn (true while the composer owns the
  // frame; false in VR / FX-off, where the flat CSS overlay shows it instead).
  setHudComposite(on) { this._hudOn = !!on; }
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
    // uOverscan is set per-frame in render() so the zoom tracks the live warp.
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
    const g = this.grade.uniforms;
    g.uTime.value += dt;
    // Zoom (overscan) just enough to pull the warped corners back inside the
    // frame, so heavy CRT curvature fills the screen instead of showing black
    // corners. Scales with the live warp (slider + afterburner): o = w²/(1+w²)
    // makes the bulged corner land right at the frame edge.
    const warp = (g.uDistort.value + g.uSpeed.value * 0.9) * 0.25;
    g.uOverscan.value = warp > 0.0 ? (warp * warp) / (1.0 + warp * warp) : 0.0;
    this.composer.render();
    // Overlay the HUD on top of the composited frame, warped to match the tube.
    if (this._hudOn && this._hudScene) {
      const hm = this._hudMat.uniforms;
      hm.uWarp.value = warp; // same curve as the scene
      hm.uScan.value = g.uScan.value;
      // Inset the HUD enough to clear the scene's fill-zoom, but only partway so it
      // doesn't shrink too hard (HUD_INSET < 1 keeps the UI closer to full size).
      const HUD_INSET = 0.3;
      hm.uHudScale.value = 1 + (1 / (1 - g.uOverscan.value) - 1) * HUD_INSET;
      // Blit the live HUD into our offscreen copy, then upload that. Cap the copy
      // resolution so a huge fullscreen / hi-DPI HUD canvas can't blow past a
      // canvas-area / texture limit (which freezes the upload).
      const sw = this._hudSrc.width, sh = this._hudSrc.height;
      if (sw && sh) {
        const scl = Math.min(1, 3072 / sw, 3072 / sh);
        const cw = Math.max(1, Math.round(sw * scl)), ch = Math.max(1, Math.round(sh * scl));
        if (this._hudCopy.width !== cw || this._hudCopy.height !== ch) { this._hudCopy.width = cw; this._hudCopy.height = ch; }
        this._hudCopyCtx.clearRect(0, 0, cw, ch);
        this._hudCopyCtx.drawImage(this._hudSrc, 0, 0, sw, sh, 0, 0, cw, ch);
      }
      this._hudTex.needsUpdate = true; // the HUD canvas is redrawn every frame
      const ac = this.renderer.autoClear;
      this.renderer.autoClear = false; // draw over the scene, don't wipe it
      this.renderer.render(this._hudScene, this._hudCam);
      this.renderer.autoClear = ac;
    }
  }
}
