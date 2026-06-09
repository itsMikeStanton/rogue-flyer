// Input layer: HOTAS joystick (Gamepad API) + keyboard fallback.
//
// A "fancy" joystick reports as a standard gamepad with many axes & buttons:
// the stick (roll/pitch), a separate throttle axis, a twist/rudder axis, a hat
// switch, and lots of buttons. We expose a single getControls() that yields
// normalized {pitch, roll, yaw, throttle, view, reset, ...}, regardless of
// whether the input came from a stick or the keyboard.

const STORAGE_KEY = "rogueflyer.bindings.v1";
const CTRL_KEY = "rogueflyer.controllertype.v1"; // "auto" | "gamepad" | "hotas"

// Default axis bindings, tuned for a Logitech Extreme 3D Pro (a very common
// HOTAS). axis = index into gamepad.axes; invert flips sign. Throttles often
// rest at -1 (idle) .. +1 (full); throttleMode maps that range to 0..1.
const DEFAULTS = {
  roll: { axis: 0, invert: false, deadzone: 0.06 },
  pitch: { axis: 1, invert: false, deadzone: 0.06 },
  // Rudder twist is sensitive near centre — bigger deadzone ignores the first
  // several degrees, and an expo curve softens the low end (see getControls).
  yaw: { axis: 5, invert: true, deadzone: 0.16 },
  throttle: { axis: 6, invert: true, deadzone: 0.0 },
  // button indices for actions (standard mapping-ish; remappable later)
  // Every action can be bound to any joystick button (remap in Settings). High
  // defaults for the niche actions are usually out of range (unbound) until set.
  buttons: { fire: 0, missile: 1, flare: 2, view: 3, reset: 9, gear: 4, flaps: 5, brake: 6, vtol: 7, hangar: 8, bomb: 10, rocket: 11, bombsight: 16, flyby: 17, radar: 18, hud: 19, approach: 20 },
};

// Expo response curve: e in [0,1], higher = gentler near centre, full at edge.
function expo(v, e = 0.5) {
  const s = Math.sign(v), a = Math.min(1, Math.abs(v));
  return s * (e * a * a * a + (1 - e) * a);
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const merged = { ...structuredClone(DEFAULTS), ...saved };
      merged.buttons = { ...DEFAULTS.buttons, ...(saved.buttons || {}) }; // keep new action defaults
      return merged;
    }
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
    this.controllerType = localStorage.getItem(CTRL_KEY) || "auto";
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
      gear: false, flaps: false, brake: false,
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

  setControllerType(t) {
    this.controllerType = t;
    try { localStorage.setItem(CTRL_KEY, t); } catch (_) {}
  }
  // Whether to use the dual-stick gamepad scheme (vs the HOTAS axis map).
  // Auto: anything that reports the W3C "standard" mapping OR just looks like a
  // gamepad (Firefox/Linux often leaves mapping blank for the Steam Deck).
  _useGamepadScheme(pad) {
    if (this.controllerType === "gamepad") return true;
    if (this.controllerType === "hotas") return false;
    return pad.mapping === "standard" || (pad.axes.length >= 4 && pad.buttons.length >= 16);
  }

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
    let viewPressed = false, pausePressed = false, fire = false, missilePressed = false, flarePressed = false;
    let gearPressed = false, flapsPressed = false, brake = false, vtolPressed = false, hangarPressed = false, bombPressed = false, rocketPressed = false, bombsightPressed = false;
    let flybyPressed = false, radarPressed = false, hudPressed = false, approachPressed = false;
    let lookX = 0, lookY = 0; // POV hat free-look (x = right, y = up)

    if (pad) {
      const btn = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      if (this._useGamepadScheme(pad)) {
        // Steam Deck / Xbox-style gamepad. Left stick flies, right stick rudder,
        // triggers throttle, face/shoulder/d-pad for actions.
        //   L-stick: roll (X) + pitch (Y, push fwd = nose down)
        //   R-stick X: rudder      R2: throttle up   L2: throttle down
        //   RB: guns   A: missile   B: flare   X: airbrake
        //   Y: camera  LB: gear   D-pad up: flaps   Start: reset/respawn
        roll = applyDeadzone(pad.axes[0] || 0, 0.12);
        pitch = applyDeadzone(pad.axes[1] || 0, 0.12);
        yaw = expo(applyDeadzone(pad.axes[2] || 0, 0.14), 0.5);
        const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
        this.kbThrottle = Math.min(1, Math.max(0, this.kbThrottle + (val(7) - val(6)) * dt * 0.9));
        throttle = this.kbThrottle;
        fire = btn(5);                                    // RB
        missilePressed = this.pressed("gp-msl", btn(0));  // A
        flarePressed = this.pressed("gp-flr", btn(1));    // B
        if (btn(2)) brake = true;                         // X
        viewPressed = this.pressed("gp-view", btn(3));    // Y
        gearPressed = this.pressed("gp-gear", btn(4));    // LB
        flapsPressed = this.pressed("gp-flap", btn(12));  // D-pad up
        vtolPressed = this.pressed("gp-vtol", btn(13));   // D-pad down (Harrier nozzles)
        bombPressed = this.pressed("gp-bomb", btn(14));   // D-pad left (drop bomb)
        rocketPressed = this.pressed("gp-rkt", btn(15)); // D-pad right (rockets)
        bombsightPressed = this.pressed("gp-bsight", btn(10)); // L3 (bomb sight, bombers)
        flybyPressed = this.pressed("gp-flyby", btn(11));      // R3 (one-shot flyby cam)
        hangarPressed = this.pressed("gp-bay", btn(8));   // Back/Select (vehicle bay)
        pausePressed = this.pressed("gp-rst", btn(9));    // Start → pause menu
      } else {
        // HOTAS flight stick (Logitech Extreme 3D Pro-style; remappable).
        roll = this.readAxis(pad, this.bindings.roll);
        pitch = this.readAxis(pad, this.bindings.pitch);
        yaw = expo(this.readAxis(pad, this.bindings.yaw), 0.55); // soft rudder near centre
        const t = this.bindings.throttle;
        let raw = (pad.axes[t.axis] || 0);
        if (t.invert) raw = -raw;
        throttle = (raw + 1) / 2;
        const b = this.bindings.buttons;
        fire = btn(b.fire);
        missilePressed = this.pressed("pad-missile", btn(b.missile));
        flarePressed = this.pressed("pad-flare", btn(b.flare));
        viewPressed = this.pressed("pad-view", btn(b.view));
        pausePressed = this.pressed("pad-reset", btn(b.reset)); // → pause menu
        gearPressed = this.pressed("pad-gear", btn(b.gear));
        flapsPressed = this.pressed("pad-flaps", btn(b.flaps));
        vtolPressed = this.pressed("pad-vtol", btn(b.vtol));
        bombPressed = this.pressed("pad-bomb", btn(b.bomb));
        rocketPressed = this.pressed("pad-rkt", btn(b.rocket));
        bombsightPressed = this.pressed("pad-bsight", btn(b.bombsight)); // bomb sight (bombers)
        flybyPressed = this.pressed("pad-flyby", btn(b.flyby));
        radarPressed = this.pressed("pad-radar", btn(b.radar));
        hudPressed = this.pressed("pad-hud", btn(b.hud));
        approachPressed = this.pressed("pad-approach", btn(b.approach));
        hangarPressed = this.pressed("pad-bay", btn(b.hangar));
        if (btn(b.brake)) brake = true; // airbrake / wheel brake (held)
        // POV hat → free-look. Many sticks report it as a "hat" axis whose value
        // snaps to one of 8 detents (centred reads out of band); only act when
        // it's near a detent so an ordinary analog axis can't spin the view.
        if (pad.axes.length > 8) {
          const hv = pad.axes[pad.axes.length > 9 ? 9 : pad.axes.length - 1];
          const D = [-1, -0.714, -0.428, -0.142, 0.142, 0.428, 0.714, 1.0]; // up..up-left, clockwise
          let hi = -1;
          for (let i = 0; i < 8; i++) if (Math.abs(hv - D[i]) < 0.06) { hi = i; break; }
          if (hi >= 0) { lookX = Math.sin(hi * Math.PI / 4); lookY = Math.cos(hi * Math.PI / 4); }
        }
        // Some sticks report the POV as the d-pad buttons instead.
        if (btn(12)) lookY = 1; if (btn(13)) lookY = -1; if (btn(14)) lookX = -1; if (btn(15)) lookX = 1;
      }
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
    if (this.pressed("key-missile", k.has("KeyB"))) missilePressed = true;
    if (this.pressed("key-flare", k.has("KeyX"))) flarePressed = true;
    if (this.pressed("key-gear", k.has("KeyG"))) gearPressed = true;   // G = gear toggle
    if (this.pressed("key-flaps", k.has("KeyV"))) flapsPressed = true; // V = flaps toggle
    if (this.pressed("key-vtol", k.has("KeyT"))) vtolPressed = true;   // T = VTOL nozzle toggle
    if (this.pressed("key-bomb", k.has("KeyN"))) bombPressed = true;   // N = drop bomb
    if (this.pressed("key-rkt", k.has("KeyR"))) rocketPressed = true;  // R = fire rockets
    if (this.pressed("key-bsight", k.has("KeyU"))) bombsightPressed = true; // U = bomb sight toggle (bombers)
    if (this.pressed("key-flyby", k.has("KeyY"))) flybyPressed = true;       // Y = one-shot flyby cam
    if (this.pressed("key-radar", k.has("KeyK"))) radarPressed = true;       // K = toggle radar / target markers
    if (this.pressed("key-hud", k.has("KeyJ"))) hudPressed = true;           // J = toggle the whole HUD
    if (this.pressed("key-approach", k.has("KeyL"))) approachPressed = true;  // L = landing-approach guidance
    if (k.has("KeyZ")) brake = true;   // Z = airbrake / wheel brake (held)
    if (k.has("Space")) fire = true;

    // Touch layer (on-screen controls). Stick/rudder are additive; the
    // throttle lever is absolute and overrides keyboard when there's no pad.
    const ts = this.touchState;
    pitch += ts.pitch; roll += ts.roll; yaw += ts.yaw;
    if (ts.throttleActive && !pad) { this.kbThrottle = ts.throttle; throttle = ts.throttle; }
    if (ts.fire) fire = true;
    if (this.pressed("touch-view", ts.view)) viewPressed = true;
    if (this.pressed("touch-pause", ts.pause)) pausePressed = true;
    if (this.pressed("touch-missile", ts.missile)) missilePressed = true;
    if (this.pressed("touch-flare", ts.flare)) flarePressed = true;
    if (this.pressed("touch-gear", ts.gear)) gearPressed = true;
    if (this.pressed("touch-flaps", ts.flaps)) flapsPressed = true;
    if (this.pressed("touch-vtol", ts.vtol)) vtolPressed = true;
    if (this.pressed("touch-bomb", ts.bomb)) bombPressed = true;
    if (this.pressed("touch-rkt", ts.rocket)) rocketPressed = true;
    if (this.pressed("touch-bsight", ts.bombsight)) bombsightPressed = true;
    if (ts.brake) brake = true;

    return {
      pitch: clamp(pitch), roll: clamp(roll), yaw: clamp(yaw),
      throttle: Math.min(1, Math.max(0, throttle)),
      viewPressed, pausePressed, fire, missilePressed, flarePressed,
      gearPressed, flapsPressed, brake, vtolPressed, hangarPressed, bombPressed, rocketPressed, bombsightPressed,
      flybyPressed, radarPressed, hudPressed, approachPressed,
      look: { x: lookX, y: lookY },
    };
  }
}

function clamp(v) { return Math.max(-1, Math.min(1, v)); }
