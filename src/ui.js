// Menu, jet selection, and the joystick remap / live-monitor panel.

import { AIRCRAFT, LIVERIES } from "./aircraft.js";
import { INSIGNIA, insigniaDataURL } from "./markings.js";

export class UI {
  constructor(input, callbacks, touch, tilt) {
    this.input = input;
    this.cb = callbacks; // { onFly(type), onResume() }
    this.touch = touch;
    this.tilt = tilt;
    this.selected = "f16";
    this.mode = "free";
    this.startPos = "air";

    this.menu = document.getElementById("menu");
    this.settings = document.getElementById("settings");
    this.banner = document.getElementById("banner");
    this.pickerMode = document.getElementById("picker-mode");
    this.pickerJet = document.getElementById("picker-jet");
    this.hangar = document.getElementById("hangar");
    this.pause = document.getElementById("pause");
    this.hangarPick = "f16"; // current highlight inside the in-game vehicle bay

    this.buildModeList();
    this.buildJetList();
    this.buildHangarList();
    this.buildLiveryStrip();
    this.buildMarkingsStrip();
    this.bindButtons();
    this.buildBindingControls();
    this.wireMobile();
    this.updateGamepadStatus();
    this.updateSummaries();

    this.input.onConnect = () => this.updateGamepadStatus();

    const ctype = document.getElementById("controller-type");
    if (ctype) {
      ctype.value = this.input.controllerType;
      ctype.addEventListener("change", () => this.input.setControllerType(ctype.value));
    }
  }

  wireMobile() {
    if (!this.touch || !this.tilt) return;
    const mode = document.getElementById("touch-mode");
    mode.value = this.touch.mode;
    mode.addEventListener("change", () => this.touch.setMode(mode.value));

    const fly = document.getElementById("fly-style");
    if (fly) { fly.value = this.touch.flyStyle; fly.addEventListener("change", () => this.touch.setFlyStyle(fly.value)); }
    const tinvP = document.getElementById("touch-inv-pitch");
    if (tinvP) { tinvP.checked = this.touch.invertPitch; tinvP.addEventListener("change", () => this.touch.setInvertPitch(tinvP.checked)); }

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
    this.modesData = [
      { key: "dogfight", name: "Dogfight", desc: "Enemy jets hunt you. Guns + lock-on missiles. Survive and rack up kills." },
      { key: "mission", name: "Strike Mission", desc: "Destroy every ground target. Air-to-ground guns + missiles." },
      { key: "practice", name: "Target Practice", desc: "Gun down drifting drones. No one shoots back." },
      { key: "free", name: "Free Flight", desc: "Just fly. Chase the rings, no combat." },
      { key: "ffa", name: "Multiplayer FFA", desc: "LAN free-for-all. Connects to the local server; see and fight other pilots." },
    ];
    const list = document.getElementById("mode-list");
    list.innerHTML = "";
    for (const m of this.modesData) {
      const card = document.createElement("div");
      card.className = "jet-card" + (m.key === this.mode ? " selected" : "");
      card.innerHTML = `<div class="name">${m.name}</div><div class="role">${m.desc}</div>`;
      card.addEventListener("click", () => {
        this.mode = m.key;
        [...list.children].forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        this.updateSummaries();
        this.closePickers();
      });
      list.appendChild(card);
    }
  }

  buildJetList() {
    const list = document.getElementById("jet-list");
    if (!list) return; // aircraft is now chosen in the in-game Vehicle Bay
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
        if (this.cb.onSelectJet) this.cb.onSelectJet(key); // swap the hero model
        this.updateSummaries();
        this.closePickers();
      });
      list.appendChild(card);
    }
  }

  // The in-game vehicle bay: a horizontal chip list along the bottom. Selecting
  // one live-previews it (rotating 3D model); the SPAWN button commits.
  buildHangarList() {
    const list = document.getElementById("hangar-list");
    if (!list) return;
    list.innerHTML = "";
    for (const [key, def] of Object.entries(AIRCRAFT)) {
      const lo = def.loadout || {};
      const mini = lo.bombs ? "BOMBER" : lo.rockets ? "ROCKETS" : lo.missiles ? "MISSILES" : "GUNS";
      const chip = document.createElement("div");
      chip.className = "hb-chip";
      chip.dataset.key = key;
      chip.innerHTML = `<div class="nm">${def.name}</div><div class="rl">${def.role}</div><div class="mini">${mini}</div>`;
      chip.addEventListener("click", () => this._selectHangar(key));
      list.appendChild(chip);
    }
  }

  _selectHangar(key) {
    this.hangarPick = key;
    const list = document.getElementById("hangar-list");
    if (list) [...list.children].forEach((c) => c.classList.toggle("selected", c.dataset.key === key));
    this.updateHangarStats(key);
    this.refreshLiverySwatches(); // Factory swatch follows the selected airframe's colour
    this.refreshMarkings();
    if (this.cb.onPreviewVehicle) this.cb.onPreviewVehicle(key); // swap the rotating preview
  }

  // Paint-scheme picker: a strip of two-tone swatches under the actions. Clicking
  // one repaints the previewed vehicle (and persists via main.js).
  buildLiveryStrip() {
    const strip = document.getElementById("hangar-livery");
    if (!strip) return;
    strip.innerHTML = `<span class="hbl-label">PAINT</span>`;
    for (const lv of LIVERIES) {
      const sw = document.createElement("button");
      sw.className = "hbl-sw";
      sw.dataset.id = lv.id;
      sw.title = `${lv.name} — ${lv.kind}`;
      if (lv.bare) sw.classList.add("bare");
      sw.innerHTML = `<i class="hbl-body"></i><i class="hbl-accent"></i>`;
      sw.addEventListener("click", () => this._selectLivery(lv.id));
      strip.appendChild(sw);
    }
    this.refreshLiverySwatches();
  }

  // Colour each swatch; the Factory swatch mirrors the current airframe's hue.
  refreshLiverySwatches() {
    const strip = document.getElementById("hangar-livery");
    if (!strip) return;
    const cur = this.cb.liveryId ? this.cb.liveryId() : "factory";
    const hex = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6);
    const acDef = AIRCRAFT[this.hangarPick] || AIRCRAFT.f16;
    for (const sw of strip.querySelectorAll(".hbl-sw")) {
      const lv = LIVERIES.find((l) => l.id === sw.dataset.id);
      if (!lv) continue;
      const body = lv.body != null ? lv.body : acDef.color;
      const panel = lv.panel != null ? lv.panel : 0x3a4048;
      const bg = sw.querySelector(".hbl-body");
      if (lv.pattern) {
        // Hint the camo with overlapping colour blobs from the 3-tone palette.
        const a = hex(body), b = hex(panel), c = hex(lv.accent);
        bg.style.background =
          `radial-gradient(circle at 25% 30%, ${b} 0 26%, transparent 27%),` +
          `radial-gradient(circle at 75% 65%, ${c} 0 24%, transparent 25%),` +
          `radial-gradient(circle at 60% 20%, ${c} 0 16%, transparent 17%), ${a}`;
      } else {
        bg.style.background = `linear-gradient(135deg, ${hex(body)} 0 60%, ${hex(panel)} 60% 100%)`;
      }
      sw.querySelector(".hbl-accent").style.background = hex(lv.accent);
      sw.classList.toggle("selected", lv.id === cur);
    }
  }

  _selectLivery(id) {
    if (this.cb.onPreviewLivery) this.cb.onPreviewLivery(id);
    this.refreshLiverySwatches();
  }

  // Markings picker: national/squadron insignia swatches + a tail-number stepper.
  buildMarkingsStrip() {
    const strip = document.getElementById("hangar-markings");
    if (!strip) return;
    strip.innerHTML = `<span class="hbl-label">INSIGNIA</span>`;
    for (const ins of INSIGNIA) {
      const sw = document.createElement("button");
      sw.className = "hbl-sw ins";
      sw.dataset.id = ins.id;
      sw.title = ins.id === "none" ? "No insignia" : `${ins.name} — ${ins.kind}`;
      const url = insigniaDataURL(ins.id);
      sw.innerHTML = url ? `<img src="${url}" alt="${ins.name}" />` : `<span class="ins-x">∅</span>`;
      sw.addEventListener("click", () => this._selectInsignia(ins.id));
      strip.appendChild(sw);
    }
    // Tail-number stepper.
    const num = document.createElement("span");
    num.className = "hbm-num-group";
    num.innerHTML =
      `<span class="hbl-label">CODE</span>` +
      `<button class="hbm-step" data-d="-1">–</button>` +
      `<span class="hbm-num" id="hangar-num">—</span>` +
      `<button class="hbm-step" data-d="1">+</button>`;
    strip.appendChild(num);
    num.querySelectorAll(".hbm-step").forEach((b) =>
      b.addEventListener("click", () => this._stepNumber(parseInt(b.dataset.d, 10))));
    this.refreshMarkings();
  }

  refreshMarkings() {
    const strip = document.getElementById("hangar-markings");
    if (!strip) return;
    const cur = this.cb.insigniaId ? this.cb.insigniaId() : "none";
    for (const sw of strip.querySelectorAll(".hbl-sw")) sw.classList.toggle("selected", sw.dataset.id === cur);
    const n = this.cb.tailNumber ? this.cb.tailNumber() : -1;
    const el = document.getElementById("hangar-num");
    if (el) el.textContent = n < 0 ? "—" : (n < 10 ? "0" + n : "" + n);
  }

  _selectInsignia(id) {
    if (this.cb.onPreviewInsignia) this.cb.onPreviewInsignia(id);
    this.refreshMarkings();
  }
  _stepNumber(d) {
    let n = (this.cb.tailNumber ? this.cb.tailNumber() : -1) + d;
    if (n < -1) n = 99; else if (n > 99) n = -1; // wrap through "off"
    if (this.cb.onPreviewNumber) this.cb.onPreviewNumber(n);
    this.refreshMarkings();
  }

  updateHangarStats(key) {
    const info = document.getElementById("hangar-info");
    const wep = document.getElementById("hangar-weapons");
    const def = AIRCRAFT[key];
    if (!def) return;

    const bar = (label, v) => `<div class="stat">${label}<span>${Math.round(v * 100)}</span></div><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const spec = (l, v) => `<div class="spec"><span class="sl">${l}</span><span class="sv">${v}</span></div>`;
    const DEG = 180 / Math.PI;
    const g = 9.81;
    const isHeli = !!def.rotor;
    const cls = isHeli ? "Rotorcraft" : def.vtol ? "VTOL jet" : (def.loadout && def.loadout.bombs >= 12) ? "Heavy bomber" : "Fixed-wing jet";

    // --- LEFT: airframe / performance ---
    const rows = [];
    rows.push(spec("Class", cls));
    rows.push(spec("Empty mass", `${(def.mass / 1000).toFixed(1)} t`));
    if (isHeli) {
      rows.push(spec("Rotor T/W", `${def.twr.toFixed(2)}`));
      rows.push(spec("Top-speed drag", `${def.drag}`));
    } else if (def.maxThrust > 0) {
      const twr = def.maxThrust / (def.mass * g);
      rows.push(spec("Max thrust", `${(def.maxThrust / 1000).toFixed(0)} kN`));
      rows.push(spec("Thrust / weight", `${twr.toFixed(2)}`));
      if (def.wingArea > 0) {
        rows.push(spec("Wing area", `${def.wingArea} m²`));
        rows.push(spec("Wing loading", `${Math.round(def.mass / def.wingArea)} kg/m²`));
      }
      if (def.stallAngle) rows.push(spec("Stall AoA", `${(def.stallAngle * DEG).toFixed(0)}°`));
      if (def.clMax) rows.push(spec("Max lift Cl", `${def.clMax.toFixed(2)}`));
    }
    const roll = (def.rollRate || def.maxRoll || 0) * DEG;
    const pitch = (def.pitchRate || def.maxPitch || 0) * DEG;
    const yaw = (def.yawRate || 0) * DEG;

    if (info) info.innerHTML = `
      <div class="hb-name">${def.name}</div>
      <div class="hb-role">${def.role}</div>
      ${bar("Speed", def.stats.speed)}
      ${bar("Agility", def.stats.agility)}
      ${bar("Toughness", def.stats.toughness)}
      <div class="hb-sub">Specifications</div>
      ${rows.join("")}
      <div class="hb-sub">Control rates</div>
      ${spec("Roll rate", `${roll.toFixed(0)} °/s`)}
      ${spec("Pitch rate", `${pitch.toFixed(0)} °/s`)}
      ${spec("Yaw rate", `${yaw.toFixed(0)} °/s`)}`;

    // --- RIGHT: armament ---
    const lo = def.loadout || {};
    const wpn = (name, count, dmg, desc, on = true) =>
      `<div class="wpn${on ? "" : " off"}"><div class="whead"><span class="wn">${name}</span><span class="wc">${count}</span></div>` +
      `<div class="wd">${dmg}${desc ? " · " + desc : ""}</div></div>`;
    const arms = [];
    arms.push(wpn("Cannon", "∞", "12 dmg/hit", "1400 m/s rounds, lead the target"));
    arms.push(wpn("Heat missiles", lo.missiles ? `×${lo.missiles}` : "—", "120 dmg", "IR-guided, locks ahead", !!lo.missiles));
    arms.push(wpn("Rockets", lo.rockets ? `×${lo.rockets}` : "—", "45 dmg", "Unguided, fly straight", !!lo.rockets));
    arms.push(wpn("Bombs", lo.bombs ? `×${lo.bombs}` : "—", "240 dmg", "120 m blast, ballistic drop", !!lo.bombs));
    const total = (lo.missiles || 0) + (lo.rockets || 0) + (lo.bombs || 0);
    if (wep) wep.innerHTML = `
      <div class="hb-name" style="font-size:18px">Armament</div>
      <div class="hb-role">${total} stores + cannon</div>
      <div class="hb-sub">Loadout</div>
      ${arms.join("")}`;
  }

  showHangar(current, canStay) {
    this.hangarPick = current || this.hangarPick;
    const list = document.getElementById("hangar-list");
    if (list) {
      [...list.children].forEach((c) => c.classList.toggle("selected", c.dataset.key === this.hangarPick));
      const sel = list.querySelector(`[data-key="${this.hangarPick}"]`);
      if (sel) sel.scrollIntoView({ inline: "center", block: "nearest" });
    }
    this.updateHangarStats(this.hangarPick);
    this.refreshLiverySwatches();
    this.refreshMarkings();
    const stay = document.getElementById("hangar-stay");
    if (stay) stay.classList.toggle("hidden", !canStay);
    this.hangar.classList.remove("hidden");
  }
  hideHangar() { if (this.hangar) this.hangar.classList.add("hidden"); }

  showPause() { if (this.pause) this.pause.classList.remove("hidden"); }
  hidePause() { if (this.pause) this.pause.classList.add("hidden"); }

  updateSummaries() {
    const m = (this.modesData || []).find((x) => x.key === this.mode);
    if (m) {
      const n = document.getElementById("sel-mode-name"); if (n) n.textContent = m.name;
      const s = document.getElementById("sel-mode-sub"); if (s) s.textContent = m.desc;
    }
    const def = AIRCRAFT[this.selected];
    if (def) {
      const n = document.getElementById("sel-jet-name"); if (n) n.textContent = def.name;
      const s = document.getElementById("sel-jet-sub"); if (s) s.textContent = def.role;
    }
  }

  closePickers() {
    if (this.pickerMode) this.pickerMode.classList.add("hidden");
    if (this.pickerJet) this.pickerJet.classList.add("hidden");
  }

  bindButtons() {
    const sp = document.getElementById("start-pos");
    if (sp) {
      sp.value = this.startPos;
      sp.addEventListener("change", () => { this.startPos = sp.value; });
    }
    document.getElementById("btn-fly").addEventListener("click", () => {
      this.hideAll();
      this.cb.onFly(this.selected, this.mode, this.startPos);
    });
    const vrBtn = document.getElementById("btn-vr");
    if (vrBtn) vrBtn.addEventListener("click", () => {
      // Don't hide the menu yet — enterVR hides it only once the session starts,
      // so a rejected request leaves you on the menu with an error banner.
      if (this.cb.onVR) this.cb.onVR(this.selected, this.mode, this.startPos);
    });
    const selMode = document.getElementById("sel-mode");
    if (selMode) selMode.addEventListener("click", () => this.pickerMode.classList.remove("hidden"));
    const selJet = document.getElementById("sel-jet");
    if (selJet) selJet.addEventListener("click", () => this.pickerJet.classList.remove("hidden"));
    const pmDone = document.getElementById("pick-mode-done");
    if (pmDone) pmDone.addEventListener("click", () => this.pickerMode.classList.add("hidden"));
    const pjDone = document.getElementById("pick-jet-done");
    if (pjDone) pjDone.addEventListener("click", () => this.pickerJet.classList.add("hidden"));
    const hSpawn = document.getElementById("hangar-spawn");
    if (hSpawn) hSpawn.addEventListener("click", () => { if (this.cb.onPickVehicle) this.cb.onPickVehicle(this.hangarPick); });
    const hStay = document.getElementById("hangar-stay");
    if (hStay) hStay.addEventListener("click", () => { if (this.cb.onHangarStay) this.cb.onHangarStay(); });
    const pResume = document.getElementById("pause-resume");
    if (pResume) pResume.addEventListener("click", () => { if (this.cb.onPauseResume) this.cb.onPauseResume(); });
    const pMenu = document.getElementById("pause-menu");
    if (pMenu) pMenu.addEventListener("click", () => { if (this.cb.onPauseMenu) this.cb.onPauseMenu(); });
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
    this.closePickers();
  }

  showBanner(title, sub) {
    this.banner.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
    this.banner.classList.remove("hidden");
  }
  hideBanner() { this.banner.classList.add("hidden"); }
}
