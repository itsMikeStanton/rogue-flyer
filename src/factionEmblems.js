// Procedural faction logos — drawn, not loaded (the game ships no image assets).
// Each emblem is a simple geometric mark stroked in the faction's colour so it
// reads at any size: on the menu roster, on HUD island markers, on a flag.
//
//   drawEmblem(ctx, style, cx, cy, r, color)  — draw into an existing 2D context
//   emblemDataURL(style, size, color)         — a standalone PNG data URL (DOM <img>)
//
// `style` comes from a faction def's `emblem` field; unknown styles fall back to
// a generic ringed diamond so custom/runtime factions still get a badge.

function css(color) {
  if (typeof color === "number") return "#" + (color & 0xffffff).toString(16).padStart(6, "0");
  return color || "#cbd5e0";
}

// A faint filled disc behind the mark so it sits on any background.
function badge(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8,12,20,0.55)";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.strokeStyle = css(color);
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.restore();
}

const SHAPES = {
  // Vanguard Coalition — a shield with an upward chevron (aegis, defence).
  aegis(ctx, cx, cy, r, c) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.78);
    ctx.lineTo(cx + r * 0.62, cy - r * 0.5);
    ctx.lineTo(cx + r * 0.62, cy + r * 0.18);
    ctx.quadraticCurveTo(cx + r * 0.62, cy + r * 0.62, cx, cy + r * 0.82);
    ctx.quadraticCurveTo(cx - r * 0.62, cy + r * 0.62, cx - r * 0.62, cy + r * 0.18);
    ctx.lineTo(cx - r * 0.62, cy - r * 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.34, cy + r * 0.18);
    ctx.lineTo(cx, cy - r * 0.34);
    ctx.lineTo(cx + r * 0.34, cy + r * 0.18);
    ctx.stroke();
  },
  // Aerival Dominion — a crowned obelisk/spire rising to a glowing diamond.
  spire(ctx, cx, cy, r, c) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.26, cy + r * 0.72);
    ctx.lineTo(cx - r * 0.1, cy - r * 0.28);
    ctx.lineTo(cx + r * 0.1, cy - r * 0.28);
    ctx.lineTo(cx + r * 0.26, cy + r * 0.72);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); // crowning diamond
    ctx.moveTo(cx, cy - r * 0.82);
    ctx.lineTo(cx + r * 0.24, cy - r * 0.5);
    ctx.lineTo(cx, cy - r * 0.18);
    ctx.lineTo(cx - r * 0.24, cy - r * 0.5);
    ctx.closePath();
    ctx.fillStyle = css(c); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
  },
  // Stormcrown Legion — a lightning bolt beneath a three-point crown.
  bolt(ctx, cx, cy, r, c) {
    ctx.beginPath(); // crown
    ctx.moveTo(cx - r * 0.5, cy - r * 0.34);
    ctx.lineTo(cx - r * 0.5, cy - r * 0.66);
    ctx.lineTo(cx - r * 0.25, cy - r * 0.42);
    ctx.lineTo(cx, cy - r * 0.74);
    ctx.lineTo(cx + r * 0.25, cy - r * 0.42);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.66);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.34);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); // bolt
    ctx.moveTo(cx + r * 0.18, cy - r * 0.18);
    ctx.lineTo(cx - r * 0.22, cy + r * 0.2);
    ctx.lineTo(cx + r * 0.04, cy + r * 0.2);
    ctx.lineTo(cx - r * 0.18, cy + r * 0.74);
    ctx.lineTo(cx + r * 0.3, cy + r * 0.06);
    ctx.lineTo(cx + r * 0.02, cy + r * 0.06);
    ctx.closePath();
    ctx.fillStyle = css(c); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
  },
  // The Aerie — a downward talon / stooping raptor over its mesa.
  talon(ctx, cx, cy, r, c) {
    ctx.beginPath(); // spread wings
    ctx.moveTo(cx - r * 0.72, cy - r * 0.34);
    ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.5, cx, cy - r * 0.06);
    ctx.quadraticCurveTo(cx + r * 0.18, cy - r * 0.5, cx + r * 0.72, cy - r * 0.34);
    ctx.stroke();
    for (const s of [-1, 0, 1]) { // three talons stooping down
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.26, cy - r * 0.02);
      ctx.quadraticCurveTo(cx + s * r * 0.32, cy + r * 0.44, cx + s * r * 0.12, cy + r * 0.74);
      ctx.stroke();
    }
  },
  // Coral League — an anchor inside a harbour ring (free ports, trade).
  ring(ctx, cx, cy, r, c) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath(); // anchor: shank + crossbar + crown + flukes
    ctx.moveTo(cx, cy - r * 0.46);
    ctx.lineTo(cx, cy + r * 0.42);
    ctx.moveTo(cx - r * 0.28, cy - r * 0.18);
    ctx.lineTo(cx + r * 0.28, cy - r * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.5, r * 0.12, 0, Math.PI * 2); // ring at the top
    ctx.stroke();
    ctx.beginPath(); // flukes
    ctx.moveTo(cx - r * 0.4, cy + r * 0.16);
    ctx.quadraticCurveTo(cx - r * 0.36, cy + r * 0.5, cx, cy + r * 0.44);
    ctx.quadraticCurveTo(cx + r * 0.36, cy + r * 0.5, cx + r * 0.4, cy + r * 0.16);
    ctx.stroke();
  },
  // Fallback — a ringed diamond, so any faction has a usable badge.
  default(ctx, cx, cy, r, c) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.62);
    ctx.lineTo(cx + r * 0.62, cy);
    ctx.lineTo(cx, cy + r * 0.62);
    ctx.lineTo(cx - r * 0.62, cy);
    ctx.closePath();
    ctx.stroke();
  },
};

export function drawEmblem(ctx, style, cx, cy, r, color, opts = {}) {
  const shape = SHAPES[style] || SHAPES.default;
  if (opts.badge !== false) badge(ctx, cx, cy, r, color);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, r * (opts.weight || 0.12));
  ctx.strokeStyle = css(color);
  shape(ctx, cx, cy, r * 0.82, color);
  ctx.restore();
}

// Standalone PNG for a DOM <img>. Returns "" outside a browser.
export function emblemDataURL(style, size = 64, color = "#cbd5e0") {
  if (typeof document === "undefined") return "";
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  drawEmblem(ctx, style, size / 2, size / 2, size / 2 - 2, color);
  return cv.toDataURL("image/png");
}
