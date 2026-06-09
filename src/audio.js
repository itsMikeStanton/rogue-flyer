// Audio: real samples when present, synthesized fallback otherwise. Drop your
// files into a top-level /sounds folder and list them in SOUNDS below. Each
// entry is an array of variation files — a random one plays each time, and
// one-shots get slight random pitch/volume so repeats (gunfire, explosions)
// don't sound identical. mp3 OR wav both work. Any missing file silently falls
// back to the built-in synth, so the game always has audio.
//
// A continuous jet engine (pitch/volume track throttle + speed, with an optional
// high-power layer that fades in) plus positional one-shots.

import * as THREE from "three";

const MUTE_KEY = "rogueflyer.muted";
const MASTER_VOL = 0.6;

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

// ---- Sound manifest --------------------------------------------------------
// name -> [variation files]. Add files and/or more variations freely, e.g.
//   gun: ["sounds/gun_a.wav", "sounds/gun_b.wav", "sounds/gun_c.wav"]
// To switch a sound to wav just change the extension here.
const SOUNDS = {
  gun:        ["sounds/gun.mp3"],
  explosion:  ["sounds/explosion.mp3"],
  missile:    ["sounds/missile.mp3"],
  bomb:       ["sounds/bomb.mp3"],
  flak:       ["sounds/flak.mp3"],     // enemy cannon / ship + zeppelin flak
  lock:       ["sounds/lock.mp3"],     // lock-acquired chirp
  hit:        ["sounds/hit.mp3"],      // taking damage
  crash:      ["sounds/crash.mp3"],    // your aircraft going down
  ring:       ["sounds/ring.mp3"],     // checkpoint pass
  flare:      ["sounds/flare.mp3"],    // countermeasures
  gear:       ["sounds/gear.mp3"],     // OPTIONAL landing-gear servo
  flaps:      ["sounds/flaps.mp3"],    // OPTIONAL flap servo
  vtol:       ["sounds/vtol.mp3"],     // OPTIONAL VTOL nozzle servo
  brake:      ["sounds/brake.mp3"],    // OPTIONAL speedbrake whoosh
  engine:     ["sounds/engine.mp3"],      // looping idle/cruise engine
  engineHigh: ["sounds/engine_high.mp3"], // OPTIONAL looping high-power layer
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.buffers = {};        // name -> [AudioBuffer]
    this._loaded = false;
    this.muted = localStorage.getItem(MUTE_KEY) === "1";
    this._lastEnemyGun = 0;
  }

  // Lock the audio listener to the camera so panning matches what you see.
  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    cam.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const p = cam.position;
    if (l.positionX) {
      const t = this.ctx.currentTime, k = 0.02;
      l.positionX.setTargetAtTime(p.x, t, k);
      l.positionY.setTargetAtTime(p.y, t, k);
      l.positionZ.setTargetAtTime(p.z, t, k);
      l.forwardX.setTargetAtTime(_fwd.x, t, k);
      l.forwardY.setTargetAtTime(_fwd.y, t, k);
      l.forwardZ.setTargetAtTime(_fwd.z, t, k);
      l.upX.setTargetAtTime(_up.x, t, k);
      l.upY.setTargetAtTime(_up.y, t, k);
      l.upZ.setTargetAtTime(_up.z, t, k);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }
  }

  // A positional node: distance falloff + stereo pan, feeding the master.
  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = "equalpower"; // cheap; plenty of sources in a dogfight
    p.distanceModel = "inverse";
    p.refDistance = 250;
    p.maxDistance = 14000;
    p.rolloffFactor = 1.0;
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else if (p.setPosition) {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(this.master);
    return p;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOL;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 1.0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this._load(); // fire-and-forget; samples take over from synth as they arrive
  }

  // Fetch + decode every listed file. Missing/undecodable files are skipped
  // (that sound stays on its synth fallback).
  async _load() {
    if (this._loaded || !this.ctx) return;
    this._loaded = true;
    for (const [name, urls] of Object.entries(SOUNDS)) {
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const arr = await res.arrayBuffer();
          const decoded = await this.ctx.decodeAudioData(arr);
          (this.buffers[name] || (this.buffers[name] = [])).push(decoded);
        } catch (_) { /* no file → synth fallback */ }
      }
    }
    // If the engine started on the synth before its sample loaded, swap it in.
    if (this.engine && !this.engine.sample && this.buffers.engine) this.startEngine();
  }

  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, this.ctx.currentTime, 0.02);
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  _noise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    return s;
  }

  // Play a loaded sample variation with slight random pitch/gain. Returns true
  // if it played (so callers can fall back to synth when no sample exists).
  // opts: { pos, gain=1, rate=1, rateVar=0, gainVar=0 }
  _play(name, opts = {}) {
    const bufs = this.buffers[name];
    if (!bufs || !bufs.length || !this.ctx) return false;
    const buf = bufs[(Math.random() * bufs.length) | 0];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rv = opts.rateVar || 0, gv = opts.gainVar || 0;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() * 2 - 1) * rv);
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, (opts.gain == null ? 1 : opts.gain) * (1 + (Math.random() * 2 - 1) * gv));
    src.connect(g);
    g.connect(opts.pos ? this._panner(opts.pos) : this.master);
    src.start();
    return true;
  }

  // ---- Continuous engine -----------------------------------------------------
  startEngine() {
    this._ensure();
    if (!this.ctx) return;
    this.stopEngine();
    if (this.buffers.engine) this._startSampleEngine();
    else this._startSynthEngine();
  }

  _startSampleEngine() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(this.master);
    const src = ctx.createBufferSource(); src.buffer = this.buffers.engine[0]; src.loop = true; src.connect(g); src.start();
    const e = { sample: true, g, src };
    if (this.buffers.engineHigh) { // optional high-power layer, faded in by throttle
      const gHigh = ctx.createGain(); gHigh.gain.value = 0.0001; gHigh.connect(this.master);
      const srcHigh = ctx.createBufferSource(); srcHigh.buffer = this.buffers.engineHigh[0]; srcHigh.loop = true; srcHigh.connect(gHigh); srcHigh.start();
      e.gHigh = gHigh; e.srcHigh = srcHigh;
    }
    g.gain.setTargetAtTime(0.22, ctx.currentTime, 0.25);
    this.engine = e;
  }

  _startSynthEngine() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);

    const low = ctx.createOscillator();
    low.type = "sawtooth";
    low.frequency.value = 45;
    const whine = ctx.createOscillator();
    whine.type = "triangle";
    whine.frequency.value = 90;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 480;
    low.connect(lp); whine.connect(lp); lp.connect(g);

    const noise = this._noise();
    noise.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = "bandpass";
    nbp.frequency.value = 850;
    nbp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nbp); nbp.connect(ng); ng.connect(g);

    low.start(); whine.start(); noise.start();
    this.engine = { synth: true, g, low, whine, lp, noise, ng };
  }

  stopEngine() {
    if (!this.engine) return;
    const e = this.engine, t = this.ctx.currentTime;
    e.g.gain.setTargetAtTime(0.0001, t, 0.1);
    if (e.gHigh) e.gHigh.gain.setTargetAtTime(0.0001, t, 0.1);
    try {
      if (e.sample) { e.src.stop(t + 0.3); if (e.srcHigh) e.srcHigh.stop(t + 0.3); }
      else { e.low.stop(t + 0.3); e.whine.stop(t + 0.3); e.noise.stop(t + 0.3); }
    } catch (_) { /* ignore */ }
    this.engine = null;
  }

  updateEngine(throttle, speed) {
    if (!this.engine) return;
    const e = this.engine, t = this.ctx.currentTime;
    // Pitch climbs across the whole throttle range, but the peak (at 100%) is
    // kept low — it's the old, reined-in top end, so it tops out as a steady
    // rumble rather than a drill.
    const p = throttle;
    if (e.sample) {
      const rate = 0.82 + p * 0.30 + Math.min(0.12, speed * 0.0004);
      e.src.playbackRate.setTargetAtTime(rate, t, 0.12);
      e.g.gain.setTargetAtTime(0.12 + throttle * 0.10, t, 0.12);
      if (e.srcHigh) {
        e.srcHigh.playbackRate.setTargetAtTime(0.9 + p * 0.4, t, 0.12);
        const hi = Math.max(0, (throttle - 0.45) / 0.55); // 0 below ~45%, ramps to 1 at full
        e.gHigh.gain.setTargetAtTime(hi * hi * 0.2, t, 0.15);
      }
    } else {
      // Low, throaty synth: a deep drone + a soft whine, both kept well down in
      // pitch so it reads as a jet rumble rather than a dentist's drill.
      e.low.frequency.setTargetAtTime(38 + p * 20 + speed * 0.02, t, 0.1);
      e.whine.frequency.setTargetAtTime(85 + p * 55, t, 0.1);
      e.lp.frequency.setTargetAtTime(380 + p * 720, t, 0.1);
      e.ng.gain.setTargetAtTime(0.025 + throttle * 0.05, t, 0.1);
      e.g.gain.setTargetAtTime(0.045 + throttle * 0.07, t, 0.1);
    }
  }

  // ---- One-shots (sample if present, else synth) -----------------------------
  gun() { if (this._play("gun", { gain: 0.9, rateVar: 0.10, gainVar: 0.15 })) return; this._synthGun(); }
  missile() { if (this._play("missile", { gain: 0.9, rateVar: 0.06 })) return; this._synthMissile(); }
  bomb() { if (this._play("bomb", { gain: 1.0, rateVar: 0.05 })) return; if (this._play("missile", { gain: 1.0 })) return; this._synthMissile(); }
  explosion(size = 1, pos = null) {
    if (this._play("explosion", { pos, gain: Math.min(1.1, 0.45 + size * 0.18), rate: 1 / (0.82 + size * 0.12), rateVar: 0.12, gainVar: 0.15 })) return;
    this._synthExplosion(size, pos);
  }
  enemyGun(pos) {
    if (!this.ctx) return;
    if (this.ctx.currentTime - this._lastEnemyGun < 0.05) return; // rate-limit a swarm
    this._lastEnemyGun = this.ctx.currentTime;
    if (this._play("flak", { pos, gain: 0.7, rateVar: 0.12, gainVar: 0.1 })) return;
    this._synthEnemyGun(pos);
  }
  lock() { if (this._play("lock", { gain: 0.8 })) return; this._synthLock(); }
  hit() { if (this._play("hit", { gain: 0.9, rateVar: 0.1 })) return; this._synthHit(); }
  crash(pos = null) { if (this._play("crash", { pos, gain: 1.1, rateVar: 0.05 })) return; this._synthExplosion(2.6, pos); }
  ring() { if (this._play("ring", { gain: 0.7 })) return; this._synthRing(); }
  flare() { if (this._play("flare", { gain: 0.55, rateVar: 0.12 })) return; this._synthFlare(); }
  // Mechanical interactions (hydraulic servo whir + a clunk on lock).
  gear(down = true) {
    if (this._play("gear", { gain: 0.7 })) return;
    this._synthServo({ f0: down ? 340 : 240, f1: down ? 210 : 360, dur: 0.7, gain: 0.085, clunk: true });
  }
  flaps(down = true) {
    if (this._play("flaps", { gain: 0.6 })) return;
    this._synthServo({ f0: down ? 430 : 300, f1: down ? 300 : 430, dur: 0.42, gain: 0.05, clunk: false });
  }
  vtol(down = true) {
    if (this._play("vtol", { gain: 0.6 })) return;
    this._synthServo({ f0: 280, f1: down ? 200 : 300, dur: 0.6, gain: 0.075, clunk: true });
  }
  brake() {
    if (this._play("brake", { gain: 0.6 })) return;
    this._synthBrake();
  }

  // ---- Synthesized fallbacks -------------------------------------------------
  _synthGun() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.07);
  }

  _synthMissile() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    n.connect(lp); lp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.75);
  }

  _synthExplosion(size = 1, pos = null) {
    const ctx = this.ctx, t = ctx.currentTime;
    const amp = Math.min(0.7, 0.3 * size);
    const dest = pos ? this._panner(pos) : this.master;

    const n = this._noise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(lp); lp.connect(g); g.connect(dest);
    n.start(t); n.stop(t + 0.65);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(amp * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(dest);
    o.start(t); o.stop(t + 0.5);
  }

  _synthEnemyGun(pos) {
    const ctx = this.ctx, t = ctx.currentTime;
    const dest = pos ? this._panner(pos) : this.master;
    const n = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(bp); bp.connect(g); g.connect(dest);
    n.start(t); n.stop(t + 0.07);
  }

  _synthLock() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 900;
      const g = ctx.createGain();
      const s = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.16, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.09);
      o.connect(g); g.connect(this.master);
      o.start(s); o.stop(s + 0.1);
    }
  }

  _synthHit() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(lp); lp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.22);
  }

  // A pleasant two-note rising chime for a checkpoint pass.
  _synthRing() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [i, f] of [[0, 740], [1, 1110]]) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const g = ctx.createGain(); const s = t + i * 0.08;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.14, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
      o.connect(g); g.connect(this.master);
      o.start(s); o.stop(s + 0.24);
    }
  }

  // A soft filtered "whoomp" for ejecting countermeasures.
  _synthFlare() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.3); bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.32);
  }

  // A hydraulic servo whir (pitch sliding f0→f1) with an optional end clunk —
  // shared by gear / flaps / VTOL nozzles.
  _synthServo({ f0 = 320, f1 = 200, dur = 0.5, gain = 0.08, clunk = true } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 600; bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.05);
    g.gain.setValueAtTime(gain, t + Math.max(0.06, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(bp); bp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    if (clunk) {
      const ct = t + dur;
      const n = this._noise();
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.16, ct);
      cg.gain.exponentialRampToValueAtTime(0.001, ct + 0.12);
      n.connect(lp); lp.connect(cg); cg.connect(this.master);
      n.start(ct); n.stop(ct + 0.14);
    }
  }

  // A short airy whoosh as the speedbrake pops out.
  _synthBrake() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.18); bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.34);
  }

  // ---- Seeker growl (kept synth: it's a live parametric tone) -----------------
  startSeek() {
    if (!this.ctx || this._seek) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 480;
    const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 6;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.045;
    const base = ctx.createConstantSource(); base.offset.value = 0.045;
    const g = ctx.createGain(); g.gain.value = 0; // driven entirely by base + lfo
    lfo.connect(lfoGain); lfoGain.connect(g.gain); base.connect(g.gain);
    o.connect(g); g.connect(this.master);
    o.start(); lfo.start(); base.start();
    this._seek = { o, lfo, base };
  }
  updateSeek(progress) {
    if (!this._seek) return;
    const p = Math.max(0, Math.min(1, progress));
    this._seek.o.frequency.value = 480 + p * 560;   // pitch climbs
    this._seek.lfo.frequency.value = 5 + p * 20;     // pulses faster
  }
  stopSeek() {
    if (!this._seek) return;
    const s = this._seek; this._seek = null;
    try { s.o.stop(); s.lfo.stop(); s.base.stop(); } catch (_) { /* ignore */ }
  }
}
