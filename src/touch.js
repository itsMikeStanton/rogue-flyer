// On-screen touch controls for phones / tablets.
//
// Renders a virtual control stick (roll/pitch), a sticky throttle lever, rudder
// buttons (yaw), and camera/reset/fire buttons. Writes into a shared state
// object that Input merges alongside gamepad + keyboard. Multi-touch aware via
// Pointer Events, so stick and throttle can move at the same time.
//
// Visibility is governed by a mode: "auto" (show on touch devices), "on"
// (always), or "off" (never). The stick can be hidden when tilt-steering is on.

const MODE_STORE = "rogueflyer.touchmode.v1";
const FLY_STORE = "rogueflyer.flystyle.v1";   // "drag" (swipe the screen) | "stick" (fixed joystick)
const INVP_STORE = "rogueflyer.touchinvp.v1"; // invert pitch in drag mode

// Expo response curve: softens small deflections near center so the on-screen
// stick isn't twitchy, while still reaching full authority at the edge.
// e in [0,1]; higher = gentler center. out keeps the sign of v.
function expo(v, e = 0.8) {
  const s = Math.sign(v);
  const a = Math.min(1, Math.abs(v));
  return s * (e * a * a * a + (1 - e) * a);
}

export class TouchControls {
  constructor(state) {
    this.state = state; // mutated in place; read by Input.getControls
    this.mode = localStorage.getItem(MODE_STORE) || "auto";
    // Default to "drag": touch anywhere on the main view and steer — the most
    // natural phone scheme (drag up = climb). The fixed joystick is an option.
    this.flyStyle = localStorage.getItem(FLY_STORE) || "drag";
    this.invertPitch = localStorage.getItem(INVP_STORE) === "1";
    this._stickWanted = true; // tilt code toggles this; gated by flyStyle
    this._wantVisible = false; // set true while flying
    this.root = null;
    this.build();
    this.refresh();
  }

  static isTouch() {
    return ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  }

  get enabled() {
    if (this.mode === "on") return true;
    if (this.mode === "off") return false;
    return TouchControls.isTouch();
  }

  setMode(mode) {
    this.mode = mode;
    try { localStorage.setItem(MODE_STORE, mode); } catch (_) {}
    this.refresh();
  }

  setVisible(v) { this._wantVisible = v; this.refresh(); if (!v) this._hideDragPad(); }

  refresh() {
    if (this.root) this.root.style.display = (this.enabled && this._wantVisible) ? "block" : "none";
    this._applyStick();
  }

  // The fixed joystick is shown only when the tilt code wants it AND the player
  // has chosen the "stick" fly style (drag mode hides it).
  showStick(v) { this._stickWanted = v; this._applyStick(); }
  _applyStick() { if (this.stick) this.stick.style.display = (this._stickWanted && this.flyStyle === "stick") ? "block" : "none"; }
  showRecenter(v) { if (this.recenterBtn) this.recenterBtn.style.display = v ? "block" : "none"; }

  setFlyStyle(s) {
    this.flyStyle = s;
    try { localStorage.setItem(FLY_STORE, s); } catch (_) {}
    this._applyStick();
    if (s !== "drag") { this.state.roll = 0; this.state.pitch = 0; this._hideDragPad(); }
  }
  setInvertPitch(v) { this.invertPitch = !!v; try { localStorage.setItem(INVP_STORE, v ? "1" : "0"); } catch (_) {} }
  // Reflect the current gear/flaps DOWN state on the buttons (lit = deployed).
  setGearFlaps(gear, flaps) {
    if (this.gearBtn) this.gearBtn.classList.toggle("active", !!gear);
    if (this.flapBtn) this.flapBtn.classList.toggle("active", !!flaps);
  }
  // Light the VTOL button when the nozzles are vectored down (Harrier).
  setVtol(on) { if (this.vtolBtn) this.vtolBtn.classList.toggle("active", !!on); }

  build() {
    const root = document.createElement("div");
    root.id = "touch";
    root.style.display = "none";
    root.innerHTML = `
      <div id="t-stick" class="t-pad"><div class="t-knob"></div></div>
      <button id="t-recenter" class="t-btn" style="display:none">⊕ CENTER</button>
      <div id="t-throttle" class="t-throttle">
        <div class="t-fill"></div>
        <div class="t-handle"></div>
        <span class="t-label">THR</span>
      </div>
      <div class="t-rudder">
        <button class="t-btn" data-yaw="-1">◀ RUD</button>
        <button class="t-btn" data-yaw="1">RUD ▶</button>
      </div>
      <div class="t-actions">
        <button class="t-btn" data-act="view">CAM</button>
        <button class="t-btn" data-act="gear">GEAR</button>
        <button class="t-btn" data-act="flaps">FLAPS</button>
        <button class="t-btn" data-act="vtol">VTOL</button>
        <button class="t-btn" data-act="brake">BRAKE</button>
        <button class="t-btn" data-act="pause">MENU</button>
        <button class="t-btn msl" data-act="missile">MSL</button>
        <button class="t-btn" data-act="bomb">BOMB</button>
        <button class="t-btn flare" data-act="flare">FLARE</button>
        <button class="t-btn fire" data-act="fire">FIRE</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.stick = root.querySelector("#t-stick");
    this.recenterBtn = root.querySelector("#t-recenter");
    this.gearBtn = root.querySelector('[data-act="gear"]');
    this.flapBtn = root.querySelector('[data-act="flaps"]');
    this.vtolBtn = root.querySelector('[data-act="vtol"]');

    this.bindStick(this.stick);
    this.bindThrottle(root.querySelector("#t-throttle"));
    this.bindYaw(root.querySelectorAll("[data-yaw]"));
    this.bindActions(root.querySelectorAll("[data-act]"));
    this.bindDragFly();
  }

  // "Drag to fly": touch anywhere on the main view (not on a control widget) and
  // drag — a floating stick appears at the touch point and steers roll/pitch.
  // Drag up = climb by default (the natural feel); invertible in settings.
  bindDragFly() {
    let id = null, ox = 0, oy = 0;
    const radius = () => Math.min(window.innerWidth, window.innerHeight) * 0.17;
    // Don't hijack touches that land on a button / throttle / menu / editor.
    const blocked = (t) => t && t.closest && t.closest(
      "button, .t-throttle, .t-pad, .overlay, #editor-panel, select, input, a");
    const start = (e) => {
      if (id !== null) return;
      if (this.flyStyle !== "drag" || !this.enabled || !this._wantVisible) return;
      if (blocked(e.target)) return;
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      this._showDragPad(ox, oy);
      this._dragUpdate(e.clientX, e.clientY, ox, oy, radius());
      e.preventDefault();
    };
    const move = (e) => { if (e.pointerId === id) this._dragUpdate(e.clientX, e.clientY, ox, oy, radius()); };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.state.roll = 0; this.state.pitch = 0; this._hideDragPad();
    };
    window.addEventListener("pointerdown", start, { passive: false });
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  _dragUpdate(x, y, ox, oy, max) {
    let dx = x - ox, dy = y - oy;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    if (len < 6) { dx = 0; dy = 0; }
    this.state.roll = expo(dx / max);
    // Drag up (dy<0) => nose up / climb. (The fixed stick uses the opposite,
    // realistic, pull-back-to-climb mapping.)
    const p = expo(dy / max);
    this.state.pitch = this.invertPitch ? p : -p;
    if (this._dragKnob) this._dragKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _showDragPad(x, y) {
    if (!this._dragPad) {
      const pad = document.createElement("div");
      pad.className = "t-dragpad";
      const knob = document.createElement("div");
      knob.className = "t-knob";
      pad.appendChild(knob);
      this.root.appendChild(pad);
      this._dragPad = pad; this._dragKnob = knob;
    }
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.17;
    this._dragPad.style.width = this._dragPad.style.height = (r * 2) + "px";
    this._dragPad.style.left = (x - r) + "px";
    this._dragPad.style.top = (y - r) + "px";
    this._dragPad.style.display = "block";
    if (this._dragKnob) this._dragKnob.style.transform = "translate(0,0)";
  }
  _hideDragPad() { if (this._dragPad) this._dragPad.style.display = "none"; }

  bindStick(pad) {
    const knob = pad.querySelector(".t-knob");
    let pointerId = null;
    const radius = () => pad.clientWidth / 2;

    const update = (e) => {
      const r = pad.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const max = radius();
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      // small center deadzone so a resting thumb doesn't drift
      if (len < 8) { dx = 0; dy = 0; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // roll = right is +, pitch = stick forward (up) is nose-down (−).
      // Expo curve keeps fine control near center; full deflection at the edge.
      this.state.roll = expo(dx / max);
      this.state.pitch = expo(dy / max);
    };
    const reset = () => {
      knob.style.transform = "translate(0,0)";
      this.state.roll = 0;
      this.state.pitch = 0;
      pointerId = null;
    };

    pad.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      update(e);
      e.preventDefault();
    });
    pad.addEventListener("pointermove", (e) => {
      if (e.pointerId === pointerId) update(e);
    });
    const end = (e) => { if (e.pointerId === pointerId) reset(); };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
  }

  bindThrottle(track) {
    const handle = track.querySelector(".t-handle");
    const fill = track.querySelector(".t-fill");
    let pointerId = null;

    const setFromY = (clientY) => {
      const r = track.getBoundingClientRect();
      let t = 1 - (clientY - r.top) / r.height;
      t = Math.max(0, Math.min(1, t));
      this.state.throttle = t;
      this.state.throttleActive = true;
      handle.style.bottom = `calc(${t * 100}% - 14px)`;
      fill.style.height = `${t * 100}%`;
    };

    track.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      track.setPointerCapture(e.pointerId);
      setFromY(e.clientY);
      e.preventDefault();
    });
    track.addEventListener("pointermove", (e) => {
      if (e.pointerId === pointerId) setFromY(e.clientY);
    });
    const end = (e) => { if (e.pointerId === pointerId) pointerId = null; };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
  }

  bindYaw(btns) {
    btns.forEach((b) => {
      const val = +b.dataset.yaw;
      const press = (e) => { this.state.yaw = val; b.classList.add("on"); e.preventDefault(); };
      const release = () => { this.state.yaw = 0; b.classList.remove("on"); };
      b.addEventListener("pointerdown", press);
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
      b.addEventListener("pointerleave", release);
    });
  }

  bindActions(btns) {
    btns.forEach((b) => {
      const act = b.dataset.act;
      const press = (e) => { this.state[act] = true; b.classList.add("on"); e.preventDefault(); };
      const release = () => {
        // momentary actions clear; Input edge-detects view/reset
        if (act === "fire") this.state.fire = false;
        else this.state[act] = false;
        b.classList.remove("on");
      };
      b.addEventListener("pointerdown", press);
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
      b.addEventListener("pointerleave", release);
    });
  }
}
