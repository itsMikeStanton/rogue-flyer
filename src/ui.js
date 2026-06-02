// Menu, jet selection, and the joystick remap / live-monitor panel.

import { AIRCRAFT } from "./aircraft.js";

export class UI {
  constructor(input, callbacks, touch, tilt) {
    this.input = input;
    this.cb = callbacks; // { onFly(type), onResume() }
    this.touch = touch;
    this.tilt = tilt;
    this.selected = "f16";
    this.mode = "dogfight";

    this.menu = document.getElementById("menu");
    this.settings = document.getElementById("settings");
    this.banner = document.getElementById("banner");

    this.buildModeList();
    this.buildJetList();
    this.bindButtons();
    this.buildBindingControls();
    this.wireMobile();
    this.updateGamepadStatus();

    this.input.onConnect = () => this.updateGamepadStatus();
  }

  wireMobile() {
    if (!this.touch || !this.tilt) return;
    const mode = document.getElementById("touch-mode");
    mode.value = this.touch.mode;
    mode.addEventListener("change", () => this.touch.setMode(mode.value));

    const enable = document.getElementById("tilt-enable");
    const invP = document.getElementById("tilt-inv-pitch");
    const invR = document.getElementById("tilt-inv-roll");
    const recenter = document.getElementById("tilt-recenter");
    const status = document.getElementById("tilt-status");

    invP.checked = this.tilt.invertPitch;
    invR.checked = this.tilt.invertRoll;

    if (!this.tilt.supported()) {
      enable.disabled = true;
      status.textContent = "Tilt sensors not available on this device.";
    }

    enable.addEventListener("change", async () => {
      if (enable.checked) {
        const ok = await this.tilt.enable();
        if (!ok) {
          enable.checked = false;
          status.textContent = "Motion access denied — enable it in your browser settings.";
          return;
        }
        this.touch.showStick(false);
        this.touch.showRecenter(true);
        status.textContent = "Tilt active. Hold the device how you'll fly, then tap Recenter.";
      } else {
        this.tilt.disable();
        this.touch.showStick(true);
        this.touch.showRecenter(false);
        status.textContent = "";
      }
    });

    invP.addEventListener("change", () => { this.tilt.invertPitch = invP.checked; this.tilt.save(); });
    invR.addEventListener("change", () => { this.tilt.invertRoll = invR.checked; this.tilt.save(); });
    recenter.addEventListener("click", () => this.tilt.recenter());
    // In-flight recenter button on the touch overlay.
    if (this.touch.recenterBtn) this.touch.recenterBtn.addEventListener("click", () => this.tilt.recenter());
  }

  get visible() { return !this.menu.classList.contains("hidden") || !this.settings.classList.contains("hidden"); }

  buildModeList() {
    const modes = [
      { key: "dogfight", name: "Dogfight", desc: "Enemy jets hunt you. Guns + lock-on missiles. Survive and rack up kills." },
      { key: "mission", name: "Strike Mission", desc: "Destroy every ground target. Air-to-ground guns + missiles." },
      { key: "practice", name: "Target Practice", desc: "Gun down drifting drones. No one shoots back." },
      { key: "free", name: "Free Flight", desc: "Just fly. Chase the rings, no combat." },
    ];
    const list = document.getElementById("mode-list");
    list.innerHTML = "";
    for (const m of modes) {
      const card = document.createElement("div");
      card.className = "jet-card" + (m.key === this.mode ? " selected" : "");
      card.innerHTML = `<div class="name">${m.name}</div><div class="role">${m.desc}</div>`;
      card.addEventListener("click", () => {
        this.mode = m.key;
        [...list.children].forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      list.appendChild(card);
    }
  }

  buildJetList() {
    const list = document.getElementById("jet-list");
    list.innerHTML = "";
    for (const [key, def] of Object.entries(AIRCRAFT)) {
      const card = document.createElement("div");
      card.className = "jet-card" + (key === this.selected ? " selected" : "");
      const bar = (label, v) => `<div class="stat"><span>${label}</span></div><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
      card.innerHTML = `
        <div class="name">${def.name}</div>
        <div class="role">${def.role}</div>
        ${bar("Speed", def.stats.speed)}
        ${bar("Agility", def.stats.agility)}
        ${bar("Toughness", def.stats.toughness)}`;
      card.addEventListener("click", () => {
        this.selected = key;
        [...list.children].forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      list.appendChild(card);
    }
  }

  bindButtons() {
    document.getElementById("btn-fly").addEventListener("click", () => {
      this.hideAll();
      this.cb.onFly(this.selected, this.mode);
    });
    document.getElementById("btn-settings").addEventListener("click", () => this.showSettings());
    document.getElementById("btn-settings-back").addEventListener("click", () => {
      this.settings.classList.add("hidden");
      this.menu.classList.remove("hidden");
    });
    document.getElementById("btn-settings-reset").addEventListener("click", () => {
      this.input.resetBindings();
      this.buildBindingControls();
    });
  }

  buildBindingControls() {
    const root = document.getElementById("axis-bindings");
    root.innerHTML = "";
    const axisCount = 8; // offer plenty; extra ones simply read 0
    const rows = [
      ["roll", "Roll (stick L/R)"],
      ["pitch", "Pitch (stick fwd/back)"],
      ["yaw", "Yaw / rudder"],
      ["throttle", "Throttle"],
    ];
    for (const [key, label] of rows) {
      const b = this.input.bindings[key];
      const lab = document.createElement("label");
      lab.textContent = label;
      const sel = document.createElement("select");
      for (let i = 0; i < axisCount; i++) {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = "Axis " + i;
        if (i === b.axis) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => { b.axis = +sel.value; this.input.saveBindings(); });
      const inv = document.createElement("label");
      inv.className = "inv";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = b.invert;
      cb.addEventListener("change", () => { b.invert = cb.checked; this.input.saveBindings(); });
      inv.appendChild(cb); inv.appendChild(document.createTextNode("invert"));
      root.appendChild(lab); root.appendChild(sel); root.appendChild(inv);
    }
  }

  // Called each frame while the settings panel is open.
  updateMonitors() {
    if (this.settings.classList.contains("hidden")) return;
    const pad = this.input.getPad();
    const am = document.getElementById("axis-monitor");
    const bm = document.getElementById("button-monitor");
    if (!pad) {
      am.innerHTML = '<span class="tag">Move your joystick — connect & press a button if nothing shows.</span>';
      bm.innerHTML = "";
      return;
    }
    am.innerHTML = "";
    pad.axes.forEach((v, i) => {
      const el = document.createElement("div");
      el.className = "mon-axis";
      const pos = ((v + 1) / 2) * 100;
      el.innerHTML = `<div class="lbl">Axis ${i}: ${v.toFixed(2)}</div><div class="bar"><i style="left:${pos}%"></i></div>`;
      am.appendChild(el);
    });
    bm.innerHTML = "";
    pad.buttons.forEach((btn, i) => {
      const el = document.createElement("div");
      el.className = "mon-btn" + (btn.pressed ? " on" : "");
      el.textContent = i;
      bm.appendChild(el);
    });
  }

  updateGamepadStatus() {
    const el = document.getElementById("gamepad-status");
    const pad = this.input.getPad();
    if (pad) {
      el.textContent = "Joystick: " + pad.id.slice(0, 48) + (pad.id.length > 48 ? "…" : "");
      el.parentElement.classList.add("ok");
    } else if (("ontouchstart" in window) || navigator.maxTouchPoints > 0) {
      el.textContent = "Touch controls active — on-screen stick, throttle & rudder.";
      el.parentElement.classList.add("ok");
    } else {
      el.textContent = "No joystick detected — keyboard fallback active.";
      el.parentElement.classList.remove("ok");
    }
    const dev = document.getElementById("settings-device");
    if (dev) dev.textContent = pad ? `Connected: ${pad.id}` : "No gamepad connected (you can still set bindings).";
  }

  showSettings() {
    this.menu.classList.add("hidden");
    this.settings.classList.remove("hidden");
    this.updateGamepadStatus();
  }

  showMenu() {
    this.menu.classList.remove("hidden");
    this.banner.classList.add("hidden");
  }

  hideAll() {
    this.menu.classList.add("hidden");
    this.settings.classList.add("hidden");
  }

  showBanner(title, sub) {
    this.banner.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
    this.banner.classList.remove("hidden");
  }
  hideBanner() { this.banner.classList.add("hidden"); }
}
