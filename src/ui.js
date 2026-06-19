// Menu, jet selection, and the joystick remap / live-monitor panel.

import { AIRCRAFT, LIVERIES } from "./aircraft.js";
import { getFactionConfig } from "./world.js";
import { Factions } from "./factions.js";
import { drawEmblem } from "./factionEmblems.js";
import { drawCaptainDad, drawMapPreview, drawArchipelago } from "./portrait.js";
import * as campaign from "./campaign.js";

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
    this.pickerJet = document.getElementById("picker-jet");
    this.hangar = document.getElementById("hangar");
    this.pause = document.getElementById("pause");
    this.briefing = document.getElementById("briefing");
    this.conquest = document.getElementById("conquest");
    this._briefMission = null;
    this._briefWorld = null;
    this._cqRun = null;
    this._cqMode = "setup";
    this._cqPick = null;
    this.hangarPick = "f16"; // current highlight inside the in-game vehicle bay

    this.buildModeList();
    this.buildJetList();
    this.buildHangarList();
    this.buildLiveryStrip();
    this.buildMarkingsStrip();
    this.bindButtons();
    this.buildBindingControls();
    this.buildButtonBindings();
    this.wireMobile();
    this.updateGamepadStatus();
    this.updateSummaries();

    this.input.onConnect = () => this.updateGamepadStatus();

    const ctype = document.getElementById("controller-type");
    if (ctype) {
      ctype.value = this.input.controllerType;
      ctype.addEventListener("change", () => this.input.setControllerType(ctype.value));
    }

    // Keyboard remap: while a key slot is "listening", the next keypress binds.
    window.addEventListener("keydown", (e) => {
      if (!this._keyCapture) return;
      e.preventDefault();
      const action = this._keyCapture.action;
      this._keyCapture = null;
      this._setBinding("keys", action, e.code);
    });
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
    // `tile` is the short label on the strip; `cta` is the action-button text
    // (it tells the truth about where the button takes you); `opens` marks the
    // two modes that route to their own setup screen instead of launching.
    this.modesData = [
      { key: "campaign", name: "Campaign", tile: "Campaign", cta: "BRIEFING", opens: true, desc: "Briefed missions from Captain Dad. Escalating objectives; pick up where you left off." },
      { key: "conquest", name: "Conquest", tile: "Conquest", cta: "PLAN ASSAULT", opens: true, desc: "Take the whole archipelago. Pick a beachhead, launch from your runways, capture every island." },
      { key: "dogfight", name: "Dogfight — Waves", tile: "Dogfight", cta: "LAUNCH", desc: "Clear each wave of fighters to summon the next. They get meaner." },
      { key: "mission", name: "Strike — Objectives", tile: "Strike", cta: "LAUNCH", desc: "Hit the marked objectives. Only the active objective is highlighted." },
      { key: "practice", name: "Target Practice", tile: "Practice", cta: "LAUNCH", desc: "Gun down drifting drones. No one shoots back." },
      { key: "free", name: "Free Flight", tile: "Free Flight", cta: "LAUNCH", desc: "Just fly. Chase the rings, no combat." },
      { key: "ffa", name: "Multiplayer FFA", tile: "Multiplayer", cta: "LAUNCH", desc: "LAN free-for-all. Connects to the local server; see and fight other pilots." },
    ];
    const strip = document.getElementById("mode-strip");
    if (!strip) return;
    strip.innerHTML = "";
    for (const m of this.modesData) {
      const tile = document.createElement("button");
      tile.className = "mode-tile" + (m.key === this.mode ? " selected" : "");
      tile.dataset.key = m.key;
      tile.textContent = m.tile;
      tile.addEventListener("click", () => {
        this.mode = m.key;
        [...strip.children].forEach((c) => c.classList.toggle("selected", c.dataset.key === m.key));
        this.updateModeUI();
      });
      strip.appendChild(tile);
    }
    this.updateModeUI();
  }

  // Reflect the selected mode: blurb text, which options apply, and the
  // action button's label (so LAUNCH never lies about its destination).
  updateModeUI() {
    const m = (this.modesData || []).find((x) => x.key === this.mode) || (this.modesData || [])[0];
    if (!m) return;
    const blurb = document.getElementById("mode-blurb");
    if (blurb) blurb.textContent = m.desc;
    const startOpts = document.getElementById("start-opts");
    if (startOpts) startOpts.classList.toggle("hidden", !!m.opens);
    const fly = document.getElementById("btn-fly");
    if (fly) fly.innerHTML = (m.cta || "LAUNCH") + "&nbsp;▸";
    const vr = document.getElementById("btn-vr");
    if (vr) vr.classList.toggle("hidden", !!m.opens); // VR only for direct-fly modes
    const plan = document.getElementById("btn-plan");
    if (plan) plan.classList.toggle("hidden", !!m.opens); // PLAN (strategic map) for quick/free modes
    const cso = document.getElementById("callsign-opt");
    if (cso) cso.classList.toggle("hidden", this.mode !== "ffa"); // call sign only matters in multiplayer
    const rmo = document.getElementById("room-opt");
    if (rmo) rmo.classList.toggle("hidden", this.mode !== "ffa"); // room/lobby code, multiplayer only
    const tmo = document.getElementById("team-opt");
    if (tmo) {
      tmo.classList.toggle("hidden", this.mode !== "ffa"); // team-battle toggle, multiplayer only
      const tt = document.getElementById("team-toggle");
      if (tt && this.cb.getTeam) { tt.checked = this.cb.getTeam(); tt.onchange = () => { if (this.cb.onTeam) this.cb.onTeam(tt.checked); }; }
    }
    const lto = document.getElementById("lifetime-opt");
    if (lto) {
      lto.classList.toggle("hidden", this.mode !== "ffa"); // persisted career line, multiplayer only
      const lt = document.getElementById("lifetime-text");
      if (lt && this.mode === "ffa" && this.cb.getLifetime) lt.textContent = this.cb.getLifetime();
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

  // Insignia/decals were removed — keep these as no-ops so callers don't break.
  buildMarkingsStrip() {
    const strip = document.getElementById("hangar-markings");
    if (strip) { strip.innerHTML = ""; strip.style.display = "none"; }
  }

  refreshMarkings() {}

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
    this.updateModeUI();
    const def = AIRCRAFT[this.selected];
    if (def) {
      const n = document.getElementById("sel-jet-name"); if (n) n.textContent = def.name;
      const s = document.getElementById("sel-jet-sub"); if (s) s.textContent = def.role;
    }
  }

  closePickers() {
    if (this.pickerJet) this.pickerJet.classList.add("hidden");
  }

  bindButtons() {
    const sp = document.getElementById("start-pos");
    if (sp) {
      sp.value = this.startPos;
      sp.addEventListener("change", () => { this.startPos = sp.value; });
    }
    const lv = document.getElementById("lives-sel");
    if (lv && this.cb.onLives) {
      if (this.cb.livesMode) lv.value = this.cb.livesMode();
      lv.addEventListener("change", () => this.cb.onLives(lv.value));
    }
    document.getElementById("btn-fly").addEventListener("click", () => {
      // Campaign opens the briefing room first; Conquest opens the map screen;
      // everything else launches directly.
      if (this.mode === "campaign" && this.cb.onOpenCampaign) { this.hideAll(); this.cb.onOpenCampaign(); return; }
      if (this.mode === "conquest" && this.cb.onOpenConquest) { this.hideAll(); this.cb.onOpenConquest(); return; }
      this.hideAll();
      this.cb.onFly(this.selected, this.mode, this.startPos);
    });
    const cs = document.getElementById("callsign");
    if (cs) {
      if (this.cb.getName) cs.value = this.cb.getName();
      const apply = () => { if (this.cb.onName) this.cb.onName(cs.value); };
      cs.addEventListener("input", apply);
      cs.addEventListener("change", apply);
    }
    const rc = document.getElementById("room-code");
    if (rc) {
      if (this.cb.getRoom) rc.value = this.cb.getRoom();
      // Force the A–Z0–9 room-code shape as they type, so what they see is what joins.
      const apply = () => {
        const v = rc.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        if (rc.value !== v) rc.value = v;
        if (this.cb.onRoom) this.cb.onRoom(v);
      };
      rc.addEventListener("input", apply);
      rc.addEventListener("change", apply);
    }
    const invite = document.getElementById("btn-invite");
    if (invite) invite.addEventListener("click", async () => {
      // "Invite" means a PRIVATE game with your friends, not the public brawl —
      // so if the room is blank, mint a code so the link is actually yours.
      let code = (rc && rc.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (!code) {
        const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused 0/O/1/I
        code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
        if (rc) rc.value = code;
        if (this.cb.onRoom) this.cb.onRoom(code);
      }
      const url = new URL(location.href);
      url.searchParams.set("room", code);
      const link = url.toString();
      let ok = false;
      try { await navigator.clipboard.writeText(link); ok = true; }
      catch (_) { try { prompt("Share this link to invite friends:", link); ok = true; } catch (__) { /* ignore */ } }
      const label = invite.innerHTML;
      invite.innerHTML = ok ? "✓&nbsp;Copied " + code : "Copy&nbsp;failed";
      invite.classList.add("ok");
      setTimeout(() => { invite.innerHTML = label; invite.classList.remove("ok"); }, 1800);
    });
    const planBtn = document.getElementById("btn-plan");
    if (planBtn) planBtn.addEventListener("click", () => {
      if (this.mode === "campaign" || this.mode === "conquest") return; // those have their own flow
      this.hideAll();
      if (this.cb.onPlan) this.cb.onPlan(this.selected, this.mode);
    });
    const cqLaunch = document.getElementById("cq-launch");
    if (cqLaunch) cqLaunch.addEventListener("click", () => {
      if (!this._cqPick) return;
      if (this._cqMode === "setup") {
        const lv = document.getElementById("cq-lives");
        const df = document.getElementById("cq-diff");
        if (this.cb.onConquestLaunch) this.cb.onConquestLaunch(this._cqPick, lv ? lv.value : "infinite", df ? df.value : "veteran");
      } else if (this._cqMode === "resume") {
        if (this.cb.onConquestResume) this.cb.onConquestResume(this._cqPick);
      } else {
        if (this.cb.onConquestRespawn) this.cb.onConquestRespawn(this._cqPick);
      }
      this.hideConquest();
    });
    const cqBack = document.getElementById("cq-back");
    if (cqBack) cqBack.addEventListener("click", () => { this.hideConquest(); this.showMenu(); });
    const bl = document.getElementById("brief-launch");
    if (bl) bl.addEventListener("click", () => {
      const lv = document.getElementById("brief-lives");
      if (lv && this.cb.onLives) this.cb.onLives(lv.value);
      this.hideBriefing();
      if (this.cb.onBriefingLaunch && this._briefMission) this.cb.onBriefingLaunch(this._briefMission.id, this.selected);
    });
    const bb = document.getElementById("brief-back");
    if (bb) bb.addEventListener("click", () => { this.hideBriefing(); this.showMenu(); });
    const vrBtn = document.getElementById("btn-vr");
    if (vrBtn) vrBtn.addEventListener("click", () => {
      // Don't hide the menu yet — enterVR hides it only once the session starts,
      // so a rejected request leaves you on the menu with an error banner.
      if (this.cb.onVR) this.cb.onVR(this.selected, this.mode, this.startPos);
    });
    const selJet = document.getElementById("sel-jet");
    if (selJet) selJet.addEventListener("click", () => this.pickerJet.classList.remove("hidden"));
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
      this.buildButtonBindings();
    });
    const facPanel = document.getElementById("factions");
    const facBtn = document.getElementById("btn-factions");
    if (facBtn && facPanel) {
      facBtn.addEventListener("click", () => { this.populateFactions(); this.menu.classList.add("hidden"); facPanel.classList.remove("hidden"); });
      const facBack = document.getElementById("fac-back");
      if (facBack) facBack.addEventListener("click", () => { facPanel.classList.add("hidden"); this.menu.classList.remove("hidden"); });
    }
  }

  // Build the faction dossier: a card per faction (emblem + lore + holdings) and
  // a directional standings matrix. Reads the live faction registry, so editing
  // the world's factions is reflected here.
  populateFactions() {
    const cfg = getFactionConfig();
    const F = new Factions(cfg);
    const ids = Object.keys(cfg.factions);
    const css = (n) => "#" + ((typeof n === "number" ? n : 0xcbd5e0) & 0xffffff).toString(16).padStart(6, "0");
    // Current holdings (island names per faction) come from the game via callback.
    const holdings = (this.cb && this.cb.factionHoldings) ? this.cb.factionHoldings() : {};

    const grid = document.getElementById("fac-grid");
    if (grid) {
      grid.innerHTML = "";
      for (const id of ids) {
        const f = cfg.factions[id], col = css(f.color);
        const card = document.createElement("div");
        card.className = "fac-card";
        const cv = document.createElement("canvas"); cv.width = cv.height = 132; cv.className = "fac-emblem";
        drawEmblem(cv.getContext("2d"), f.emblem, 66, 66, 64, f.color);
        const you = id === F.playerFaction ? ` <span class="fac-you">YOU</span>` : "";
        const terr = (holdings[id] || []).join(" · ") || "no territory";
        const info = document.createElement("div");
        info.className = "fac-info";
        info.innerHTML = `<h4 style="color:${col}">${f.name || id}${you}</h4>
          <p class="fac-blurb">${f.blurb || ""}</p>
          <span class="fac-terr" style="color:${col}">${terr}</span>`;
        card.append(cv, info);
        grid.append(card);
      }
    }

    const t = document.getElementById("fac-matrix");
    if (t) {
      const head = `<tr><th></th>${ids.map((id) => `<th style="color:${css(cfg.factions[id].color)}">${(cfg.factions[id].name || id).split(" ")[0]}</th>`).join("")}</tr>`;
      const rows = ids.map((a) => {
        const cells = ids.map((b) => {
          if (a === b) return `<td class="fac-self">—</td>`;
          const s = F.stance(a, b);
          return `<td class="fac-s-${s}">${s}</td>`;
        }).join("");
        return `<tr><th class="fac-rowh" style="color:${css(cfg.factions[a].color)}">${cfg.factions[a].name || a}</th>${cells}</tr>`;
      }).join("");
      t.innerHTML = head + rows;
    }
  }

  // The full digital-action list, grouped so the table reads as "flight controls
  // (joystick home)" then "system / camera (keyboard home)". Each action can be
  // bound to a keyboard key AND/OR a joystick button, or turned Off on either.
  get ACTIONS() {
    return [
      ["fire", "Fire cannon"], ["missile", "Missile"], ["rocket", "Rockets"], ["bomb", "Drop bomb"],
      ["flare", "Flares"], ["gear", "Gear"], ["flaps", "Flaps"], ["brake", "Airbrake"],
      ["vtol", "VTOL nozzles"], ["boost", "Afterburner"],
      ["view", "Camera"], ["flyby", "Flyby cam"], ["bombsight", "Bomb sight"], ["approach", "Approach mode"],
      ["radar", "Radar / markers"], ["hud", "HUD on/off"], ["hangar", "Vehicle bay"], ["reset", "Pause menu"],
    ];
  }
  _actionLabel(a) { const f = this.ACTIONS.find((x) => x[0] === a); return f ? f[1] : a; }

  // Pretty name for a KeyboardEvent.code.
  _keyName(code) {
    if (code == null) return "Off";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    const map = {
      Space: "Space", Escape: "Esc", Enter: "Enter", Tab: "Tab", Backspace: "Bksp",
      ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
      AltLeft: "L-Alt", AltRight: "R-Alt", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      Backquote: "`", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/",
      Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    };
    return map[code] || code;
  }

  // Build the dual-device action map: a 3-column grid (action | keyboard | joystick).
  buildActionBindings() {
    const root = document.getElementById("button-bindings");
    if (!root) return;
    root.innerHTML = "";
    const head = (t) => { const s = document.createElement("span"); s.className = "bb-head"; s.textContent = t; return s; };
    root.appendChild(head("Action")); root.appendChild(head("Keyboard")); root.appendChild(head("Joystick"));
    for (const [action, label] of this.ACTIONS) {
      const lab = document.createElement("span"); lab.className = "bb-label"; lab.textContent = label;
      root.appendChild(lab);
      root.appendChild(this._bindCell("keys", action));
      root.appendChild(this._bindCell("buttons", action));
    }
  }
  // backwards-compat alias (older call sites)
  buildButtonBindings() { this.buildActionBindings(); }

  _bindCell(device, action) {
    const cell = document.createElement("div"); cell.className = "bb-cell";
    const val = this.input.bindings[device][action];
    const slot = document.createElement("button");
    slot.className = "bind-slot" + (val == null ? " off" : "");
    slot.textContent = val == null ? "Off" : (device === "keys" ? this._keyName(val) : "Btn " + val);
    slot.addEventListener("click", () => device === "keys" ? this._captureKey(action, slot) : this._captureButton(action, slot));
    const clr = document.createElement("button"); clr.className = "bind-clr"; clr.textContent = "✕"; clr.title = "Turn off (unmap)";
    clr.addEventListener("click", () => this._setBinding(device, action, null));
    cell.appendChild(slot); cell.appendChild(clr);
    return cell;
  }

  // Assign (or clear) a binding. When assigning an input already used by another
  // action on the same device, confirm and steal it (unmapping the other).
  _setBinding(device, action, value) {
    const map = this.input.bindings[device];
    if (value != null) {
      const taken = Object.keys(map).find((a) => a !== action && map[a] === value);
      if (taken) {
        const name = device === "keys" ? this._keyName(value) : "Button " + value;
        if (!window.confirm(`${name} is already mapped to "${this._actionLabel(taken)}".\nUnmap it and use it for "${this._actionLabel(action)}"?`)) {
          this.buildActionBindings();
          return false;
        }
        map[taken] = null; // steal it
      }
    }
    map[action] = value;
    this.input.saveBindings();
    this.buildActionBindings();
    return true;
  }

  _cancelCaptures() {
    if (this._capture && this._capture.btnEl) this._capture.btnEl.classList.remove("listening");
    if (this._keyCapture && this._keyCapture.slotEl) this._keyCapture.slotEl.classList.remove("listening");
    this._capture = null; this._keyCapture = null;
  }
  _captureKey(action, slotEl) {
    const was = this._keyCapture && this._keyCapture.action === action;
    this._cancelCaptures();
    if (was) { this.buildActionBindings(); return; } // toggle off
    this._keyCapture = { action, slotEl };
    slotEl.textContent = "Press a key…"; slotEl.classList.add("listening");
  }
  _captureButton(action, slotEl) {
    const was = this._capture && this._capture.key === action;
    this._cancelCaptures();
    if (was) { this.buildActionBindings(); return; } // toggle off
    const pad = this.input.getPad();
    const prev = new Set();
    if (pad) pad.buttons.forEach((bn, i) => { if (bn.pressed) prev.add(i); });
    this._capture = { key: action, prev, btnEl: slotEl };
    slotEl.textContent = "Press a button…"; slotEl.classList.add("listening");
  }

  // Poll for the captured joystick button each frame (called from updateMonitors).
  _pollCapture() {
    if (!this._capture) return;
    const pad = this.input.getPad();
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length; i++) {
      const down = pad.buttons[i].pressed;
      if (down && !this._capture.prev.has(i)) {
        const action = this._capture.key;
        this._capture = null;
        this._setBinding("buttons", action, i);
        return;
      }
      if (!down) this._capture.prev.delete(i); // a held-at-start button only counts once re-pressed
    }
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
    this._pollCapture(); // listen for a button to bind, if capturing
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
    this._cancelCaptures();
    this.buildActionBindings(); // reflect current bindings + clear any stale capture
    this.updateGamepadStatus();
  }

  showMenu() {
    this.menu.classList.remove("hidden");
    this.banner.classList.add("hidden");
    this.updateModeUI();
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

  // --- Mission briefing room (Campaign) ---
  showBriefing(mission, progress, world) {
    if (!this.briefing) return;
    this._briefMission = mission;
    this._briefProgress = progress;
    this._briefWorld = world;
    this.menu.classList.add("hidden");
    this.briefing.classList.remove("hidden");
    this._buildBriefing();
  }
  hideBriefing() { if (this.briefing) this.briefing.classList.add("hidden"); }

  _buildBriefing() {
    const m = this._briefMission;
    if (!m) return;
    const el = (id) => document.getElementById(id);
    el("brief-speaker-name").textContent = m.speaker || "Captain Dad";
    el("brief-title").textContent = m.title || "Mission";
    el("brief-dialogue").innerHTML = (m.briefing || []).map((line) => `<div>${line}</div>`).join("");
    // Portrait.
    const pc = el("brief-portrait"); if (pc) drawCaptainDad(pc.getContext("2d"), pc.width);
    // Map preview: plot the mission island's bases as targets.
    const mc = el("brief-map");
    if (mc) {
      const isl = (this._briefWorld && this._briefWorld.islands || []).find((i) => i.name === m.island) || { center: { x: 0, z: 0 } };
      const bases = (isl.missionBases || []).map((b) => ({ x: b[0] + isl.center.x, z: b[1] + isl.center.z }));
      drawMapPreview(mc.getContext("2d"), mc.width, isl, bases, []);
    }
    // Objectives.
    const ul = el("brief-objectives");
    ul.innerHTML = (m.objectives || []).map((o) => {
      const cls = o.priority === "secondary" ? "sec" : o.priority === "optional" ? "opt" : "pri";
      const tag = o.priority === "optional" ? "○" : o.priority === "secondary" ? "◆" : "●";
      return `<li><span class="${cls}">${tag}</span> ${o.label}</li>`;
    }).join("");
    // Lives select default.
    const lv = el("brief-lives");
    if (lv && this.cb.livesMode) lv.value = this.cb.livesMode();
    // Mission list (locked / done / current).
    const list = el("brief-list");
    if (list && this._briefProgress) {
      list.innerHTML = "";
      for (const mm of campaign.CAMPAIGN) {
        const unlocked = campaign.isUnlocked(mm.id, this._briefProgress);
        const done = campaign.isComplete(mm.id, this._briefProgress);
        const chip = document.createElement("button");
        chip.className = "brief-chip" + (done ? " done" : "") + (!unlocked ? " locked" : "") + (mm.id === m.id ? " current" : "");
        chip.textContent = (done ? "✓ " : "") + mm.title;
        if (unlocked) chip.addEventListener("click", () => { this._briefMission = mm; this._buildBriefing(); });
        list.appendChild(chip);
      }
    }
  }

  // --- Conquest map screen (beachhead pick at setup; runway pick on respawn) ---
  // opts.mode: "setup" (choose a beachhead + rules) | "respawn" (owned only).
  showConquest(run, world, opts = {}) {
    if (!this.conquest) return;
    this._cqRun = run;
    this._cqWorld = world;
    this._cqMode = opts.mode || "setup";
    this._cqPick = null;
    this.menu.classList.add("hidden");
    this.hideBriefing();
    const lv = document.getElementById("cq-lives");
    if (lv && this.cb.livesMode) lv.value = this.cb.livesMode();
    const df = document.getElementById("cq-diff");
    if (df && run) df.value = run.difficulty || "veteran";
    this.conquest.classList.remove("hidden");
    this._buildConquest();
  }
  hideConquest() { if (this.conquest) this.conquest.classList.add("hidden"); }

  // Campaign picker: list saved Conquest campaigns (resume / delete) or start new.
  showConquestSaves(saves, cb) {
    const panel = document.getElementById("cq-saves");
    if (!panel) { cb.onNew(); return; } // no UI — just start a new run
    this.menu.classList.add("hidden");
    this.hideConquest();
    const list = document.getElementById("cq-saves-list");
    if (list) {
      if (!saves.length) list.innerHTML = `<p class="hint">No saved campaigns yet — start a new one.</p>`;
      else list.innerHTML = saves.map((s) => {
        const when = new Date(s.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const status = s.won ? "✓ secured" : `${s.owned}/${s.total} islands held`;
        return `<div class="cq-save"><div class="cq-save-info"><b>${s.name}</b><span>${status} · ${s.difficulty} · ${when}</span></div>`
          + `<div class="cq-save-actions"><button data-load="${s.id}" class="primary">${s.won ? "View" : "Resume"}</button>`
          + `<button data-ren="${s.id}" title="Rename">✎</button><button data-del="${s.id}" title="Delete">🗑</button></div></div>`;
      }).join("");
      list.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => cb.onLoad(b.dataset.load)));
      list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => cb.onDelete(b.dataset.del)));
      list.querySelectorAll("[data-ren]").forEach((b) => b.addEventListener("click", () => {
        const sv = saves.find((x) => x.id === b.dataset.ren);
        const name = window.prompt("Rename campaign", sv ? sv.name : "");
        if (name && name.trim()) cb.onRename(b.dataset.ren, name.trim());
      }));
    }
    const ni = document.getElementById("cq-name");
    const nw = document.getElementById("cq-new"); if (nw) nw.onclick = () => cb.onNew(ni ? ni.value : "");
    const bk = document.getElementById("cq-saves-back"); if (bk) bk.onclick = () => cb.onBack();
    if (ni) ni.value = "";
    panel.classList.remove("hidden");
  }
  hideConquestSaves() { const p = document.getElementById("cq-saves"); if (p) p.classList.add("hidden"); }

  // Clicking an island on the planner map picks it as the beachhead (selecting a
  // launchable spawn on it). Ignored if that island has no available launch point
  // (e.g. an enemy island on the respawn screen).
  pickConquestIsland(name) {
    const run = this._cqRun; if (!run) return;
    const node = run.nodes.find((n) => n.name === name); if (!node) return;
    const list = this._cqMode === "setup" ? run.allSpawns() : run.ownedSpawns();
    const pick = list.find((s) => s.node === node.id && s.kind === "runway") || list.find((s) => s.node === node.id);
    if (!pick) return;
    this._cqPick = pick;
    this._buildConquest();
  }

  _buildConquest() {
    const run = this._cqRun;
    if (!run) return;
    const el = (id) => document.getElementById(id);
    const setup = this._cqMode === "setup", resume = this._cqMode === "resume";
    el("cq-title").textContent = setup ? "Choose your beachhead" : resume ? "Resume campaign" : "Launch a fresh aircraft";
    el("cq-dialogue").innerHTML = setup
      ? "<div>Pick an island to land and seize — that's your first foothold. From its runway, take the rest of the archipelago one island at a time.</div>"
      : resume
      ? "<div>Welcome back. Your held islands are yours — choose a runway or carrier to launch from and press the assault.</div>"
      : "<div>Aircraft down. Choose a captured runway or carrier to get back in the fight.</div>";
    // Strategic map — accurate terrain, islands ringed by who holds them.
    const mc = el("cq-map");
    const selNode = this._cqPick ? this._cqPick.node : run.startId;
    const startMarker = this._cqPick ? { x: this._cqPick.x, z: this._cqPick.z } : null;
    if (mc && this.cb.drawConquestMap) this.cb.drawConquestMap(selNode, startMarker);
    else if (mc) drawArchipelago(mc.getContext("2d"), mc.width, run.nodes, { selectedNode: selNode });
    // Launch points (every island at setup; only owned ones on respawn).
    const sp = el("cq-spawns");
    if (sp) {
      sp.innerHTML = "";
      const list = setup ? run.allSpawns() : run.ownedSpawns();
      for (const s of list) {
        const owner = run.node(s.node);
        const held = owner && owner.owner === "player";
        const chip = document.createElement("button");
        chip.className = "cq-chip" + (this._cqPick === s ? " selected" : "") + (held ? " held" : "");
        const icon = s.kind === "carrier" ? "⚓" : "🛫";
        chip.innerHTML = `<span class="cq-ic">${icon}</span> ${s.name}`;
        chip.addEventListener("click", () => { this._cqPick = s; this._buildConquest(); });
        sp.appendChild(chip);
      }
      if (!list.length) sp.innerHTML = `<span class="hint">No launch points available.</span>`;
    }
    // Front-line status: every island, coloured by who holds it.
    const st = el("cq-status");
    if (st) {
      st.innerHTML = run.nodes.map((n) => {
        const cls = n.owner === "player" ? "owned" : n.awake ? "fighting" : "enemy";
        const tag = n.owner === "player" ? "✓" : n.awake ? "⚔" : "✕";
        return `<span class="cq-node ${cls}">${tag} ${n.name}</span>`;
      }).join("");
    }
    const bl = el("cq-launch");
    if (bl) bl.disabled = !this._cqPick;
  }
}
