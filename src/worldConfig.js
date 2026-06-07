// The world is a seamless archipelago: a list of islands, each self-contained
// (its features are stored in island-LOCAL coordinates) and placed at a world
// `center`. world.js reads this to build the scene and sample terrain, so the
// editor can mutate/export it without touching engine code.

// One island's content. center + faction + name + seed identify it; everything
// else describes its terrain and props in coordinates local to that island.
function island(o) {
  return {
    name: o.name,
    faction: o.faction,            // "ally" | "enemy" | "neutral"
    seed: o.seed,
    center: o.center,              // world position of this island's origin
    terrain: { islandInner: 7000, islandOuter: 9800, deep: -750 },
    forest: { extent: 10800, gridN: 96, maxTrees: 45000, perCell: 22, density: null },
    paint: { extent: 11000, gridN: 160, cells: null },
    cliff: { x: -6200, z: 1900, r: 620, h: 560 },
    river: {
      a1: 2200, f1: 0.00026, a2: 700, f2: 0.00091, phase: 1.3,
      bed: -14, surface: -9, inner: 140, outer: 440, extent: 6800, carveMax: 7800,
    },
    spawn: { flattenRadius: 1400, x: 0, z: 520 },
    carriers: o.carriers || [],
    settlements: [
      { kind: "town", x: 3200, z: -3500, radius: 2, spacing: 115, maxHeight: 150 },
      { kind: "town", x: -4200, z: 2600, radius: 2, spacing: 115, maxHeight: 140 },
      { kind: "town", x: 1600, z: 5200, radius: 2, spacing: 110, maxHeight: 130 },
      { kind: "city", x: 5200, z: 2600, radius: 3, spacing: 130, maxHeight: 230 },
      { kind: "city", x: -2600, z: -5200, radius: 3, spacing: 130, maxHeight: 240 },
      { kind: "village", x: -1000, z: 3400, radius: 1, spacing: 90, maxHeight: 70 },
      { kind: "village", x: 4200, z: -1200, radius: 1, spacing: 90, maxHeight: 70 },
      { kind: "village", x: -5400, z: -1800, radius: 1, spacing: 85, maxHeight: 60 },
      { kind: "village", x: 2200, z: 1200, radius: 1, spacing: 85, maxHeight: 70 },
    ],
    bridges: [-1600, 2600],
    roads: [
      [[60, 300], [1600, 5200], [5200, 2600]],
      [[60, -300], [-2600, -5200]],
      [[3200, -3500], [4200, -1200], [2200, 1200], [1600, 5200]],
      [[-1000, 3400], [-4200, 2600]],
    ],
    missionBases: o.missionBases || [],
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
      // Enemy island — strike targets + the enemy carrier, a flight east.
      island({
        name: "Ironhold", faction: "enemy", seed: 0x7c41a9, center: { x: 36000, z: 4000 },
        carriers: [{ team: "enemy", x: 1200, z: -12800, halfL: 330, halfW: 40 }],
        missionBases: [[0, -3800], [2600, -6500], [-2800, -5200]],
      }),
    ],
  };
}
