import * as THREE from "three";
import { getWorldConfig, riverCenterX, getForestDensity } from "./world.js";

// In-browser world editor: a top-down map view with draggable markers for the
// editable objects (settlements, carriers, bridges, mission bases, spawn,
// cliff). Edits mutate the live world config; "Apply & Reload" saves it to
// localStorage and reloads so the real geometry rebuilds from it.

const GY = 540; // gizmo altitude — floats above the tallest buildings

const KIND_DEFAULTS = {
  city: { radius: 3, spacing: 130, maxHeight: 230 },
  town: { radius: 2, spacing: 115, maxHeight: 150 },
  village: { radius: 1, spacing: 90, maxHeight: 70 },
};

export class Editor {
  constructor(scene, renderer, hud) {
    this.scene = scene;
    this.renderer = renderer;
    this.hud = hud;
    this.active = false;
    this.onExit = null;
    this.cfg = getWorldConfig();
    this.tool = "select";
    this.selected = null;
    this.view = 16000;
    this.brush = 700;
    this._painting = 0;
    this.densMesh = null;
    this._road = [];        // waypoints of the road currently being drawn
    this.roadGroup = null;  // line overlay for committed + in-progress roads

    this.gizmos = new THREE.Group();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 80000);
    this.cam.position.set(0, 30000, 0);
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, 0, 0);

    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmp = new THREE.Vector3();
    this._drag = null;
    this._pan = null;

    this._buildDOM();
    this._bindPointer();
  }

  // ---------- lifecycle ----------
  enter() {
    this.cfg = getWorldConfig();
    this.active = true;
    this._fog = this.scene.fog;
    this.scene.fog = null; // would otherwise fog out the whole map from up high
    if (!this.roadGroup) { this.roadGroup = new THREE.Group(); this.scene.add(this.roadGroup); }
    this.roadGroup.visible = true;
    this.scene.add(this.gizmos);
    this.rebuildGizmos();
    this._ensureDensOverlay();
    this._syncOverlay();
    this.applyCamera();
    this.panel.style.display = "block";
    this.select(null);
  }
  exit() {
    this.active = false;
    this.scene.fog = this._fog;
    this.scene.remove(this.gizmos);
    if (this.densMesh) this.densMesh.visible = false;
    if (this.roadGroup) this.roadGroup.visible = false;
    this._road = [];
    this.panel.style.display = "none";
    if (this.onExit) this.onExit();
  }
  render() {
    this.hud.ctx.clearRect(0, 0, this.hud.w, this.hud.h);
    this.applyCamera();
    this.renderer.render(this.scene, this.cam);
  }

  applyCamera() {
    const a = window.innerWidth / window.innerHeight, v = this.view;
    this.cam.left = -v * a / 2; this.cam.right = v * a / 2;
    this.cam.top = v / 2; this.cam.bottom = -v / 2;
    this.cam.updateProjectionMatrix();
  }

  // ---------- gizmos ----------
  _disc(color, r) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 14, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false })
    );
    m.renderOrder = 10;
    return m;
  }
  _ring(color, r) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(r, Math.max(20, r * 0.04), 8, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false })
    );
    m.rotation.x = Math.PI / 2; m.renderOrder = 10;
    return m;
  }

  rebuildGizmos() {
    for (const c of [...this.gizmos.children]) this.gizmos.remove(c);
    const c = this.cfg;
    c.settlements.forEach((s, i) => {
      const col = s.kind === "city" ? 0xffd23f : s.kind === "town" ? 0x4fd2ff : 0x6cff8a;
      const g = this._disc(col, Math.max(90, s.radius * s.spacing));
      g.position.set(s.x, GY, s.z);
      g.userData = { kind: "settlement", ref: s, i };
      this.gizmos.add(g);
    });
    c.carriers.forEach((cr, i) => {
      const g = this._disc(cr.team === "ally" ? 0x66aaff : 0xff5a5a, 180);
      g.scale.set(0.4, 1, 1);
      g.position.set(cr.x, GY, cr.z);
      g.userData = { kind: "carrier", ref: cr, i };
      this.gizmos.add(g);
    });
    c.bridges.forEach((z, i) => {
      const g = this._disc(0xb0b6bd, 130);
      g.position.set(riverCenterX(z), GY, z);
      g.userData = { kind: "bridge", i };
      this.gizmos.add(g);
    });
    c.missionBases.forEach((b, i) => {
      const g = this._ring(0xff8a3c, 220);
      g.position.set(b[0], GY, b[1]);
      g.userData = { kind: "base", i };
      this.gizmos.add(g);
    });
    const sp = this._disc(0x2ee6a6, 120);
    sp.position.set(c.spawn.x, GY, c.spawn.z);
    sp.userData = { kind: "spawn" };
    this.gizmos.add(sp);
    const cl = this._ring(0x9a9a8e, c.cliff.r);
    cl.position.set(c.cliff.x, GY, c.cliff.z);
    cl.userData = { kind: "cliff" };
    this.gizmos.add(cl);
    c.roads.forEach((road, ri) => road.forEach((pt, vi) => {
      const g = this._disc(0xc8a35a, 60);
      g.position.set(pt[0], GY, pt[1]);
      g.userData = { kind: "roadpt", ri, vi };
      this.gizmos.add(g);
    }));
    this._redrawRoadLines();
  }

  // ---- tree-density overlay + brush ----
  _ensureDensOverlay() {
    if (this.densMesh) return;
    const f = this.cfg.forest, g = f.gridN;
    this._densData = new Uint8Array(g * g * 4);
    this._densTex = new THREE.DataTexture(this._densData, g, g, THREE.RGBAFormat);
    const mat = new THREE.MeshBasicMaterial({ map: this._densTex, transparent: true, opacity: 0.7, depthTest: false });
    this.densMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * f.extent, 2 * f.extent), mat);
    this.densMesh.rotation.x = -Math.PI / 2;
    this.densMesh.position.set(0, GY - 40, 0);
    this.densMesh.renderOrder = 5;
    this.scene.add(this.densMesh);
    this._updateDensTex();
  }
  _updateDensTex() {
    const d = getForestDensity(), g = this.cfg.forest.gridN;
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const v = d[j * g + i];
        const k = ((g - 1 - j) * g + i) * 4; // flip Z so the overlay matches the map
        this._densData[k] = 40; this._densData[k + 1] = 210; this._densData[k + 2] = 70;
        this._densData[k + 3] = Math.round(v * 200);
      }
    }
    this._densTex.needsUpdate = true;
  }
  _syncOverlay() {
    if (this.densMesh) this.densMesh.visible = this.tool === "trees" || this.tool === "erase";
  }
  paintAt(p) {
    const f = this.cfg.forest, g = f.gridN, e = f.extent, d = getForestDensity();
    const rad = this.brush, rate = 0.5, cell = (2 * e) / (g - 1);
    const span = Math.ceil(rad / cell) + 1;
    const ci = (p.x / (2 * e) + 0.5) * (g - 1);
    const cj = (p.z / (2 * e) + 0.5) * (g - 1);
    for (let j = Math.max(0, Math.floor(cj - span)); j <= Math.min(g - 1, Math.ceil(cj + span)); j++) {
      for (let i = Math.max(0, Math.floor(ci - span)); i <= Math.min(g - 1, Math.ceil(ci + span)); i++) {
        const wx = (i / (g - 1) - 0.5) * 2 * e, wz = (j / (g - 1) - 0.5) * 2 * e;
        const dist = Math.hypot(wx - p.x, wz - p.z);
        if (dist > rad) continue;
        const k = j * g + i;
        d[k] = THREE.MathUtils.clamp(d[k] + this._painting * rate * (1 - dist / rad), 0, 1);
      }
    }
    this._updateDensTex();
  }

  // ---- road drawing ----
  _redrawRoadLines() {
    const grp = this.roadGroup;
    if (!grp) return;
    for (const c of [...grp.children]) { grp.remove(c); c.geometry.dispose(); }
    const line = (pts, color) => {
      const pos = [];
      for (const [x, z] of pts) pos.push(x, GY - 15, z);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
      l.renderOrder = 6;
      grp.add(l);
    };
    for (const road of this.cfg.roads) if (road.length >= 2) line(road, 0xc8a35a);
    if (this._road.length >= 2) line(this._road, 0xffe08a);
  }
  finishRoad() {
    if (this._road.length >= 2) this.cfg.roads.push(this._road.map((p) => [...p]));
    this._road = [];
    this.rebuildGizmos();
    this._refreshProps();
  }
  cancelRoad() {
    this._road = [];
    this._redrawRoadLines();
    this._refreshProps();
  }

  _markerPos(u) {
    const c = this.cfg;
    if (u.kind === "settlement" || u.kind === "carrier") return [u.ref.x, u.ref.z];
    if (u.kind === "roadpt") return [c.roads[u.ri][u.vi][0], c.roads[u.ri][u.vi][1]];
    if (u.kind === "bridge") return [riverCenterX(c.bridges[u.i]), c.bridges[u.i]];
    if (u.kind === "base") return [c.missionBases[u.i][0], c.missionBases[u.i][1]];
    if (u.kind === "spawn") return [c.spawn.x, c.spawn.z];
    if (u.kind === "cliff") return [c.cliff.x, c.cliff.z];
    return [0, 0];
  }
  _setPos(u, x, z) {
    const c = this.cfg;
    if (u.kind === "settlement" || u.kind === "carrier") { u.ref.x = x; u.ref.z = z; }
    else if (u.kind === "roadpt") c.roads[u.ri][u.vi] = [x, z];
    else if (u.kind === "bridge") c.bridges[u.i] = z; // x follows the river
    else if (u.kind === "base") c.missionBases[u.i] = [x, z];
    else if (u.kind === "spawn") { c.spawn.x = x; c.spawn.z = z; }
    else if (u.kind === "cliff") { c.cliff.x = x; c.cliff.z = z; }
  }
  _syncMarker(mesh) {
    const [x, z] = this._markerPos(mesh.userData);
    mesh.position.set(x, GY, z);
  }

  // ---------- interaction ----------
  _ground(e) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    this._ray.setFromCamera({ x, y }, this.cam);
    const hit = this._ray.ray.intersectPlane(this._plane, this._tmp);
    return hit ? { x: this._tmp.x, z: this._tmp.z } : null;
  }
  _pick(e) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    this._ray.setFromCamera({ x, y }, this.cam);
    const hits = this._ray.intersectObjects(this.gizmos.children, false);
    return hits.length ? hits[0].object : null;
  }

  _bindPointer() {
    window.addEventListener("pointerdown", (e) => {
      if (!this.active || (e.target.closest && e.target.closest("#editor-panel"))) return;
      const g = this._ground(e);
      if (this.tool === "trees" || this.tool === "erase") {
        this._painting = this.tool === "trees" ? 1 : -1;
        if (g) this.paintAt(g);
        return;
      }
      if (this.tool === "road") {
        if (g) { this._road.push([Math.round(g.x), Math.round(g.z)]); this._redrawRoadLines(); this._refreshProps(); }
        return;
      }
      if (this.tool !== "select") { if (g) this.place(g); return; }
      const m = this._pick(e);
      if (m) { this.select(m); this._drag = m; }
      else { this.select(null); this._pan = { x: e.clientX, y: e.clientY }; }
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.active) return;
      if (this._painting) {
        const g = this._ground(e);
        if (g) this.paintAt(g);
      } else if (this._drag) {
        const g = this._ground(e);
        if (g) {
          this._setPos(this._drag.userData, g.x, g.z);
          this._syncMarker(this._drag);
          if (this._drag.userData.kind === "roadpt") this._redrawRoadLines();
          this._refreshProps();
        }
      } else if (this._pan) {
        const s = this.view / window.innerHeight;
        this.cam.position.x -= (e.clientX - this._pan.x) * s;
        this.cam.position.z -= (e.clientY - this._pan.y) * s;
        this._pan = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener("pointerup", () => { this._drag = null; this._pan = null; this._painting = 0; });
    window.addEventListener("wheel", (e) => {
      if (!this.active || (e.target.closest && e.target.closest("#editor-panel"))) return;
      this.view = THREE.MathUtils.clamp(this.view * (1 + Math.sign(e.deltaY) * 0.12), 2500, 42000);
      this.applyCamera();
    }, { passive: true });
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (this.tool === "road" && e.code === "Enter") { this.finishRoad(); return; }
      if (this.tool === "road" && e.code === "Escape") { this.cancelRoad(); return; }
      if (e.code === "Delete" || e.code === "Backspace") this.deleteSelected();
    });
  }

  place(g) {
    const c = this.cfg;
    if (this.tool.startsWith("settle:")) {
      const kind = this.tool.split(":")[1];
      c.settlements.push({ kind, x: Math.round(g.x), z: Math.round(g.z), ...KIND_DEFAULTS[kind] });
    } else if (this.tool.startsWith("carrier:")) {
      c.carriers.push({ team: this.tool.split(":")[1], x: Math.round(g.x), z: Math.round(g.z), halfL: 170, halfW: 36 });
    } else if (this.tool === "bridge") {
      c.bridges.push(Math.round(g.z));
    } else if (this.tool === "base") {
      c.missionBases.push([Math.round(g.x), Math.round(g.z)]);
    }
    this.tool = "select";
    this._highlightTools();
    this.rebuildGizmos();
  }

  deleteSelected() {
    const u = this.selected && this.selected.userData;
    if (!u) return;
    const c = this.cfg;
    if (u.kind === "settlement") c.settlements.splice(u.i, 1);
    else if (u.kind === "carrier") c.carriers.splice(u.i, 1);
    else if (u.kind === "bridge") c.bridges.splice(u.i, 1);
    else if (u.kind === "base") c.missionBases.splice(u.i, 1);
    else if (u.kind === "roadpt") {
      c.roads[u.ri].splice(u.vi, 1);
      if (c.roads[u.ri].length < 2) c.roads.splice(u.ri, 1); // drop a road that lost its shape
    } else return; // spawn / cliff can't be deleted
    this.select(null);
    this.rebuildGizmos();
  }

  select(mesh) {
    if (this.selected) this.selected.material.opacity = this.selected.userData.kind === "cliff" ? 0.8 : 0.55;
    this.selected = mesh;
    if (mesh) mesh.material.opacity = 1;
    this._refreshProps();
  }

  // ---------- DOM ----------
  _buildDOM() {
    const p = document.createElement("div");
    p.id = "editor-panel";
    p.innerHTML = `
      <h3>World Editor</h3>
      <div class="ed-row" id="ed-tools"></div>
      <div id="ed-props"></div>
      <div class="ed-actions">
        <button data-a="apply" class="primary">Apply &amp; Reload</button>
        <button data-a="export">Export JSON</button>
        <button data-a="import">Import</button>
        <button data-a="reset">Reset</button>
        <button data-a="exit">Exit</button>
      </div>
      <p class="ed-hint">Drag markers to move. Pick a "+" tool then click the map to place. Del removes. Scroll to zoom, drag empty space to pan.</p>
      <input type="file" id="ed-file" accept="application/json" style="display:none" />`;
    document.body.appendChild(p);
    this.panel = p;

    const tools = [
      ["select", "Select"], ["settle:city", "+City"], ["settle:town", "+Town"],
      ["settle:village", "+Village"], ["carrier:ally", "+Ally CV"], ["carrier:enemy", "+Enemy CV"],
      ["bridge", "+Bridge"], ["base", "+Target"], ["road", "🛣 Road"],
      ["trees", "🌲 Trees"], ["erase", "🧹 Clear"],
    ];
    const tt = p.querySelector("#ed-tools");
    for (const [id, label] of tools) {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.tool = id;
      b.addEventListener("click", () => {
        if (this.tool === "road" && id !== "road" && this._road.length) this.cancelRoad();
        this.tool = id; this._highlightTools(); this._syncOverlay(); this._refreshProps();
      });
      tt.appendChild(b);
    }
    this._highlightTools();

    p.querySelector(".ed-actions").addEventListener("click", (e) => {
      const a = e.target.dataset.a;
      if (a === "apply") { this.save(); location.reload(); }
      else if (a === "export") this.exportJSON();
      else if (a === "import") p.querySelector("#ed-file").click();
      else if (a === "reset") { localStorage.removeItem("rogueflyer.world"); location.reload(); }
      else if (a === "exit") this.exit();
    });
    p.querySelector("#ed-file").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { localStorage.setItem("rogueflyer.world", r.result); location.reload(); } catch (_) {} };
      r.readAsText(f);
    });
  }

  _highlightTools() {
    for (const b of this.panel.querySelectorAll("#ed-tools button")) {
      b.classList.toggle("on", b.dataset.tool === this.tool);
    }
  }

  _refreshProps() {
    const host = this.panel.querySelector("#ed-props");
    if (this.tool === "trees" || this.tool === "erase") {
      host.innerHTML = `<div class="ed-sel">tree brush</div>
        <label>size<input type="range" id="p_brush" min="200" max="2500" value="${this.brush}"></label>
        <div class="ed-none">Drag the map to ${this.tool === "trees" ? "add" : "remove"} trees. Green overlay = cover.</div>`;
      host.querySelector("#p_brush").addEventListener("input", (e) => { this.brush = +e.target.value; });
      return;
    }
    if (this.tool === "road") {
      host.innerHTML = `<div class="ed-sel">draw road</div>
        <div class="ed-none">Click the map to drop waypoints (${this._road.length} so far). Enter to save, Esc to cancel.</div>
        <div class="ed-actions"><button id="rd-fin" class="primary">Finish road</button><button id="rd-can">Cancel</button></div>`;
      host.querySelector("#rd-fin").addEventListener("click", () => this.finishRoad());
      host.querySelector("#rd-can").addEventListener("click", () => this.cancelRoad());
      return;
    }
    const u = this.selected && this.selected.userData;
    if (!u) { host.innerHTML = '<div class="ed-none">Nothing selected.</div>'; return; }
    const c = this.cfg;
    const num = (label, val, on) => {
      const id = "p_" + label.replace(/\W/g, "");
      return { html: `<label>${label}<input type="number" id="${id}" value="${val}"></label>`, id, on };
    };
    const rows = [];
    if (u.kind === "settlement") {
      rows.push(`<label>kind<select id="p_kind"><option ${u.ref.kind === "city" ? "selected" : ""}>city</option><option ${u.ref.kind === "town" ? "selected" : ""}>town</option><option ${u.ref.kind === "village" ? "selected" : ""}>village</option></select></label>`);
      rows.push(num("radius", u.ref.radius));
      rows.push(num("spacing", u.ref.spacing));
      rows.push(num("maxHeight", u.ref.maxHeight));
    } else if (u.kind === "carrier") {
      rows.push(`<label>team<select id="p_team"><option ${u.ref.team === "ally" ? "selected" : ""}>ally</option><option ${u.ref.team === "enemy" ? "selected" : ""}>enemy</option></select></label>`);
    } else if (u.kind === "cliff") {
      rows.push(num("r", c.cliff.r));
      rows.push(num("h", c.cliff.h));
    }
    host.innerHTML = `<div class="ed-sel">${u.kind}</div>` + rows.map((r) => typeof r === "string" ? r : r.html).join("");

    // wire inputs
    const bind = (sel, fn) => { const el = host.querySelector(sel); if (el) el.addEventListener("change", () => fn(el.value)); };
    if (u.kind === "settlement") {
      bind("#p_kind", (v) => { u.ref.kind = v; Object.assign(u.ref, KIND_DEFAULTS[v]); this.rebuildGizmos(); });
      bind("#p_radius", (v) => { u.ref.radius = +v; this.rebuildGizmos(); });
      bind("#p_spacing", (v) => { u.ref.spacing = +v; this.rebuildGizmos(); });
      bind("#p_maxHeight", (v) => { u.ref.maxHeight = +v; });
    } else if (u.kind === "carrier") {
      bind("#p_team", (v) => { u.ref.team = v; this.rebuildGizmos(); });
    } else if (u.kind === "cliff") {
      bind("#p_r", (v) => { c.cliff.r = +v; this.rebuildGizmos(); });
      bind("#p_h", (v) => { c.cliff.h = +v; });
    }
  }

  save() {
    try { localStorage.setItem("rogueflyer.world", JSON.stringify(this.cfg)); } catch (_) {}
  }
  exportJSON() {
    const blob = new Blob([JSON.stringify(this.cfg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "world.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
