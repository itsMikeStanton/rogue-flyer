// Accurate top-down tactical map. Unlike the stylized blobs in portrait.js, this
// rasterizes the REAL terrain — sampling terrainHeight() across each island's
// footprint and shading land above sea level — so the atolls, crescents, spirals
// and shattered shards read true to how they actually fly.
//
// Deliberately a TACTICAL display, not a colourful game map: neutral terrain,
// installations drawn as typed symbols (airfield, carrier, SAM, radar, AA, fuel,
// bunker, power plant) coloured only by threat, hover for details, and faction
// allegiance pushed to a sidebar rather than smeared across the land.
//
// One renderer, two homes: a full-screen in-flight overlay (overview + click to
// zoom) and an embedded Conquest planner (islands ringed by who holds them,
// click to pick a beachhead). Terrain rasters are baked once per island into a
// shared module cache and reused by every MapView.

import { getWorldConfig, terrainHeight, SEA_LEVEL, forestAt } from "./world.js";
import { wptType, legBearing, legDist } from "./waypoints.js";

const PLAN_SPEED = 231; // ~450 kt in m/s, for route ETA

// Hex colour number (e.g. 0x46c8ff from a waypoint type) -> "#rrggbb" CSS string.
function css(hex) { return "#" + (hex & 0xffffff).toString(16).padStart(6, "0"); }

const SIDE_COL = { hostile: "#d9774a", friendly: "#62c98a", neutral: "#97a4ac" };
// Which installation kinds get a persistent text label (the rest are hover-only,
// so the map isn't buried under every AA gun).
const LABEL_KINDS = new Set(["runway", "carrier", "lighthouse", "radio", "spire", "powerplant", "site", "sam"]);

const RASTERS = new Map(); // island name -> { canvas, R } (terrain is faction-agnostic now)
export function invalidateMap() { RASTERS.clear(); }

export class MapView {
  // opts: { factionOf(name)->id, getFactions()->Factions, getSites()->[{x,z,kind,label,side,alive}],
  //         getPlayer()->{x,z,heading}|null, embedded?, getNodes(), getSelected(), onPick(name), onClose() }
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.embedded = !!opts.embedded;
    this.view = { island: null };
    this.isOpen = this.embedded;
    this._tf = null; this._mouse = null; this._markers = [];
    this.cam = null; this._drag = null; this._dragMoved = false; this._sidebarHits = []; this.routeMode = false;
    this._selWpt = null; this._wptDrag = null; this._suppressClick = false; this.editable = true;
    this.labelsOn = true;
    try { this.labelsOn = localStorage.getItem("rf.mapLabels") !== "0"; } catch (_) { /* ignore */ }
    this._top = this.embedded ? 0 : 40;       // header band
    this._right = this.embedded ? 0 : 216;     // sidebar width
    this._onResize = () => { if (this.isOpen) { this._size(); this.draw(); } };
    canvas.addEventListener("click", (e) => this._onClick(e));
    canvas.addEventListener("mousemove", (e) => this._onMove(e));
    canvas.addEventListener("mouseleave", () => { this._mouse = null; this._drag = null; if (this.isOpen) this.draw(); });
    if (!this.embedded) {
      canvas.addEventListener("mousedown", (e) => {
        if (!this.cam) return;
        const p = this._evtPos(e);
        if (this.routeMode) { const i = this._hitWaypoint(p.x, p.y); if (i >= 0) { this._wptDrag = { i, moved: false }; return; } }
        this._drag = { ...p, cx: this.cam.cx, cz: this.cam.cz, moved: false };
      });
      window.addEventListener("mouseup", () => {
        if (this._wptDrag) { if (this._wptDrag.moved && this.opts.onRouteCommit) { this.opts.onRouteCommit(); this._suppressClick = true; } this._wptDrag = null; }
        this._dragMoved = !!(this._drag && this._drag.moved); this._drag = null;
      });
      canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
      canvas.addEventListener("contextmenu", (e) => { if (this.routeMode && this.opts.onRouteUndo) { e.preventDefault(); this.opts.onRouteUndo(); this.draw(); } });
    }
    window.addEventListener("resize", this._onResize);
  }

  _islands() {
    return getWorldConfig().islands.map((is) => ({
      name: is.name, center: { x: is.center.x, z: is.center.z },
      outer: (is.terrain && is.terrain.islandOuter) || 9000,
      roads: is.roads || [], settlements: is.settlements || [],
    }));
  }

  open(islandName = null) {
    if (this.embedded) return;
    this.view.island = islandName; this.isOpen = true; this.cam = null; // start at overview
    this.canvas.parentElement.classList.remove("hidden");
    this._size(); this.draw();
  }
  setLabels(on) {
    this.labelsOn = !!on;
    try { localStorage.setItem("rf.mapLabels", on ? "1" : "0"); } catch (_) { /* ignore */ }
    if (this.isOpen) this.draw();
  }
  setRouteMode(on) {
    this.routeMode = !!on && this.editable; // no route editing in flight (nav only)
    this.canvas.style.cursor = this.routeMode ? "crosshair" : "";
    if (this.isOpen) this.draw();
  }
  close() {
    if (this.embedded) return;
    this.isOpen = false; this._mouse = null;
    this.canvas.parentElement.classList.add("hidden");
    if (this.opts.onClose) this.opts.onClose();
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  refresh() { this._size(); this.draw(); }

  _size() {
    if (this.embedded) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this._w = this.canvas.width; this._h = this.canvas.height;
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || this.canvas.width, h = this.canvas.clientHeight || this.canvas.height;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w; this._h = h;
  }
  _evtPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this._w / (rect.width || this._w), sy = this._h / (rect.height || this._h);
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  // --- terrain raster (neutral hillshade + vector coastline; shared cache) --
  // Bakes a slope-shaded relief image so ridges/valleys read, plus a crisp
  // coastline traced from the real height field (marching squares) that stays
  // sharp at any zoom — the two things that make the land legible.
  _raster(is) {
    const hit = RASTERS.get(is.name);
    if (hit) return hit;
    const G = 320, R = is.outer * 1.06, sea = SEA_LEVEL;
    // Sample the height field on a (G+1)² grid (shared by shading + contour).
    const H = new Float32Array((G + 1) * (G + 1));
    const pos = (k) => (k / G - 0.5) * 2 * R;
    for (let j = 0; j <= G; j++) {
      const wz = is.center.z + pos(j);
      for (let i = 0; i <= G; i++) H[j * (G + 1) + i] = terrainHeight(is.center.x + pos(i), wz);
    }
    // Hillshade image (light from the NW), tinted muted olive, with a teal shelf.
    const cell = (2 * R) / G;
    let Lx = -0.55, Ly = 0.74, Lz = -0.38; const Ll = Math.hypot(Lx, Ly, Lz); Lx /= Ll; Ly /= Ll; Lz /= Ll;
    const cv = document.createElement("canvas"); cv.width = cv.height = G;
    const c = cv.getContext("2d");
    const img = c.createImageData(G, G), d = img.data;
    const fcv = document.createElement("canvas"); fcv.width = fcv.height = G; // forest overlay
    const fimg = c.createImageData(G, G), fd = fimg.data;
    const at = (i, j) => H[j * (G + 1) + i];
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const h = at(i, j), idx = (j * G + i) * 4;
        if (h > sea) {
          const fv = forestAt(is.center.x + pos(i), is.center.z + pos(j));
          if (fv > 0.16) { fd[idx] = 42; fd[idx + 1] = 90; fd[idx + 2] = 50; fd[idx + 3] = Math.min(215, fv * 240); }
          const hx = at(Math.min(G, i + 1), j) - at(Math.max(0, i - 1), j);
          const hz = at(i, Math.min(G, j + 1)) - at(i, Math.max(0, j - 1));
          let nx = -hx, nz = -hz, ny = 2 * cell; const nl = Math.hypot(nx, ny, nz) || 1;
          let shade = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nl);
          shade = Math.min(1, Math.max(0, (shade - 0.5) * 2.3 + 0.5)); // hard contrast
          const b = 0.04 + 1.7 * shade;                    // deep shadows, bright faces
          const e = Math.min(1, (h - sea) / 1800);         // peaks clearly lighter
          d[idx] = Math.min(255, (58 + 58 * e) * b);
          d[idx + 1] = Math.min(255, (80 + 50 * e) * b);
          d[idx + 2] = Math.min(255, (58 + 36 * e) * b);
          d[idx + 3] = 255;
        } else if (h > sea - 160) {                      // shore shelf
          d[idx] = 26; d[idx + 1] = 52; d[idx + 2] = 64; d[idx + 3] = 120;
        } else { d[idx + 3] = 0; }
      }
    }
    c.putImageData(img, 0, 0);
    fcv.getContext("2d").putImageData(fimg, 0, 0);
    const rec = {
      canvas: cv, forest: fcv, R,
      coast: this._iso(H, G, sea, R, is.center),
      contours: [300, 700, 1300].map((dz) => this._iso(H, G, sea + dz, R, is.center)),
    };
    RASTERS.set(is.name, rec);
    return rec;
  }

  // Marching-squares isocontour at height `t` -> world-space line segments
  // [x0,z0,x1,z1, ...]. Used for the shoreline and the elevation contour lines;
  // drawn as a crisp stroke, so it scales without blur.
  _iso(H, G, t, R, center) {
    const segs = [];
    const pos = (k) => (k / G - 0.5) * 2 * R;
    const lerp = (a, b, ha, hb) => { const dd = hb - ha; const tt = Math.abs(dd) < 1e-6 ? 0.5 : (t - ha) / dd; return a + (b - a) * tt; };
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const h00 = H[j * (G + 1) + i], h10 = H[j * (G + 1) + i + 1];
        const h01 = H[(j + 1) * (G + 1) + i], h11 = H[(j + 1) * (G + 1) + i + 1];
        let cse = 0; if (h00 > t) cse |= 1; if (h10 > t) cse |= 2; if (h11 > t) cse |= 4; if (h01 > t) cse |= 8;
        if (cse === 0 || cse === 15) continue;
        const xL = pos(i), xR = pos(i + 1), zT = pos(j), zB = pos(j + 1);
        const top = () => [lerp(xL, xR, h00, h10), zT];
        const right = () => [xR, lerp(zT, zB, h10, h11)];
        const bottom = () => [lerp(xL, xR, h01, h11), zB];
        const left = () => [xL, lerp(zT, zB, h00, h01)];
        const push = (a, b) => segs.push(center.x + a[0], center.z + a[1], center.x + b[0], center.z + b[1]);
        switch (cse) {
          case 1: case 14: push(left(), top()); break;
          case 2: case 13: push(top(), right()); break;
          case 3: case 12: push(left(), right()); break;
          case 4: case 11: push(right(), bottom()); break;
          case 6: case 9: push(top(), bottom()); break;
          case 7: case 8: push(left(), bottom()); break;
          case 5: push(left(), top()); push(right(), bottom()); break;
          case 10: push(top(), right()); push(bottom(), left()); break;
        }
      }
    }
    return segs;
  }

  // --- view transform (leaves room for header + sidebar) -------------------
  _fit(minX, maxX, minZ, maxZ, pad = 0.08) {
    const W = this._w - this._right, H = this._h - this._top;
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const s = Math.min(W / spanX, H / spanZ) * (1 - pad * 2);
    const ox = (W - spanX * s) / 2 - minX * s;
    const oy = this._top + (H - spanZ * s) / 2 - minZ * s;
    this._tf = { s, toX: (x) => x * s + ox, toY: (z) => z * s + oy, toWX: (px) => (px - ox) / s, toWZ: (py) => (py - oy) / s };
  }
  _bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const is of this._islands()) {
      minX = Math.min(minX, is.center.x - is.outer); maxX = Math.max(maxX, is.center.x + is.outer);
      minZ = Math.min(minZ, is.center.z - is.outer); maxZ = Math.max(maxZ, is.center.z + is.outer);
    }
    return { minX, maxX, minZ, maxZ };
  }
  // Embedded planners fit to the canvas; the full-screen map uses a free camera
  // (drag to pan, wheel to zoom).
  _setView() {
    if (this.embedded) {
      const b = this._bounds();
      this._fit(b.minX, b.maxX, b.minZ, b.maxZ, 0.06);
      return;
    }
    if (!this.cam) this._initCam();
    const s = this.cam.s, cx = this.cam.cx, cz = this.cam.cz;
    const acx = (this._w - this._right) / 2, acy = this._top + (this._h - this._top) / 2;
    this._tf = { s, toX: (x) => (x - cx) * s + acx, toY: (z) => (z - cz) * s + acy, toWX: (px) => (px - acx) / s + cx, toWZ: (py) => (py - acy) / s + cz };
  }
  _initCam() {
    const b = this._bounds();
    const availW = this._w - this._right, availH = this._h - this._top;
    const s = Math.min(availW / Math.max(1, b.maxX - b.minX), availH / Math.max(1, b.maxZ - b.minZ)) * 0.86;
    this.cam = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, s };
    this._fitS = s; this._minS = s * 0.55; this._maxS = s * 48;
  }
  _onWheel(e) {
    if (!this.isOpen || !this._tf) return;
    e.preventDefault();
    const p = this._evtPos(e);
    const wx = this._tf.toWX(p.x), wz = this._tf.toWZ(p.y);
    this.cam.s = Math.max(this._minS, Math.min(this._maxS, this.cam.s * Math.exp(-e.deltaY * 0.0016)));
    const acx = (this._w - this._right) / 2, acy = this._top + (this._h - this._top) / 2;
    this.cam.cx = wx - (p.x - acx) / this.cam.s;     // keep the point under the cursor fixed
    this.cam.cz = wz - (p.y - acy) / this.cam.s;
    this.draw();
  }
  _onMove(e) {
    if (!this.isOpen) return;
    const p = this._evtPos(e);
    if (this._wptDrag && this.opts.onRouteMove) {
      this._wptDrag.moved = true;
      this.opts.onRouteMove(this._wptDrag.i, this._tf.toWX(p.x), this._tf.toWZ(p.y));
      this._mouse = null; this.draw(); return;
    }
    if (this._drag && this.cam) {
      const dx = p.x - this._drag.x, dy = p.y - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._drag.moved = true;
      this.cam.cx = this._drag.cx - dx / this.cam.s;
      this.cam.cz = this._drag.cz - dy / this.cam.s;
      this._mouse = null;
    } else {
      this._mouse = p;
    }
    this.draw();
  }

  // --- drawing -------------------------------------------------------------
  draw() {
    if (!this.isOpen) return;
    const ctx = this.ctx, W = this._w, H = this._h;
    this._setView();
    const tf = this._tf, F = this.opts.getFactions();
    const nodes = this.opts.getNodes && this.opts.getNodes();
    const nodeByName = new Map(); if (nodes) for (const n of nodes) nodeByName.set(n.name, n);
    const selId = this.opts.getSelected && this.opts.getSelected();
    const zoomed = this.embedded ? false : (this.cam && this.cam.s > this._fitS * 2.0);
    const showItems = !this.embedded && this.labelsOn && zoomed; // item labels need zoom-in
    this._markers = []; const labelFeats = [];

    // Ocean + range grid.
    const og = ctx.createLinearGradient(0, 0, 0, H);
    og.addColorStop(0, "#0a1822"); og.addColorStop(1, "#06121a");
    ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(110,140,160,0.07)"; ctx.lineWidth = 1;
    const step = 8000 * tf.s;
    if (step > 14) {
      const x0 = tf.toX(0) % step, y0 = tf.toY(0) % step;
      for (let x = x0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = y0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    // Land (accurate hillshaded terrain) — drawn at half strength so the relief
    // is a faint underlay and the crisp linework (coast, contours, roads) reads.
    const isl = this._islands();
    ctx.imageSmoothingEnabled = true;
    const rasters = isl.map((is) => this._raster(is));
    const rect = (r) => [tf.toX(r.is.center.x - r.R), tf.toY(r.is.center.z - r.R), tf.toX(r.is.center.x + r.R), tf.toY(r.is.center.z + r.R)];
    for (let k = 0; k < isl.length; k++) rasters[k].is = isl[k];
    ctx.globalAlpha = 0.3; // faint relief underlay
    for (const r of rasters) { const [x0, y0, x1, y1] = rect(r); ctx.drawImage(r.canvas, x0, y0, x1 - x0, y1 - y0); }
    ctx.globalAlpha = 0.55; // forest cover
    for (const r of rasters) { const [x0, y0, x1, y1] = rect(r); ctx.drawImage(r.forest, x0, y0, x1 - x0, y1 - y0); }
    ctx.globalAlpha = 1;
    const strokeSegs = (segs) => { for (let s = 0; s < segs.length; s += 4) { ctx.moveTo(tf.toX(segs[s]), tf.toY(segs[s + 1])); ctx.lineTo(tf.toX(segs[s + 2]), tf.toY(segs[s + 3])); } };

    // Elevation contour lines (zoomed-in only — too busy at overview).
    if (zoomed) {
      ctx.strokeStyle = "rgba(150,172,150,0.30)"; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let k = 0; k < isl.length; k++) {
        const is = isl[k], sx = tf.toX(is.center.x), sy = tf.toY(is.center.z), m = is.outer * tf.s;
        if (sx < -m || sx > W + m || sy < -m || sy > H + m) continue; // off-screen island
        for (const seg of rasters[k].contours) strokeSegs(seg);
      }
      ctx.stroke();
    }

    // Crisp vector coastline — two passes (dark underlay deepens the water at the
    // shore, then a bright line) so the island pops off the ocean.
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    for (const r of rasters) strokeSegs(r.coast);
    ctx.strokeStyle = "#040d14"; ctx.lineWidth = zoomed ? 4 : 2.6; ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.strokeStyle = "#cfeaf2"; ctx.lineWidth = zoomed ? 1.6 : 1.0; ctx.globalAlpha = 1; ctx.stroke();

    // Roads (tactical overlay).
    ctx.strokeStyle = "rgba(212,184,140,0.55)"; ctx.lineWidth = zoomed ? 1.5 : 0.8; ctx.beginPath();
    for (const is of isl) for (const road of is.roads) {
      for (let p = 0; p < road.length; p++) {
        const X = tf.toX(is.center.x + road[p][0]), Y = tf.toY(is.center.z + road[p][1]);
        p === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      }
    }
    ctx.stroke();

    // Settlements (buildings) — a footprint grid when zoomed enough, else a town tick.
    ctx.fillStyle = "rgba(186,200,214,0.6)";
    for (const is of isl) for (const s of (is.settlements || [])) {
      const r = s.radius || 1, sp = s.spacing || 110, bpx = sp * tf.s;
      const cx = is.center.x + s.x, cz = is.center.z + s.z;
      if (bpx < 2.4) { // too small to resolve buildings — one block marks the town
        const w = Math.max(2.5, (2 * r + 1) * bpx);
        ctx.fillRect(tf.toX(cx) - w / 2, tf.toY(cz) - w / 2, w, w);
      } else {
        const bs = Math.max(1.5, bpx * 0.62);
        for (let gy = -r; gy <= r; gy++) for (let gx = -r; gx <= r; gx++) {
          ctx.fillRect(tf.toX(cx + gx * sp) - bs / 2, tf.toY(cz + gy * sp) - bs / 2, bs, bs);
        }
      }
    }

    // Conquest: ring islands by who holds them; halo the selected beachhead.
    if (nodes) {
      for (const is of isl) {
        const n = nodeByName.get(is.name); if (!n) continue;
        const x = tf.toX(is.center.x), y = tf.toY(is.center.z), rr = is.outer * tf.s;
        const owned = n.owner === "player";
        const ringCol = owned ? "#62c98a" : n.awake ? "#e0a44a" : "#c0584a";
        if (selId != null && n.id === selId) {
          ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(x, y, rr + 5, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.strokeStyle = ringCol; ctx.lineWidth = 1.75; ctx.globalAlpha = 0.85;
        ctx.setLineDash(owned ? [] : [5, 4]);
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }

    const sites = (this.opts.getSites && this.opts.getSites()) || [];
    const big = !!zoomed;

    // Threat envelopes first (under the symbols): the lethal SAM/AA radius, for
    // planning an ingress that threads between the bubbles.
    for (const f of sites) {
      if (!f.range || f.side === "friendly" || f.alive === false) continue;
      const rr = f.range * tf.s;
      if (rr < 7) continue; // sub-pixel at extreme overview — skip the clutter
      const x = tf.toX(f.x), y = tf.toY(f.z);
      const col = SIDE_COL[f.side] || SIDE_COL.neutral;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.globalAlpha = 0.05; ctx.fill();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke();
      ctx.restore();
    }

    // Installations (typed symbols, coloured only by threat).
    for (const f of sites) {
      const x = tf.toX(f.x), y = tf.toY(f.z);
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      const dead = f.alive === false;
      const col = dead ? "#5a6066" : (SIDE_COL[f.side] || SIDE_COL.neutral);
      this._symbol(f.kind, x, y, col, dead, big);
      this._markers.push({ x, y, r: (big ? 9 : 6) + 3, label: f.label, dead, range: f.range });
      if (showItems && !dead && LABEL_KINDS.has(f.kind)) labelFeats.push({ x, y, wx: f.x, wz: f.z, text: f.label });
    }

    // Planned flight route (waypoints + legs).
    this._drawRoute(tf);

    // Island names are always on (tactical caps); item descriptors only when
    // zoomed in past the overview and labels are enabled.
    this._drawLabels(isl, labelFeats, tf, showItems);

    // Live air contacts (bogeys) — red when hostile/active.
    const contacts = this.opts.getContacts && this.opts.getContacts();
    if (contacts) for (const c of contacts) {
      const x = tf.toX(c.x), y = tf.toY(c.z);
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      ctx.fillStyle = c.hostile === false ? "#5bc8ff" : "#ff5b5b";
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // Selected launch point (pre-spawn): a "you start here" plane icon.
    const sm = this.opts.getStartMarker && this.opts.getStartMarker();
    if (sm) {
      const x = tf.toX(sm.x), y = tf.toY(sm.z);
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = "#3a2e08"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#ffd23f"; ctx.font = "8px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("LAUNCH", x, y + 9);
    }

    // Your jet (in flight) — with an expanding radar pulse so it's easy to find.
    const p = this.opts.getPlayer && this.opts.getPlayer();
    if (p) {
      const x = tf.toX(p.x), y = tf.toY(p.z);
      const ph = (performance.now() / 1000) % 2 / 2;          // 0..1 every 2 s
      ctx.save(); ctx.strokeStyle = "#46ff9a"; ctx.lineWidth = 2;
      for (const t of [ph, (ph + 0.5) % 1]) { ctx.globalAlpha = (1 - t) * 0.55; ctx.beginPath(); ctx.arc(x, y, 6 + t * 52, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.heading || 0);
      ctx.fillStyle = "#46ff9a"; ctx.strokeStyle = "#0a3b22"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    }

    if (!this.embedded) { this._chrome(); this._sidebar(); }
    this._tooltip();
  }

  // Typed installation glyphs — simple, legible, monochrome-by-threat.
  _symbol(kind, x, y, col, dead, big) {
    const ctx = this.ctx, s = big ? 7 : 5;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = dead ? 0.7 : 1;
    ctx.beginPath();
    switch (kind) {
      case "runway": // airfield: stroked rectangle with a centreline
        ctx.strokeRect(x - s * 1.3, y - s * 0.6, s * 2.6, s * 1.2);
        ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.stroke();
        break;
      case "carrier": // ship hull
        ctx.moveTo(x - s * 0.7, y - s); ctx.lineTo(x + s * 0.7, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); ctx.fill();
        break;
      case "sam": // missile site: filled triangle
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); ctx.fill();
        break;
      case "radar": // dish: dot with sweeping arcs
        ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, s, -1.0, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, s * 0.6, -1.0, 0.5); ctx.stroke();
        break;
      case "aa": // gun: a cross
        ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
        break;
      case "bunker": // hardened: filled square
        ctx.fillRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
        break;
      case "tank": // fuel: circle
        ctx.arc(x, y, s * 0.85, 0, Math.PI * 2); ctx.stroke();
        break;
      case "powerplant": // high value: square with inner dot
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        break;
      case "lighthouse": // tower with a beacon + rays
        ctx.moveTo(x - s * 0.55, y + s); ctx.lineTo(x - s * 0.3, y - s * 0.5); ctx.lineTo(x + s * 0.3, y - s * 0.5); ctx.lineTo(x + s * 0.55, y + s); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - s * 0.7, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - s * 1.1, y - s * 1.1); ctx.lineTo(x - s * 0.5, y - s * 0.8); ctx.moveTo(x + s * 1.1, y - s * 1.1); ctx.lineTo(x + s * 0.5, y - s * 0.8); ctx.stroke();
        break;
      case "radio": // antenna mast with signal arcs
        ctx.moveTo(x, y + s); ctx.lineTo(x, y - s); ctx.moveTo(x - s * 0.5, y + s); ctx.lineTo(x, y + s * 0.2); ctx.lineTo(x + s * 0.5, y + s); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y - s, s * 0.7, -2.4, -0.7); ctx.stroke();
        break;
      case "spire": // tall thin obelisk
        ctx.moveTo(x - s * 0.4, y + s); ctx.lineTo(x, y - s * 1.1); ctx.lineTo(x + s * 0.4, y + s); ctx.closePath(); ctx.fill();
        break;
      default: // generic defence cluster: hollow diamond
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.stroke();
    }
    if (dead) { // strike-through for destroyed
      ctx.strokeStyle = "#9aa0a6"; ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.stroke();
    }
    ctx.restore();
  }

  _chrome() {
    const ctx = this.ctx, W = this._w;
    ctx.save();
    ctx.fillStyle = "rgba(4,9,14,0.86)"; ctx.fillRect(0, 0, W, this._top);
    ctx.strokeStyle = "rgba(120,200,224,0.28)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, this._top - 0.5); ctx.lineTo(W, this._top - 0.5); ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#cfe7f0"; ctx.font = "700 13px ui-monospace, 'Consolas', monospace";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    ctx.fillText("◈ TACTICAL COMMAND — ARCHIPELAGO", 16, this._top / 2 + 1);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
    ctx.textAlign = "right"; ctx.fillStyle = "#67798c"; ctx.font = "10px ui-monospace, 'Consolas', monospace";
    ctx.fillText(this.routeMode ? "ROUTE PLOT — CLICK: ADD WPT  ·  RIGHT-CLICK: UNDO  ·  ESC CLOSE"
      : "DRAG PAN  ·  WHEEL ZOOM  ·  HOVER DETAIL  ·  ESC CLOSE", W - 14, this._top / 2 + 1);
    ctx.restore();
  }

  // Faction allegiance lives here, not on the terrain.
  _sidebar() {
    const ctx = this.ctx, F = this.opts.getFactions();
    const x0 = this._w - this._right, H = this._h;
    this._sidebarHits = [];
    ctx.fillStyle = "rgba(5,9,14,0.86)"; ctx.fillRect(x0, this._top, this._right, H - this._top);
    ctx.strokeStyle = "rgba(120,200,224,0.28)"; ctx.beginPath(); ctx.moveTo(x0 + 0.5, this._top); ctx.lineTo(x0 + 0.5, H); ctx.stroke();
    const HEAD = (txt, yy) => { ctx.save(); ctx.fillStyle = "#7fb8c8"; ctx.font = "700 10px ui-monospace, 'Consolas', monospace"; if ("letterSpacing" in ctx) ctx.letterSpacing = "2px"; ctx.fillText(txt, x0 + 14, yy); ctx.restore(); };
    let y = this._top + 18;
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    HEAD("// FORCES", y); y += 17;

    // Group islands by current faction.
    const holdings = new Map();
    for (const is of this._islands()) { const fid = this.opts.factionOf(is.name); (holdings.get(fid) || holdings.set(fid, []).get(fid)).push(is.name); }
    const ids = F && F.list ? F.list() : [];
    for (const id of ids) {
      const held = holdings.get(id); if (!held || !held.length) continue;
      const def = F.get(id), stance = F.vsPlayer(id);
      ctx.fillStyle = "#" + (((def && def.color) || 0x97a4ac) & 0xffffff).toString(16).padStart(6, "0");
      ctx.fillRect(x0 + 14, y - 9, 11, 11);
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(x0 + 14, y - 9, 11, 11);
      ctx.fillStyle = "#e7eefb"; ctx.font = "600 12px ui-monospace, 'Consolas', monospace";
      ctx.fillText((def && def.name) || id, x0 + 32, y);
      const sc = stance === "enemy" ? "#d9774a" : stance === "ally" ? "#62c98a" : "#97a4ac";
      ctx.fillStyle = sc; ctx.font = "9px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "right";
      ctx.fillText(stance.toUpperCase(), this._w - 12, y);
      ctx.textAlign = "left"; y += 15;
      ctx.fillStyle = "#9fb0c2"; ctx.font = "10px ui-monospace, 'Consolas', monospace";
      for (const nm of held) { ctx.fillText("› " + nm.toUpperCase(), x0 + 22, y); this._sidebarHits.push({ x: x0 + 18, y: y - 10, w: this._right - 26, h: 13, island: nm }); y += 13; }
      y += 7;
    }

    // Flight plan (clickable; selects the waypoint).
    const route = this._route();
    if (route.length) {
      HEAD("// FLIGHT PLAN", y); y += 16;
      ctx.font = "10px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "left";
      for (let i = 0; i < route.length && y < H - 120; i++) {
        const w = route[i], ty = wptType(w.type);
        if (this._selWpt === i) { ctx.fillStyle = "rgba(255,210,63,0.12)"; ctx.fillRect(x0 + 8, y - 10, this._right - 16, 13); }
        ctx.fillStyle = css(ty.color); ctx.fillText(String(i + 1).padStart(2, "0") + " " + ty.label, x0 + 14, y);
        if (w.snap) { ctx.fillStyle = "#90a2b2"; ctx.fillText("▸ " + w.snap.toUpperCase(), x0 + 74, y); }
        this._sidebarHits.push({ x: x0 + 8, y: y - 10, w: this._right - 16, h: 13, wpt: i });
        y += 13;
      }
      y += 8;
    }

    // Symbol key.
    y = Math.max(y, H - 100);
    HEAD("// LEGEND", y); y += 16;
    const key = [["runway", "AIRFIELD"], ["carrier", "CARRIER"], ["sam", "SAM"], ["radar", "RADAR"], ["aa", "AA"], ["powerplant", "POWER PLANT"]];
    ctx.font = "10px ui-monospace, 'Consolas', monospace";
    for (const [k, lbl] of key) {
      this._symbol(k, x0 + 20, y - 3, "#b9c6d2", false, false);
      ctx.fillStyle = "#b9c6d2"; ctx.fillText(lbl, x0 + 34, y); y += 14;
    }
  }

  _tooltip() {
    if (!this._mouse || !this._markers.length) return;
    const m = this._mouse; let best = null, bd = Infinity;
    for (const k of this._markers) { const dx = k.x - m.x, dy = k.y - m.y, d = dx * dx + dy * dy; if (d < k.r * k.r && d < bd) { bd = d; best = k; } }
    if (!best) return;
    const ctx = this.ctx;
    const lines = [best.label.toUpperCase()];
    if (best.dead) lines.push("DESTROYED");
    else if (best.range) lines.push("LETHAL RADIUS " + (best.range / 1000).toFixed(1) + " KM");
    ctx.font = "11px ui-monospace, 'Consolas', monospace";
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const th = 6 + lines.length * 15;
    let tx = best.x + 12, ty = best.y - th - 8;
    if (tx + tw > this._w) tx = best.x - tw - 12;
    if (ty < this._top) ty = best.y + 12;
    ctx.fillStyle = "rgba(6,11,17,0.95)"; ctx.strokeStyle = "rgba(120,200,224,0.4)"; ctx.lineWidth = 1;
    ctx.fillRect(tx, ty, tw, th); ctx.strokeRect(tx, ty, tw, th);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    lines.forEach((l, i) => { ctx.fillStyle = i ? "#d9774a" : "#eaf4fb"; ctx.font = "11px ui-monospace, 'Consolas', monospace"; ctx.fillText(l, tx + 8, ty + 16 + i * 15); });
  }

  _hitIsland(px, py) {
    const wx = this._tf.toWX(px), wz = this._tf.toWZ(py);
    let best = null, bd = Infinity;
    for (const is of this._islands()) {
      const d = Math.hypot(wx - is.center.x, wz - is.center.z);
      if (d < is.outer * 1.15 && d < bd) { bd = d; best = is; }
    }
    return best;
  }
  _onClick(e) {
    if (!this.isOpen || !this._tf) return;
    const p = this._evtPos(e);
    if (this.opts.onPick) { const is = this._hitIsland(p.x, p.y); if (is) this.opts.onPick(is.name); return; }
    if (this._suppressClick) { this._suppressClick = false; return; } // finished a waypoint drag
    if (this._dragMoved) { this._dragMoved = false; return; }          // that was a pan
    for (const h of this._sidebarHits) {
      if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
        if (h.wpt != null) { if (this.editable) { this._selWpt = h.wpt; if (this.opts.onSelectWaypoint) this.opts.onSelectWaypoint(h.wpt); this.draw(); } }
        else if (h.island) this._zoomToIsland(h.island);
        return;
      }
    }
    if (this.routeMode) {
      const wi = this._hitWaypoint(p.x, p.y);
      if (wi >= 0) { this._selWpt = wi; if (this.opts.onSelectWaypoint) this.opts.onSelectWaypoint(wi); this.draw(); return; }
      if (this.opts.onRouteAdd) { this.opts.onRouteAdd(this._tf.toWX(p.x), this._tf.toWZ(p.y), this._insertIndex(p.x, p.y)); this.draw(); return; }
    }
    const is = this._hitIsland(p.x, p.y);
    if (is) this._zoomToIsland(is.name);
  }
  setWptSel(i) { this._selWpt = i; }
  clearWptSel() { this._selWpt = null; if (this.isOpen) this.draw(); }
  _route() { return (this.opts.getRoute && this.opts.getRoute()) || []; }
  _hitWaypoint(px, py) {
    const r = this._route(), tf = this._tf; if (!tf) return -1;
    for (let i = 0; i < r.length; i++) { if (Math.hypot(tf.toX(r[i].x) - px, tf.toY(r[i].z) - py) < 11) return i; }
    return -1;
  }
  _insertIndex(px, py) {
    const r = this._route(), tf = this._tf; if (r.length < 2) return null;
    let bestI = null, bd = 14;
    for (let i = 0; i < r.length - 1; i++) {
      const ax = tf.toX(r[i].x), ay = tf.toY(r[i].z), bx = tf.toX(r[i + 1].x), by = tf.toY(r[i + 1].z);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < bd) { bd = d; bestI = i + 1; }
    }
    return bestI;
  }
  _zoomToIsland(name) {
    const is = this._islands().find((i) => i.name === name);
    if (!is || !this.cam) return;
    const availW = this._w - this._right, availH = this._h - this._top;
    const s = Math.min(availW, availH) / (is.outer * 2 * 1.35);
    this.cam = { cx: is.center.x, cz: is.center.z, s: Math.max(this._minS, Math.min(this._maxS, s)) };
    this.draw();
  }

  // Island captions (always on, tactical caps) + zoom-gated item descriptors,
  // both greedily placed to avoid overlap; items get leader lines.
  _drawLabels(isl, feats, tf, showItems) {
    const ctx = this.ctx, placed = [], F = this.opts.getFactions();
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = "700 12px ui-monospace, 'Consolas', monospace";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2.5px";
    for (const is of isl) {
      const name = is.name.toUpperCase();
      const x = tf.toX(is.center.x), y = tf.toY(is.center.z + is.outer) + 18;
      if (x < -90 || x > this._w + 90 || y < this._top + 6 || y > this._h + 20) continue;
      const w = ctx.measureText(name).width;
      const stance = F ? F.vsPlayer(this.opts.factionOf(is.name)) : "neutral";
      const sc = stance === "enemy" ? "#d9774a" : stance === "ally" ? "#62c98a" : "#9fb6c4";
      const x0 = x - w / 2 - 7, x1 = x + w / 2 + 7, uy = y + 5;
      ctx.strokeStyle = sc; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.85; // bracket underline
      ctx.beginPath(); ctx.moveTo(x0, uy - 4); ctx.lineTo(x0, uy); ctx.lineTo(x1, uy); ctx.lineTo(x1, uy - 4); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(2,6,10,0.7)"; ctx.fillText(name, x + 1, y + 1);
      ctx.fillStyle = "#eef5fb"; ctx.fillText(name, x, y);
      placed.push({ x: x0, y: y - 12, w: x1 - x0, h: 22 });
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.restore();
    if (showItems) {
      ctx.font = "11px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "left";
      for (const f of feats) {
        if (f.x < -40 || f.x > this._w + 40 || f.y < this._top - 20 || f.y > this._h + 20) continue;
        const is = this._islandAt(f.wx, f.wz);
        if (is) this._placeLabel(f, is, tf, placed);
      }
    }
  }
  // Planned route: dashed legs (heading/distance labelled), typed waypoint pucks,
  // and a plan summary (count / range / ETA).
  _drawRoute(tf) {
    const route = this._route();
    if (!route.length) return;
    const ctx = this.ctx, detail = this.embedded ? false : (this.cam && this.cam.s > this._fitS * 1.4);
    ctx.save();
    ctx.strokeStyle = "rgba(120,210,255,0.7)"; ctx.lineWidth = 1.6; ctx.setLineDash([7, 5]); ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < route.length; i++) { const X = tf.toX(route[i].x), Y = tf.toY(route[i].z); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke(); ctx.setLineDash([]);
    // Leg heading + distance at each midpoint.
    let total = 0;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "9px ui-monospace, 'Consolas', monospace";
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1]; total += legDist(a, b);
      if (!detail) continue;
      const mx = (tf.toX(a.x) + tf.toX(b.x)) / 2, my = (tf.toY(a.z) + tf.toY(b.z)) / 2;
      const txt = `${String(legBearing(a, b)).padStart(3, "0")}° ${(legDist(a, b) / 1000).toFixed(1)}km`;
      const w = ctx.measureText(txt).width + 6;
      ctx.fillStyle = "rgba(6,12,20,0.8)"; ctx.fillRect(mx - w / 2, my - 7, w, 13);
      ctx.fillStyle = "#9fd6e6"; ctx.fillText(txt, mx, my + 0.5);
    }
    // Typed waypoint pucks: a clear icon (box=nav, diamond=ip, reticle=attack,
    // chevron=rtb) with its sequence number above and its type label below.
    for (let i = 0; i < route.length; i++) {
      const w = route[i], X = tf.toX(w.x), Y = tf.toY(w.z), ty = wptType(w.type), col = css(ty.color), sel = this._selWpt === i;
      const s = 9;
      if (sel) { ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, s + 6, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "rgba(6,14,22,0.92)"; ctx.strokeStyle = col; ctx.lineWidth = 1.8;
      this._wptGlyph(w.type, X, Y, s, col);
      ctx.fillStyle = col; ctx.font = "700 9px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), X, Y - s - 7);
      ctx.textBaseline = "top"; ctx.font = "8px ui-monospace, 'Consolas', monospace"; ctx.fillStyle = col;
      ctx.fillText(ty.label, X, Y + s + 3);
      if (detail || sel) {
        if (w.snap) { ctx.fillStyle = "#9fb0c2"; ctx.fillText("▸ " + w.snap.toUpperCase(), X, Y + s + 13); }
        ctx.fillStyle = "#8698a8"; ctx.fillText(Math.round(w.alt) + "m", X, Y + s + (w.snap ? 23 : 13));
      }
    }
    // Plan summary chip (top-left of the map area).
    if (!this.embedded) {
      const eta = total / PLAN_SPEED, mm = Math.floor(eta / 60), ss = Math.round(eta % 60);
      const txt = `PLAN ▸ ${route.length} WPT · ${(total / 1000).toFixed(1)} KM · ETA ${mm}:${String(ss).padStart(2, "0")}`;
      ctx.font = "700 11px ui-monospace, 'Consolas', monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const w = ctx.measureText(txt).width + 16;
      ctx.fillStyle = "rgba(6,11,17,0.82)"; ctx.fillRect(12, this._top + 10, w, 22);
      ctx.strokeStyle = "rgba(120,200,224,0.3)"; ctx.lineWidth = 1; ctx.strokeRect(12.5, this._top + 10.5, w - 1, 21);
      ctx.fillStyle = "#cfe7f0"; ctx.fillText(txt, 20, this._top + 21);
    }
    ctx.restore();
  }
  _wptGlyph(type, X, Y, s, col) {
    const ctx = this.ctx;
    if (type === "attack") {                 // target reticle + centre dot
      ctx.beginPath(); ctx.arc(X, Y, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = col; ctx.beginPath();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.moveTo(X + dx * (s - 1), Y + dy * (s - 1)); ctx.lineTo(X + dx * (s + 4), Y + dy * (s + 4)); }
      ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X, Y, 2, 0, Math.PI * 2); ctx.fill();
    } else if (type === "ip") {               // diamond
      ctx.beginPath(); ctx.moveTo(X, Y - s); ctx.lineTo(X + s, Y); ctx.lineTo(X, Y + s); ctx.lineTo(X - s, Y); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (type === "rtb") {               // down chevron (home)
      ctx.beginPath(); ctx.moveTo(X - s, Y - s * 0.55); ctx.lineTo(X + s, Y - s * 0.55); ctx.lineTo(X, Y + s); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {                                   // nav box
      ctx.beginPath(); ctx.rect(X - s * 0.8, Y - s * 0.8, s * 1.6, s * 1.6); ctx.fill(); ctx.stroke();
    }
  }
  _overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  _islandAt(wx, wz) { let best = null, bd = Infinity; for (const is of this._islands()) { const d = Math.hypot(wx - is.center.x, wz - is.center.z); if (d < bd) { bd = d; best = is; } } return best; }
  // Place an item label OUTSIDE its island, pushed radially out from the island
  // centre (with a leader line back), so the island itself stays unobstructed.
  _placeLabel(f, is, tf, placed) {
    const ctx = this.ctx, text = f.text.toUpperCase();
    const w = ctx.measureText(text).width + 8, h = 16, right = this._w - this._right;
    const cxS = tf.toX(is.center.x), cyS = tf.toY(is.center.z), R = is.outer * tf.s;
    let ux = f.x - cxS, uy = f.y - cyS; const len = Math.hypot(ux, uy) || 1;
    if (len < 1) { ux = 0; uy = -1; } else { ux /= len; uy /= len; }
    let rect = null, ax = 0, ay = 0;
    for (const dStep of [12, 26, 42, 60, 80, 104]) {
      for (const aoff of [0, 0.22, -0.22, 0.45, -0.45, 0.72, -0.72, 1.0, -1.0]) {
        const ca = Math.cos(aoff), sa = Math.sin(aoff);
        const rx = ux * ca - uy * sa, ry = ux * sa + uy * ca;
        const D = Math.min(Math.max(len, R), len + 72) + dStep; // outside the island, but stay near the item when zoomed in
        ax = cxS + rx * D; ay = cyS + ry * D;
        const bx = rx >= 0 ? ax : ax - w, by = ay - h / 2;
        if (bx < 2 || bx + w > right - 2 || by < this._top + 2 || by + h > this._h - 2) continue;
        const cand = { x: bx, y: by, w, h };
        if (placed.some((p) => this._overlap(p, cand))) continue;
        rect = cand; break;
      }
      if (rect) break;
    }
    if (!rect) return; // no clean spot — drop it rather than cover the island
    placed.push(rect);
    const lx = f.x < rect.x ? rect.x : (f.x > rect.x + rect.w ? rect.x + rect.w : f.x);
    const ly = f.y < rect.y ? rect.y : (f.y > rect.y + rect.h ? rect.y + rect.h : f.y);
    ctx.strokeStyle = "rgba(190,212,228,0.4)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.fillStyle = "rgba(190,212,228,0.9)"; ctx.beginPath(); ctx.arc(f.x, f.y, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(6,11,17,0.88)"; ctx.fillRect(rect.x, rect.y, w, h);
    ctx.strokeStyle = "rgba(120,200,224,0.3)"; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, w - 1, h - 1);
    ctx.fillStyle = "#cfe1ee"; ctx.textBaseline = "middle"; ctx.fillText(text, rect.x + 5, rect.y + h / 2); ctx.textBaseline = "alphabetic";
  }
}
