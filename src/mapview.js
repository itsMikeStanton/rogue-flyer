// Accurate top-down archipelago map. Unlike the stylized blobs in portrait.js,
// this rasterizes the REAL terrain — sampling terrainHeight() across each
// island's footprint and shading land above sea level — so the atolls, crescents,
// spirals and shattered shards all read true to how they actually fly. Built to
// be reused: a full-screen in-flight overlay now, the Conquest planner next.
//
// Each island is baked once into its own offscreen canvas (tinted by its current
// faction) and cached; re-baked only if that island changes hands. Overlays
// (defences, carriers, labels, your jet) are drawn live on top every frame.

import { getWorldConfig, terrainHeight, SEA_LEVEL, getMissionBases, getCarriers } from "./world.js";
import { drawEmblem } from "./factionEmblems.js";

const css = (n) => "#" + ((typeof n === "number" ? n : 0x8aa0b8) & 0xffffff).toString(16).padStart(6, "0");

export class MapView {
  // opts: { factionOf(name)->id, getFactions()->Factions, getPlayer()->{x,z,heading}|null, onClose() }
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;
    this.cache = new Map();      // island name -> { canvas, faction, R }
    this.view = { island: null }; // null = overview, else island name
    this.isOpen = false;
    this._tf = null;
    this._onResize = () => { if (this.isOpen) { this._size(); this.draw(); } };
    canvas.addEventListener("click", (e) => this._onClick(e));
    window.addEventListener("resize", this._onResize);
  }

  // World-config islands with their outer footprint radius (for sampling/fit).
  _islands() {
    return getWorldConfig().islands.map((is) => ({
      name: is.name, center: { x: is.center.x, z: is.center.z },
      outer: (is.terrain && is.terrain.islandOuter) || 9000,
    }));
  }
  _factionDef(name) {
    const F = this.opts.getFactions();
    return F ? F.get(this.opts.factionOf(name)) : null;
  }

  invalidate() { this.cache.clear(); }

  open(islandName = null) {
    this.view.island = islandName;
    this.isOpen = true;
    this.canvas.parentElement.classList.remove("hidden");
    this._size();
    this.draw();
  }
  close() {
    this.isOpen = false;
    this.canvas.parentElement.classList.add("hidden");
    if (this.opts.onClose) this.opts.onClose();
  }
  toggle() { this.isOpen ? this.close() : this.open(); }

  _size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w; this._h = h;
  }

  // --- terrain raster (cached per island) ----------------------------------
  _raster(is) {
    const fac = this.opts.factionOf(is.name);
    const hit = this.cache.get(is.name);
    if (hit && hit.faction === fac) return hit;
    const N = 176, R = is.outer * 1.06;
    const cv = document.createElement("canvas"); cv.width = cv.height = N;
    const c = cv.getContext("2d");
    const img = c.createImageData(N, N), d = img.data;
    const def = this._factionDef(is.name);
    const base = def && def.color != null ? def.color : 0x6f8aa0;
    const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
    for (let j = 0; j < N; j++) {
      const lz = (j / (N - 1) - 0.5) * 2 * R;
      for (let i = 0; i < N; i++) {
        const lx = (i / (N - 1) - 0.5) * 2 * R;
        const h = terrainHeight(is.center.x + lx, is.center.z + lz);
        const idx = (j * N + i) * 4;
        if (h > SEA_LEVEL) {
          const e = Math.min(1, (h - SEA_LEVEL) / 1400);
          const k = 0.5 + 0.62 * e;                 // low land dark, peaks bright
          d[idx] = Math.min(255, br * k); d[idx + 1] = Math.min(255, bg * k); d[idx + 2] = Math.min(255, bb * k); d[idx + 3] = 255;
        } else if (h > SEA_LEVEL - 140) {           // shallow shelf ring around the shore
          d[idx] = 54; d[idx + 1] = 110; d[idx + 2] = 140; d[idx + 3] = 150;
        } else { d[idx + 3] = 0; }
      }
    }
    c.putImageData(img, 0, 0);
    const rec = { canvas: cv, faction: fac, R };
    this.cache.set(is.name, rec);
    return rec;
  }

  // --- view transform ------------------------------------------------------
  _fit(minX, maxX, minZ, maxZ, pad = 0.08) {
    const W = this._w, H = this._h;
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const s = Math.min(W / spanX, H / spanZ) * (1 - pad * 2);
    const ox = (W - spanX * s) / 2 - minX * s;
    const oy = (H - spanZ * s) / 2 - minZ * s;
    this._tf = {
      s, ox, oy,
      toX: (x) => x * s + ox, toY: (z) => z * s + oy,
      toWX: (px) => (px - ox) / s, toWZ: (py) => (py - oy) / s,
    };
  }
  _setView() {
    const isl = this._islands();
    if (this.view.island) {
      const is = isl.find((i) => i.name === this.view.island) || isl[0];
      const R = is.outer * 1.28;
      this._fit(is.center.x - R, is.center.x + R, is.center.z - R, is.center.z + R, 0.06);
    } else {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const is of isl) {
        minX = Math.min(minX, is.center.x - is.outer); maxX = Math.max(maxX, is.center.x + is.outer);
        minZ = Math.min(minZ, is.center.z - is.outer); maxZ = Math.max(maxZ, is.center.z + is.outer);
      }
      this._fit(minX, maxX, minZ, maxZ, 0.1);
    }
  }

  // --- drawing -------------------------------------------------------------
  draw() {
    if (!this.isOpen) return;
    const ctx = this.ctx, W = this._w, H = this._h;
    this._setView();
    const tf = this._tf, F = this.opts.getFactions();

    // Ocean + grid.
    const og = ctx.createLinearGradient(0, 0, 0, H);
    og.addColorStop(0, "#0a1b28"); og.addColorStop(1, "#06121b");
    ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(120,150,170,0.08)"; ctx.lineWidth = 1;
    const step = 8000 * tf.s;
    if (step > 14) {
      const x0 = tf.toX(0) % step, y0 = tf.toY(0) % step;
      for (let x = x0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = y0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }

    // Land (accurate rasters), tinted by faction.
    const isl = this._islands();
    ctx.imageSmoothingEnabled = true;
    for (const is of isl) {
      const r = this._raster(is);
      const x0 = tf.toX(is.center.x - r.R), y0 = tf.toY(is.center.z - r.R);
      const x1 = tf.toX(is.center.x + r.R), y1 = tf.toY(is.center.z + r.R);
      ctx.drawImage(r.canvas, x0, y0, x1 - x0, y1 - y0);
    }

    // Carriers (faction/team coloured ships).
    for (const c of getCarriers()) {
      const x = tf.toX(c.x), y = tf.toY(c.z);
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = c.team === "ally" ? "#5bc8ff" : "#ff6b6b";
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(3, -7); ctx.lineTo(4, 7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Defences (mission-base clusters) as small hostile diamonds.
    const showDef = this.view.island == null ? tf.s > 0.004 : true;
    if (showDef) {
      for (const [wx, wz] of getMissionBases()) {
        const x = tf.toX(wx), y = tf.toY(wz), s = this.view.island ? 5 : 3;
        ctx.fillStyle = "rgba(255,90,90,0.92)";
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // Island labels + emblems, ringed by your stance toward them.
    for (const is of isl) {
      const def = this._factionDef(is.name);
      const fid = this.opts.factionOf(is.name);
      const stance = F ? F.vsPlayer(fid) : "neutral";
      const ring = stance === "enemy" ? "#ff6b6b" : stance === "ally" ? "#5bc8ff" : "#cbd5e0";
      const x = tf.toX(is.center.x), y = tf.toY(is.center.z);
      const er = this.view.island ? 18 : 11;
      if (def) drawEmblem(ctx, def.emblem, x, tf.toY(is.center.z - is.outer) - er - 4, er, def.color, { badge: true });
      ctx.fillStyle = "#e7eefb"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = `${this.view.island ? 15 : 12}px system-ui, sans-serif`;
      const ly = tf.toY(is.center.z + is.outer) + 4;
      ctx.fillText(is.name, x, ly);
      if (this.view.island === is.name && def) {
        ctx.fillStyle = css(def.color); ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(def.name + "  ·  " + stance.toUpperCase(), x, ly + 18);
      }
      // stance tick under the label
      ctx.fillStyle = ring;
      ctx.fillRect(x - 9, ly - 4, 18, 2);
    }

    // Your jet (in flight).
    const p = this.opts.getPlayer && this.opts.getPlayer();
    if (p) {
      const x = tf.toX(p.x), y = tf.toY(p.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.heading || 0);
      ctx.fillStyle = "#46ff9a"; ctx.strokeStyle = "#0a3b22"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    this._chrome();
  }

  // Header, legend, hint.
  _chrome() {
    const ctx = this.ctx, W = this._w;
    ctx.fillStyle = "rgba(5,10,16,0.72)"; ctx.fillRect(0, 0, W, 40);
    ctx.fillStyle = "#eaf2ff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "700 16px system-ui, sans-serif";
    ctx.fillText(this.view.island ? `ARCHIPELAGO  ›  ${this.view.island}` : "ARCHIPELAGO  ·  OVERVIEW", 16, 20);
    ctx.textAlign = "right"; ctx.fillStyle = "#8aa0b8"; ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(this.view.island ? "click to zoom out  ·  Esc/O to close" : "click an island to zoom  ·  Esc/O to close", W - 16, 20);

    // Faction legend (bottom-left).
    const F = this.opts.getFactions();
    if (F) {
      const ids = F.list ? F.list() : [];
      let ly = this._h - 12 - ids.length * 18;
      ctx.fillStyle = "rgba(5,10,16,0.66)"; ctx.fillRect(8, ly - 8, 188, ids.length * 18 + 14);
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = "12px system-ui, sans-serif";
      for (const id of ids) {
        const def = F.get(id); const stance = F.vsPlayer(id);
        ctx.fillStyle = css(def && def.color); ctx.fillRect(16, ly + 9 - 5, 10, 10);
        ctx.fillStyle = "#cdd7e6";
        ctx.fillText(`${(def && def.name) || id}  · ${stance}`, 32, ly + 9);
        ly += 18;
      }
    }
  }

  _onClick(e) {
    if (!this.isOpen || !this._tf) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (this.view.island) { this.view.island = null; this.draw(); return; } // zoom out
    // Overview: zoom into the nearest island whose footprint we clicked inside.
    const wx = this._tf.toWX(px), wz = this._tf.toWZ(py);
    let best = null, bd = Infinity;
    for (const is of this._islands()) {
      const dx = wx - is.center.x, dz = wz - is.center.z, d = Math.hypot(dx, dz);
      if (d < is.outer * 1.15 && d < bd) { bd = d; best = is; }
    }
    if (best) { this.view.island = best.name; this.draw(); }
  }
}
