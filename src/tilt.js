// Tilt-to-steer: drive roll & pitch from the device's orientation sensors.
//
// Writes into the same shared state that the on-screen stick uses (roll/pitch),
// so the two are mutually exclusive — callers hide the stick while tilt is on.
// Orientation semantics depend on how the screen is rotated, so we pick the
// device axes per screen-orientation angle and work from a calibrated neutral
// baseline (the "recenter" point), which makes any hold-angle comfortable.

const STORE = "rogueflyer.tilt.v1";

function clamp(v) { return Math.max(-1, Math.min(1, v)); }

export class TiltControls {
  constructor(state) {
    this.state = state;
    this.enabled = false;
    this.baseline = null;        // {p, r} captured neutral, in degrees
    this.range = 32;             // degrees of tilt for full control deflection
    this.invertPitch = false;
    this.invertRoll = false;
    this._handler = (e) => this.onOrient(e);

    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (typeof saved.invertPitch === "boolean") this.invertPitch = saved.invertPitch;
      if (typeof saved.invertRoll === "boolean") this.invertRoll = saved.invertRoll;
      if (typeof saved.range === "number") this.range = saved.range;
    } catch (_) { /* ignore */ }
  }

  supported() {
    return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        invertPitch: this.invertPitch, invertRoll: this.invertRoll, range: this.range,
      }));
    } catch (_) { /* ignore */ }
  }

  // Must be called from a user gesture (iOS requires a permission prompt).
  async enable() {
    if (!this.supported()) return false;
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") return false;
      } catch (_) {
        return false;
      }
    }
    window.addEventListener("deviceorientation", this._handler, true);
    this.enabled = true;
    this.baseline = null; // recalibrate on first reading
    return true;
  }

  disable() {
    window.removeEventListener("deviceorientation", this._handler, true);
    this.enabled = false;
    this.baseline = null;
    this.state.pitch = 0;
    this.state.roll = 0;
  }

  recenter() { this.baseline = null; }

  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;

    // Screen rotation in degrees (0 portrait, 90/270 landscape).
    let angle = 0;
    if (screen.orientation && typeof screen.orientation.angle === "number") angle = screen.orientation.angle;
    else if (typeof window.orientation === "number") angle = window.orientation;

    // Map device beta/gamma to plane pitch/roll for the current rotation.
    let pitchSrc, rollSrc;
    if (angle === 90) { pitchSrc = e.gamma; rollSrc = e.beta; }
    else if (angle === 270 || angle === -90) { pitchSrc = -e.gamma; rollSrc = -e.beta; }
    else if (angle === 180) { pitchSrc = -e.beta; rollSrc = -e.gamma; }
    else { pitchSrc = e.beta; rollSrc = e.gamma; } // portrait

    if (!this.baseline) this.baseline = { p: pitchSrc, r: rollSrc };

    let p = (pitchSrc - this.baseline.p) / this.range;
    let r = (rollSrc - this.baseline.r) / this.range;
    // Default: tilt the device's far edge down → nose down (negative pitch).
    if (!this.invertPitch) p = -p;
    if (this.invertRoll) r = -r;

    this.state.pitch = clamp(p);
    this.state.roll = clamp(r);
  }
}
