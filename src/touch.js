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

  setVisible(v) { this._wantVisible = v; this.refresh(); }

  refresh() {
    if (this.root) this.root.style.display = (this.enabled && this._wantVisible) ? "block" : "none";
  }

  showStick(v) { if (this.stick) this.stick.style.display = v ? "block" : "none"; }
  showRecenter(v) { if (this.recenterBtn) this.recenterBtn.style.display = v ? "block" : "none"; }

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
        <button class="t-btn" data-act="reset">RESET</button>
        <button class="t-btn msl" data-act="missile">MSL</button>
        <button class="t-btn flare" data-act="flare">FLARE</button>
        <button class="t-btn fire" data-act="fire">FIRE</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.stick = root.querySelector("#t-stick");
    this.recenterBtn = root.querySelector("#t-recenter");

    this.bindStick(this.stick);
    this.bindThrottle(root.querySelector("#t-throttle"));
    this.bindYaw(root.querySelectorAll("[data-yaw]"));
    this.bindActions(root.querySelectorAll("[data-act]"));
  }

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
