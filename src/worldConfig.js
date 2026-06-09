// The world is a seamless archipelago: a list of islands, each self-contained
// (its features are stored in island-LOCAL coordinates) and placed at a world
// `center`. world.js reads this to build the scene and sample terrain, so the
// editor can mutate/export it without touching engine code.

// ---- Home island (Vanguard) signature layout, kept as the default when an
//      island doesn't override these fields. ----
const HOME_TERRAIN = { islandInner: 7000, islandOuter: 9800, deep: -750 };
const HOME_FOREST = { extent: 10800, gridN: 96, maxTrees: 45000, perCell: 22, density: null };
const HOME_CLIFF = { x: -6200, z: 1900, r: 620, h: 560 };
const HOME_SPAWN = { flattenRadius: 1900, x: 0, z: 520, flatCore: 1100, flatRamp: 800 };
const HOME_SETTLEMENTS = [
  { kind: "town", x: 3200, z: -3500, radius: 2, spacing: 115, maxHeight: 150 },
  { kind: "town", x: -4200, z: 2600, radius: 2, spacing: 115, maxHeight: 140 },
  { kind: "town", x: 1600, z: 5200, radius: 2, spacing: 110, maxHeight: 130 },
  { kind: "city", x: 5200, z: 2600, radius: 3, spacing: 130, maxHeight: 230 },
  { kind: "city", x: -2600, z: -5200, radius: 3, spacing: 130, maxHeight: 240 },
  { kind: "village", x: -1000, z: 3400, radius: 1, spacing: 90, maxHeight: 70 },
  { kind: "village", x: 4200, z: -1200, radius: 1, spacing: 90, maxHeight: 70 },
  { kind: "village", x: -5400, z: -1800, radius: 1, spacing: 85, maxHeight: 60 },
  { kind: "village", x: 2200, z: 1200, radius: 1, spacing: 85, maxHeight: 70 },
];
const HOME_ROADS = [
  [[60, 300], [1600, 5200], [5200, 2600]],
  [[60, -300], [-2600, -5200]],
  [[3200, -3500], [4200, -1200], [2200, 1200], [1600, 5200]],
  [[-1000, 3400], [-4200, 2600]],
];
const HOME_RIVER = {
  a1: 2200, f1: 0.00026, a2: 700, f2: 0.00091, phase: 1.3,
  bed: -14, surface: -9, inner: 140, outer: 440, extent: 6800, carveMax: 7800,
};

// One island's content. center + faction + name + seed identify it; everything
// else describes its terrain and props in coordinates local to that island.
// Any geometry field can be overridden by passing it in `o`; otherwise the
// home-island defaults are used so existing islands keep their look.
function island(o) {
  return {
    name: o.name,
    faction: o.faction,            // "ally" | "enemy" | "neutral"
    seed: o.seed,
    center: o.center,              // world position of this island's origin
    terrain: o.terrain || { ...HOME_TERRAIN },
    forest: o.forest || { ...HOME_FOREST },
    paint: o.paint || { extent: 11000, gridN: 160, cells: null },
    cliff: o.cliff || { ...HOME_CLIFF },
    river: o.river !== undefined ? o.river : { ...HOME_RIVER },
    spawn: o.spawn || { ...HOME_SPAWN },
    carriers: o.carriers || [],
    settlements: o.settlements || HOME_SETTLEMENTS.map((s) => ({ ...s })),
    bridges: o.bridges || [-1600, 2600],
    roads: o.roads || HOME_ROADS.map((r) => r.map((p) => [...p])),
    missionBases: o.missionBases || [],
    // Signature props. Home keeps the radio tower + lighthouse; other islands
    // can opt out (landmarks:false) and/or grow a glowing spire monument.
    landmarks: o.landmarks !== false,
    spire: !!o.spire,
  };
}

export function defaultWorldConfig() {
  return {
    seaLevel: -180,
    islands: [
      // Home — your base, with the ally carrier offshore.
      island({
        name: "Vanguard", faction: "ally", seed: 0x1f2e3d, center: { x: 0, z: 0 },
        carriers: [{ team: "ally", x: -1200, z: 11200, halfL: 330, halfW: 40 }],
      }),
      // Enemy island — Aerival: a colossal central peak crowned by a glowing
      // spire monument, ringed by a terraced megacity of tall towers. No
      // lighthouse/radio tower (those are home's signature); sparse forest on
      // the steep slopes. A flight east of home.
      island({
        name: "Aerival", faction: "enemy", seed: 0x9d34f1, center: { x: 36000, z: 4000 },
        carriers: [{ team: "enemy", x: 1200, z: -12800, halfL: 330, halfW: 40 }],
        missionBases: [[0, -4400], [3200, -6800], [-3400, -5600]],
        terrain: { islandInner: 6200, islandOuter: 11200, deep: -1000 },
        // Towering central massif. Offset clear of the origin spawn-flatten zone
        // (which is centred on local origin) so the summit isn't carved down;
        // local origin reads as a flat central plaza between the districts.
        cliff: { x: 1500, z: -1300, r: 1500, h: 1320 },
        spawn: { flattenRadius: 1100, x: 6400, z: 5200 },
        river: null, // no river carve
        landmarks: false,
        spire: true,
        // Sparse hardy forest clinging to the slopes.
        forest: { extent: 11200, gridN: 96, maxTrees: 18000, perCell: 12, density: null },
        // A ring of tall districts terraced around the peak's base.
        settlements: [
          { kind: "city", x: 3400, z: 1600, radius: 4, spacing: 132, maxHeight: 330 },
          { kind: "city", x: -3000, z: 2400, radius: 4, spacing: 132, maxHeight: 310 },
          { kind: "city", x: -1600, z: -3600, radius: 3, spacing: 128, maxHeight: 300 },
          { kind: "city", x: 3000, z: -2800, radius: 3, spacing: 128, maxHeight: 290 },
          { kind: "town", x: 5600, z: 4200, radius: 2, spacing: 120, maxHeight: 180 },
          { kind: "town", x: -5400, z: -1200, radius: 2, spacing: 120, maxHeight: 170 },
          { kind: "village", x: 1200, z: 5400, radius: 1, spacing: 95, maxHeight: 90 },
          { kind: "village", x: -2400, z: 5000, radius: 1, spacing: 95, maxHeight: 90 },
        ],
        bridges: [],
        // A ring boulevard linking the districts, with spokes toward the peak.
        roads: [
          [[3400, 1600], [5600, 4200], [1200, 5400], [-2400, 5000], [-3000, 2400], [-5400, -1200], [-1600, -3600], [3000, -2800], [3400, 1600]],
          [[3400, 1600], [1500, 200]],
          [[-3000, 2400], [-1100, 300]],
          [[-1600, -3600], [-200, -1400]],
          [[3000, -2800], [1100, -1100]],
        ],
      }),
    ],
  };
}
