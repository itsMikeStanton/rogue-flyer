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
    // Macro coastline shape (atoll / lobes / crescent / spiral / ridges /
    // shatter); null = the original radial blob. Read by world.js islandHeight.
    shape: o.shape || null,
    // Signature props. Home keeps the radio tower + lighthouse; other islands
    // can opt out (landmarks:false) and/or grow a glowing spire monument.
    landmarks: o.landmarks !== false,
    spire: !!o.spire,
  };
}

export function defaultWorldConfig() {
  return {
    seaLevel: -180,
    // ---- Factions: who is allied / neutral / hostile to whom. Each island below
    //      carries a `faction` id; the player flies for `playerFaction`. Stances
    //      are symmetric and sparse — a faction is allied with itself, an unlisted
    //      pair uses `defaultStance`, and [a, b, stance] rows override a pair.
    //      These three built-ins reproduce the classic world (you + allies vs. the
    //      hostiles, with neutrals who only fight if provoked). To stage a new war,
    //      add faction ids here and assign them to islands. ----
    factions: {
      ally:    { name: "Allied Command", color: 0x7fd2ff },
      enemy:   { name: "Hostile Forces", color: 0xff6b6b },
      neutral: { name: "Neutral States", color: 0xcbd5e0 },
    },
    playerFaction: "ally",
    defaultStance: "neutral",         // unlisted faction pairs default to neutral
    stances: [
      ["ally", "enemy", "enemy"],     // the one standing hostility in the base world
    ],
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

      // ============ 7 wild islands — distinct macro shapes (world.js shapeField) ============

      // Coral Halo — an ATOLL: a wobbling reef ring around a turquoise lagoon,
      // with a lone airstrip islet flattened at its heart. Neutral free port.
      island({
        name: "Coral Halo", faction: "neutral", seed: 0x10ffa3, center: { x: -38000, z: 8000 },
        terrain: { islandInner: 6000, islandOuter: 9000, deep: -650 },
        shape: { type: "atoll", ring: 5200, width: 1500, ramp: 650, lagoon: 900, wobble: 5 },
        cliff: { x: 0, z: 5200, r: 850, h: 460 }, // a beacon knoll on the reef
        spawn: { flattenRadius: 1700, x: 0, z: 0, flatCore: 1100, flatRamp: 550 },
        forest: { extent: 9000, gridN: 80, maxTrees: 7000, perCell: 10, density: null },
        river: null, landmarks: false, roads: [], bridges: [],
        settlements: [
          { kind: "town", x: 5000, z: 700, radius: 2, spacing: 110, maxHeight: 120 },
          { kind: "town", x: -3700, z: 3700, radius: 2, spacing: 110, maxHeight: 110 },
          { kind: "village", x: 900, z: -5100, radius: 1, spacing: 90, maxHeight: 70 },
          { kind: "village", x: -5000, z: -1400, radius: 1, spacing: 90, maxHeight: 70 },
          { kind: "village", x: 3600, z: -3700, radius: 1, spacing: 90, maxHeight: 70 },
        ],
        missionBases: [[5000, 600], [-3800, 3700], [800, -5100]],
      }),

      // Medusa — a 6-armed STARFISH reaching long peninsulas into deep channels,
      // a central massif beside the strip. Enemy stronghold (glowing spire).
      island({
        name: "Medusa", faction: "enemy", seed: 0x6a11dd, center: { x: 12000, z: 40000 },
        terrain: { islandInner: 4400, islandOuter: 7800, deep: -950 },
        shape: { type: "lobes", arms: 6, amp: 0.42, phase: 0.4 },
        cliff: { x: 2200, z: 0, r: 1500, h: 880 },
        spawn: { flattenRadius: 1650, x: 0, z: 0, flatCore: 1050, flatRamp: 550 },
        forest: { extent: 11000, gridN: 96, maxTrees: 16000, perCell: 14, density: null },
        river: null, landmarks: false, spire: true, roads: [], bridges: [],
        settlements: [
          { kind: "city", x: 9000, z: 0, radius: 3, spacing: 128, maxHeight: 260 },
          { kind: "town", x: 4500, z: 7800, radius: 2, spacing: 120, maxHeight: 170 },
          { kind: "town", x: -4500, z: 7800, radius: 2, spacing: 120, maxHeight: 170 },
          { kind: "city", x: -9000, z: 0, radius: 3, spacing: 128, maxHeight: 250 },
          { kind: "town", x: -4500, z: -7800, radius: 2, spacing: 120, maxHeight: 170 },
          { kind: "town", x: 4500, z: -7800, radius: 2, spacing: 120, maxHeight: 170 },
        ],
        missionBases: [[8500, 0], [4200, 7300], [-8500, 0], [-4200, -7300]],
      }),

      // Halfmoon — a CRESCENT: a horseshoe wrapping a sheltered south bay. Ally
      // outpost.
      island({
        name: "Halfmoon", faction: "ally", seed: 0x33aa77, center: { x: -20000, z: -38000 },
        terrain: { islandInner: 6500, islandOuter: 10000, deep: -800 },
        shape: { type: "crescent", biteX: 0, biteZ: -7200, biteR: 5200 },
        cliff: { x: 0, z: 5600, r: 1200, h: 600 }, // headland on the back of the horseshoe
        spawn: { flattenRadius: 1650, x: 0, z: 0, flatCore: 1050, flatRamp: 550 },
        forest: { extent: 10000, gridN: 96, maxTrees: 20000, perCell: 16, density: null },
        river: null, landmarks: false, roads: [], bridges: [],
        settlements: [
          { kind: "city", x: 0, z: 5200, radius: 3, spacing: 130, maxHeight: 240 },
          { kind: "town", x: 5200, z: 1600, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "town", x: -5200, z: 1600, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "town", x: 6200, z: -3200, radius: 2, spacing: 115, maxHeight: 140 },
          { kind: "town", x: -6200, z: -3200, radius: 2, spacing: 115, maxHeight: 140 },
          { kind: "village", x: 3200, z: 4200, radius: 1, spacing: 90, maxHeight: 80 },
        ],
        missionBases: [],
      }),

      // Gemini — TWIN PEAKS flanking a valley airstrip in the saddle; one summit
      // is a sheer cliff topped by a spire. Enemy.
      island({
        name: "Gemini", faction: "enemy", seed: 0x9e2255, center: { x: 54000, z: -30000 },
        terrain: { islandInner: 6000, islandOuter: 9500, deep: -1000 },
        shape: { type: "ridges", peaks: [{ x: -2900, z: 200, h: 980, r: 1700 }, { x: 2900, z: -200, h: 900, r: 1600 }] },
        cliff: { x: -2900, z: 200, r: 1000, h: 1010 },
        spawn: { flattenRadius: 1700, x: 0, z: 0, flatCore: 1100, flatRamp: 550 },
        forest: { extent: 9500, gridN: 96, maxTrees: 22000, perCell: 16, density: null },
        river: null, landmarks: false, spire: true, roads: [], bridges: [],
        settlements: [
          { kind: "city", x: 0, z: 3600, radius: 3, spacing: 130, maxHeight: 230 },
          { kind: "town", x: 0, z: -4200, radius: 2, spacing: 120, maxHeight: 170 },
          { kind: "town", x: 5200, z: 3200, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "town", x: -5200, z: 3200, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "village", x: 5000, z: -3600, radius: 1, spacing: 95, maxHeight: 90 },
        ],
        missionBases: [[0, 3600], [-4400, -3000], [4400, -3000]],
      }),

      // Aerie — a SKY MESA: a tiny footprint rising as sheer cliffs to a flat
      // tableland city at 900m, runway right on the deck. Enemy eyrie.
      island({
        name: "Aerie", faction: "enemy", seed: 0xc0ffee, center: { x: 70000, z: 18000 },
        terrain: { islandInner: 2700, islandOuter: 3500, deep: -1200 },
        cliff: { x: 0, z: 0, r: 2400, h: 900 }, // the whole top is one flat table at 900m
        spawn: { flattenRadius: 0, x: 0, z: 0 }, // no flatten — the cliff top IS the flat runway deck
        forest: { extent: 3500, gridN: 64, maxTrees: 2500, perCell: 8, density: null },
        river: null, landmarks: false, roads: [], bridges: [],
        settlements: [
          { kind: "city", x: 0, z: 1100, radius: 3, spacing: 120, maxHeight: 300 },
          { kind: "town", x: 1300, z: -1100, radius: 2, spacing: 110, maxHeight: 200 },
          { kind: "town", x: -1300, z: -1100, radius: 2, spacing: 110, maxHeight: 200 },
        ],
        missionBases: [[0, 1100], [1300, -1000], [-1300, -1000]],
      }),

      // Maelstrom — a SPIRAL ridge of stone winding inward to a calm "eye" where
      // the runway sits; a headland on the outer arm wears a spire. Enemy.
      island({
        name: "Maelstrom", faction: "enemy", seed: 0x5e7a91, center: { x: -58000, z: -10000 },
        terrain: { islandInner: 6000, islandOuter: 9200, deep: -1000 },
        shape: { type: "spiral", spiralR: 6200, turns: 2.6, pitch: 1500, height: 820 },
        cliff: { x: 4400, z: 2600, r: 1100, h: 980 },
        spawn: { flattenRadius: 1650, x: 0, z: 0, flatCore: 1050, flatRamp: 550 },
        forest: { extent: 9200, gridN: 96, maxTrees: 14000, perCell: 13, density: null },
        river: null, landmarks: false, spire: true, roads: [], bridges: [],
        settlements: [
          { kind: "city", x: 4400, z: 2600, radius: 3, spacing: 128, maxHeight: 240 },
          { kind: "town", x: -3800, z: 3400, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "town", x: -3600, z: -3800, radius: 2, spacing: 120, maxHeight: 160 },
          { kind: "village", x: 2600, z: -3600, radius: 1, spacing: 95, maxHeight: 90 },
        ],
        missionBases: [[4400, 2600], [-3800, 3400], [-3600, -3800]],
      }),

      // The Splinters — a SHATTERED archipelago: scattered islets and shallow
      // channels you weave between, a sea-stack on one shard. Neutral.
      island({
        name: "The Splinters", faction: "neutral", seed: 0x2b7733, center: { x: 28000, z: -52000 },
        terrain: { islandInner: 6000, islandOuter: 9500, deep: -600 },
        shape: { type: "shatter", regionInner: 5000, regionOuter: 9500, scale: 0.0009, thresh: 0.5, sharp: 8 },
        cliff: { x: 3400, z: -2200, r: 700, h: 580 }, // a sea-stack (guaranteed land for the strike base)
        spawn: { flattenRadius: 1650, x: 0, z: 0, flatCore: 1050, flatRamp: 550 },
        forest: { extent: 9500, gridN: 88, maxTrees: 9000, perCell: 11, density: null },
        river: null, landmarks: false, roads: [], bridges: [],
        settlements: [
          { kind: "town", x: 3200, z: 2400, radius: 2, spacing: 110, maxHeight: 130 },
          { kind: "town", x: -3600, z: -1800, radius: 2, spacing: 110, maxHeight: 120 },
          { kind: "village", x: 1600, z: -4200, radius: 1, spacing: 90, maxHeight: 70 },
          { kind: "village", x: -2400, z: 3800, radius: 1, spacing: 90, maxHeight: 70 },
          { kind: "village", x: 5200, z: 600, radius: 1, spacing: 90, maxHeight: 70 },
        ],
        missionBases: [[3400, -2200], [800, 800]],
      }),
    ],
  };
}
