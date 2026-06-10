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

import { getWorldConfig, terrainHeight, SEA_LEVEL } from "./world.js";

const SIDE_COL = { hostile: "#d9774a", friendly: "#62c98a", neutral: "#97a4ac" };

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
    this._top = this.embedded ? 0 : 40;       // header band
    this._right = this.embedded ? 0 : 216;     // sidebar width
    this._onResize = () => { if (this.isOpen) { this._size(); this.draw(); } };
    canvas.addEventListener("click", (e) => this._onClick(e));
    canvas.addEventListener("mousemove", (e) => { this._mouse = this._evtPos(e); if (this.isOpen) this.draw(); });
    canvas.addEventListener("mouseleave", () => { this._mouse = null; if (this.isOpen) this.draw(); });
    window.addEventListener("resize", this._onResize);
  }

  _islands() {
    return getWorldConfig().islands.map((is) => ({
      name: is.name, center: { x: is.center.x, z: is.center.z },
      outer: (is.terrain && is.terrain.islandOuter) || 9000,
    }));
  }

  open(islandName = null) {
    if (this.embedded) return;
    this.view.island = islandName; this.isOpen = true;
    this.canvas.parentElement.classList.remove("hidden");
    this._size(); this.draw();
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
    const at = (i, j) => H[j * (G + 1) + i];
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const h = at(i, j), idx = (j * G + i) * 4;
        if (h > sea) {
          const hx = at(Math.min(G, i + 1), j) - at(Math.max(0, i - 1), j);
          const hz = at(i, Math.min(G, j + 1)) - at(i, Math.max(0, j - 1));
          let nx = -hx, nz = -hz, ny = 2 * cell; const nl = Math.hypot(nx, ny, nz) || 1;
          let shade = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nl);
          shade = Math.min(1, (shade - 0.5) * 1.7 + 0.5);  // steepen: deep shadows, bright faces
          const b = 0.1 + 1.32 * Math.max(0, shade);       // high-contrast relief
          const e = Math.min(1, (h - sea) / 2000);         // peaks clearly lighter
          d[idx] = Math.min(255, (54 + 50 * e) * b);
          d[idx + 1] = Math.min(255, (74 + 44 * e) * b);
          d[idx + 2] = Math.min(255, (54 + 32 * e) * b);
          d[idx + 3] = 255;
        } else if (h > sea - 160) {                      // shore shelf
          d[idx] = 26; d[idx + 1] = 52; d[idx + 2] = 64; d[idx + 3] = 120;
        } else { d[idx + 3] = 0; }
      }
    }
    c.putImageData(img, 0, 0);
    const rec = { canvas: cv, R, coast: this._coastline(H, G, sea, R, is.center) };
    RASTERS.set(is.name, rec);
    return rec;
  }

  // Marching-squares isocontour of the shoreline -> world-space line segments
  // [x0,z0,x1,z1, ...]. Drawn as a crisp stroke, so it scales without blur.
  _coastline(H, G, t, R, center) {
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
  _setView() {
    const isl = this._islands();
    if (!this.embedded && this.view.island) {
      const is = isl.find((i) => i.name === this.view.island) || isl[0];
      const R = is.outer * 1.28;
      this._fit(is.center.x - R, is.center.x + R, is.center.z - R, is.center.z + R, 0.06);
    } else {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const is of isl) {
        minX = Math.min(minX, is.center.x - is.outer); maxX = Math.max(maxX, is.center.x + is.outer);
        minZ = Math.min(minZ, is.center.z - is.outer); maxZ = Math.max(maxZ, is.center.z + is.outer);
      }
      this._fit(minX, maxX, minZ, maxZ, this.embedded ? 0.06 : 0.08);
    }
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
    const zoomed = !this.embedded && this.view.island;
    this._markers = [];

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

    // Land (accurate hillshaded terrain).
    const isl = this._islands();
    ctx.imageSmoothingEnabled = true;
    const rasters = isl.map((is) => this._raster(is));
    for (let k = 0; k < isl.length; k++) {
      const is = isl[k], r = rasters[k];
      const x0 = tf.toX(is.center.x - r.R), y0 = tf.toY(is.center.z - r.R);
      const x1 = tf.toX(is.center.x + r.R), y1 = tf.toY(is.center.z + r.R);
      ctx.drawImage(r.canvas, x0, y0, x1 - x0, y1 - y0);
    }
    // Crisp vector coastline on top — sharp at any zoom. Two passes: a dark
    // underlay to deepen the water at the shore, then a bright line, so the
    // island pops off the ocean.
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    for (const r of rasters) {
      const seg = r.coast;
      for (let s = 0; s < seg.length; s += 4) {
        ctx.moveTo(tf.toX(seg[s]), tf.toY(seg[s + 1]));
        ctx.lineTo(tf.toX(seg[s + 2]), tf.toY(seg[s + 3]));
      }
    }
    ctx.strokeStyle = "#040d14"; ctx.lineWidth = zoomed ? 4 : 2.6; ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.strokeStyle = "#cfeaf2"; ctx.lineWidth = zoomed ? 1.6 : 1.0; ctx.globalAlpha = 1; ctx.stroke();

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
    }

    // Island name labels.
    for (const is of isl) {
      const x = tf.toX(is.center.x), ly = tf.toY(is.center.z + is.outer) + 4;
      ctx.fillStyle = "#d6e0ea"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = `${zoomed ? 15 : this.embedded ? 11 : 12}px system-ui, sans-serif`;
      ctx.fillText(is.name, x, ly);
    }

    // Your jet (in flight).
    const p = this.opts.getPlayer && this.opts.getPlayer();
    if (p) {
      const x = tf.toX(p.x), y = tf.toY(p.z);
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
    ctx.fillStyle = "rgba(5,10,16,0.78)"; ctx.fillRect(0, 0, W, this._top);
    ctx.fillStyle = "#dfe8f2"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.fillText(this.view.island ? `TACTICAL  ›  ${this.view.island}` : "TACTICAL MAP  ·  ARCHIPELAGO", 14, this._top / 2);
    ctx.textAlign = "right"; ctx.fillStyle = "#7e8da3"; ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(this.view.island ? "click to zoom out  ·  hover a site for detail  ·  Esc/O close"
      : "click an island to zoom  ·  hover a site for detail  ·  Esc/O close", W - 14, this._top / 2);
  }

  // Faction allegiance lives here, not on the terrain.
  _sidebar() {
    const ctx = this.ctx, F = this.opts.getFactions();
    const x0 = this._w - this._right, H = this._h;
    ctx.fillStyle = "rgba(6,11,17,0.82)"; ctx.fillRect(x0, this._top, this._right, H - this._top);
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.moveTo(x0, this._top); ctx.lineTo(x0, H); ctx.stroke();
    let y = this._top + 16;
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillStyle = "#8aa0b8"; ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("FORCES", x0 + 14, y); y += 16;

    // Group islands by current faction.
    const holdings = new Map();
    for (const is of this._islands()) { const fid = this.opts.factionOf(is.name); (holdings.get(fid) || holdings.set(fid, []).get(fid)).push(is.name); }
    const ids = F && F.list ? F.list() : [];
    for (const id of ids) {
      const held = holdings.get(id); if (!held || !held.length) continue;
      const def = F.get(id), stance = F.vsPlayer(id);
      ctx.fillStyle = "#" + (((def && def.color) || 0x97a4ac) & 0xffffff).toString(16).padStart(6, "0");
      ctx.fillRect(x0 + 14, y - 9, 11, 11);
      ctx.fillStyle = "#e7eefb"; ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText((def && def.name) || id, x0 + 32, y);
      const sc = stance === "enemy" ? "#d9774a" : stance === "ally" ? "#62c98a" : "#97a4ac";
      ctx.fillStyle = sc; ctx.font = "10px system-ui, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(stance.toUpperCase(), this._w - 12, y);
      ctx.textAlign = "left"; y += 15;
      ctx.fillStyle = "#9fb0c2"; ctx.font = "11px system-ui, sans-serif";
      for (const nm of held) { ctx.fillText("· " + nm, x0 + 22, y); y += 14; }
      y += 6;
    }

    // Symbol key.
    y = Math.max(y, H - 96);
    ctx.fillStyle = "#8aa0b8"; ctx.font = "700 11px system-ui, sans-serif"; ctx.fillText("LEGEND", x0 + 14, y); y += 15;
    const key = [["runway", "Airfield"], ["carrier", "Carrier"], ["sam", "SAM"], ["radar", "Radar"], ["aa", "AA"], ["powerplant", "Power plant"]];
    ctx.font = "11px system-ui, sans-serif";
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
    const lines = [best.label];
    if (best.dead) lines.push("destroyed");
    else if (best.range) lines.push("lethal radius " + (best.range / 1000).toFixed(1) + " km");
    ctx.font = "12px system-ui, sans-serif";
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const th = 6 + lines.length * 15;
    let tx = best.x + 12, ty = best.y - th - 8;
    if (tx + tw > this._w) tx = best.x - tw - 12;
    if (ty < this._top) ty = best.y + 12;
    ctx.fillStyle = "rgba(10,16,24,0.94)"; ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1;
    ctx.fillRect(tx, ty, tw, th); ctx.strokeRect(tx, ty, tw, th);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    lines.forEach((l, i) => { ctx.fillStyle = i ? "#d9774a" : "#eaf2ff"; ctx.font = i ? "11px system-ui, sans-serif" : "12px system-ui, sans-serif"; ctx.fillText(l, tx + 8, ty + 16 + i * 15); });
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
    if (this.view.island) { this.view.island = null; this.draw(); return; }
    const is = this._hitIsland(p.x, p.y);
    if (is) { this.view.island = is.name; this.draw(); }
  }
}
