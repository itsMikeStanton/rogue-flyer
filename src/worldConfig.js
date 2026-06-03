// The world is described by this data object. world.js reads it to build the
// scene and sample terrain height, so an editor can mutate it (and export it)
// without touching engine code. defaultWorldConfig() reproduces the built-in
// island exactly; editor overrides are merged on top (see world.js).
export function defaultWorldConfig() {
  return {
    seed: 0x1f2e3d,
    seaLevel: -180,
    // Radial island falloff: land within islandInner, ocean floor past islandOuter.
    terrain: { islandInner: 7000, islandOuter: 9800, deep: -750 },
    // Tree cover. density is a paintable gridN×gridN grid of 0..1 values over
    // ±extent; null means "use the procedural default" (see world.js).
    forest: { extent: 10800, gridN: 48, maxTrees: 5200, density: null },
    // Coastal cliff/headland (flat-topped mesa with steep sides).
    cliff: { x: -6200, z: 1900, r: 620, h: 560 },
    // Winding river: x(z) = a1*sin(f1*z) + a2*sin(f2*z + phase).
    river: {
      a1: 2200, f1: 0.00026, a2: 700, f2: 0.00091, phase: 1.3,
      bed: -14, surface: -9, inner: 140, outer: 440, extent: 6800, carveMax: 7800,
    },
    // Flattened circle around the origin for the runway, and the takeoff spot.
    spawn: { flattenRadius: 1400, x: 0, z: 520 },
    carriers: [
      { team: "ally", x: -1200, z: 11200, halfL: 170, halfW: 36 },
      { team: "enemy", x: 1200, z: -12800, halfL: 170, halfW: 36 },
    ],
    // kind is cosmetic; radius/spacing/maxHeight drive the block layout.
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
    bridges: [-1600, 2600], // z-locations where a bridge crosses the river
    roads: [
      [[60, 300], [1600, 5200], [5200, 2600]],
      [[60, -300], [-2600, -5200]],
      [[3200, -3500], [4200, -1200], [2200, 1200], [1600, 5200]],
      [[-1000, 3400], [-4200, 2600]],
    ],
    // Strike-mission ground-target cluster centers.
    missionBases: [[0, -3800], [2600, -6500], [-2800, -5200]],
  };
}
