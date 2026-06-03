// Input layer: HOTAS joystick (Gamepad API) + keyboard fallback.
//
// A "fancy" joystick reports as a standard gamepad with many axes & buttons:
// the stick (roll/pitch), a separate throttle axis, a twist/rudder axis, a hat
// switch, and lots of buttons. We expose a single getControls() that yields
// normalized {pitch, roll, yaw, throttle, view, reset, ...}, regardless of
// whether the input came from a stick or the keyboard.

const STORAGE_KEY = "rogueflyer.bindings.v1";

// Default axis bindings, tuned for a Logitech Extreme 3D Pro (a very common
// HOTAS). axis = index into gamepad.axes; invert flips sign. Throttles often
// rest at -1 (idle) .. +1 (full); throttleMode maps that range to 0..1.
const DEFAULTS = {
  roll: { axis: 0, invert: false, deadzone: 0.06 },
  pitch: { axis: 1, invert: false, deadzone: 0.06 },
  yaw: { axis: 5, invert: true, deadzone: 0.08 },
  throttle: { axis: 6, invert: true, deadzone: 0.0 },
  // button indices for actions (standard mapping-ish; remappable later)
  buttons: { fire: 0, missile: 1, flare: 2, view: 3, reset: 9 },
};

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return structuredClone(DEFAULTS);
}

function applyDeadzone(v, dz) {
  if (Math.abs(v) < dz) return 0;
  const s = Math.sign(v);
  return s * (Math.abs(v) - dz) / (1 - dz);
}

export class Input {
  constructor() {
    this.bindings = loadBindings();
    this.keys = new Set();
    this.gamepadIndex = null;
    this.kbThrottle = 0; // keyboard throttle is integrated over time
    this._edge = {}; // edge-detect for button/key presses
    this.onConnect = null;

    // Shared with TouchControls; absolute values written by on-screen widgets.
    this.touchState = {
      pitch: 0, roll: 0, yaw: 0,
      throttle: 0, throttleActive: false,
      view: false, reset: false, fire: false, missile: false, flare: false,
    };

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // prevent page scroll on arrows/space
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    window.addEventListener("gamepadconnected", (e) => {
      this.gamepadIndex = e.gamepad.index;
      if (this.onConnect) this.onConnect(e.gamepad);
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
      if (this.onConnect) this.onConnect(null);
    });
  }

  getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.gamepadIndex != null && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    // fall back to first connected pad
    for (const p of pads) if (p) { this.gamepadIndex = p.index; return p; }
    return null;
  }

  hasGamepad() { return !!this.getPad(); }

  saveBindings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch (_) {}
  }
  resetBindings() {
    this.bindings = structuredClone(DEFAULTS);
    this.saveBindings();
  }

  readAxis(pad, b) {
    if (!pad || b.axis == null || b.axis >= pad.axes.length) return 0;
    let v = pad.axes[b.axis] || 0;
    if (b.invert) v = -v;
    return applyDeadzone(v, b.deadzone || 0);
  }

  // Edge-triggered press (true only on the frame it goes down).
  pressed(id, isDown) {
    const was = this._edge[id] || false;
    this._edge[id] = isDown;
    return isDown && !was;
  }

  // dt seconds; integrates keyboard throttle.
  getControls(dt) {
    const pad = this.getPad();
    let pitch = 0, roll = 0, yaw = 0, throttle = 0;
    let viewPressed = false, resetPressed = false, fire = false, missilePressed = false, flarePressed = false;

    if (pad) {
      roll = this.readAxis(pad, this.bindings.roll);
      pitch = this.readAxis(pad, this.bindings.pitch);
      yaw = this.readAxis(pad, this.bindings.yaw);
      // throttle axis -1..1  ->  0..1  (idle..full)
      const t = this.bindings.throttle;
      let raw = (pad.axes[t.axis] || 0);
      if (t.invert) raw = -raw;
      throttle = (raw + 1) / 2;

      const b = this.bindings.buttons;
      const btn = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      fire = btn(b.fire);
      missilePressed = this.pressed("pad-missile", btn(b.missile));
      flarePressed = this.pressed("pad-flare", btn(b.flare));
      viewPressed = this.pressed("pad-view", btn(b.view));
      resetPressed = this.pressed("pad-reset", btn(b.reset));
    }

    // Keyboard layer (additive; lets you fly without a stick).
    const k = this.keys;
    if (k.has("KeyW")) pitch -= 1;     // nose down
    if (k.has("KeyS")) pitch += 1;     // nose up
    if (k.has("KeyA")) roll -= 1;
    if (k.has("KeyD")) roll += 1;
    if (k.has("KeyQ")) yaw -= 1;
    if (k.has("KeyE")) yaw += 1;
    if (k.has("ArrowUp")) pitch -= 1;
    if (k.has("ArrowDown")) pitch += 1;
    if (k.has("ArrowLeft")) roll -= 1;
    if (k.has("ArrowRight")) roll += 1;

    // Keyboard throttle ramps while held.
    if (!pad) {
      if (k.has("ShiftLeft") || k.has("ShiftRight")) this.kbThrottle += dt * 0.6;
      if (k.has("ControlLeft") || k.has("ControlRight")) this.kbThrottle -= dt * 0.6;
      this.kbThrottle = Math.min(1, Math.max(0, this.kbThrottle));
      throttle = this.kbThrottle;
    }

    if (this.pressed("key-view", k.has("KeyC"))) viewPressed = true;
    if (this.pressed("key-reset", k.has("KeyR"))) resetPressed = true;
    if (this.pressed("key-missile", k.has("KeyB"))) missilePressed = true;
    if (this.pressed("key-flare", k.has("KeyX"))) flarePressed = true;
    if (k.has("Space")) fire = true;

    // Touch layer (on-screen controls). Stick/rudder are additive; the
    // throttle lever is absolute and overrides keyboard when there's no pad.
    const ts = this.touchState;
    pitch += ts.pitch; roll += ts.roll; yaw += ts.yaw;
    if (ts.throttleActive && !pad) { this.kbThrottle = ts.throttle; throttle = ts.throttle; }
    if (ts.fire) fire = true;
    if (this.pressed("touch-view", ts.view)) viewPressed = true;
    if (this.pressed("touch-reset", ts.reset)) resetPressed = true;
    if (this.pressed("touch-missile", ts.missile)) missilePressed = true;
    if (this.pressed("touch-flare", ts.flare)) flarePressed = true;

    return {
      pitch: clamp(pitch), roll: clamp(roll), yaw: clamp(yaw),
      throttle: Math.min(1, Math.max(0, throttle)),
      viewPressed, resetPressed, fire, missilePressed, flarePressed,
    };
  }
}

function clamp(v) { return Math.max(-1, Math.min(1, v)); }
