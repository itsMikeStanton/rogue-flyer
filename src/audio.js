// Synthesized sound via the Web Audio API — no audio files, works offline.
// A continuous jet-engine drone (pitch/volume track throttle + speed) plus
// one-shot effects: cannon, missile launch, explosion, lock tone, hull hit.
// Browsers require a user gesture before audio starts, so call resume() from
// a click/keypress (we do it on FLY and on first interaction).

const MUTE_KEY = "rogueflyer.muted";
const MASTER_VOL = 0.6;

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.muted = localStorage.getItem(MUTE_KEY) === "1";
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

  // ---- Continuous engine ----
  startEngine() {
    this._ensure();
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);

    const low = ctx.createOscillator();
    low.type = "sawtooth";
    low.frequency.value = 50;
    const whine = ctx.createOscillator();
    whine.type = "triangle";
    whine.frequency.value = 140;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    low.connect(lp); whine.connect(lp); lp.connect(g);

    const noise = this._noise();
    noise.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = "bandpass";
    nbp.frequency.value = 1200;
    nbp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nbp); nbp.connect(ng); ng.connect(g);

    low.start(); whine.start(); noise.start();
    this.engine = { g, low, whine, lp, noise, ng };
  }

  stopEngine() {
    if (!this.engine) return;
    const { g, low, whine, noise } = this.engine;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.1);
    try { low.stop(t + 0.3); whine.stop(t + 0.3); noise.stop(t + 0.3); } catch (_) {}
    this.engine = null;
  }

  updateEngine(throttle, speed) {
    if (!this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    e.low.frequency.setTargetAtTime(45 + throttle * 70 + speed * 0.04, t, 0.08);
    e.whine.frequency.setTargetAtTime(130 + throttle * 260, t, 0.08);
    e.lp.frequency.setTargetAtTime(500 + throttle * 2600, t, 0.08);
    e.ng.gain.setTargetAtTime(0.04 + throttle * 0.14, t, 0.08);
    e.g.gain.setTargetAtTime(0.1 + throttle * 0.18, t, 0.08);
  }

  // ---- One-shots ----
  gun() {
    if (!this.ctx) return;
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

  missile() {
    if (!this.ctx) return;
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

  explosion(size = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const amp = Math.min(0.6, 0.22 * size);
    const n = this._noise();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(lp); lp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 0.65);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(amp * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.5);
  }

  lock() {
    if (!this.ctx) return;
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

  hit() {
    if (!this.ctx) return;
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
}
