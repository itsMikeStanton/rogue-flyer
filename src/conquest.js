// Conquest: seize the whole archipelago, island by island.
//
// Pure state model — main.js drives the flight loop and rendering; this only
// tracks who owns each island, where you're allowed to launch from, which enemy
// island's defenses are currently awake, and when an island falls. It is built
// straight from world.js island data (getIslandSpawns), so it scales on its own
// as more islands are added to the map.
//
// The loop main.js runs against this:
//   1. Setup: the player picks a beachhead (one island becomes yours) + rules.
//   2. Launch from any owned runway / carrier.
//   3. Fly at an enemy island — within AWAKE_RANGE its defenses scramble.
//   4. Clear that island's ground targets -> it's captured and becomes a spawn.
//   5. Die with lives left -> pick another owned runway / carrier to launch from.
//   6. Own every island -> the archipelago is secured.

// Defenses stir once the player is this close (world units) to an enemy island.
export const AWAKE_RANGE = 9000;

// Base defense by island faction: fighters on patrol + an AI difficulty floor.
// (Stationary SAM/radar/bunker targets come from the strike-target system; this
// is the air picket that "wakes up" as you arrive.)
const DEFENSE = {
  enemy:   { fighters: 4, diff: 1.2 },
  neutral: { fighters: 2, diff: 1.0 },
  ally:    { fighters: 0, diff: 1.0 },
};

// The "rules" knob: how hard the pickets hit. Scales fighter count + difficulty.
const DIFF_SCALE = { recruit: 0.6, veteran: 1.0, ace: 1.5 };

export class ConquestRun {
  // islandSpawns: [{ name, faction, center:{x,z}, spawns:[{kind,name,x,z,...}] }]
  constructor(islandSpawns, opts = {}) {
    this.difficulty = opts.difficulty || "veteran";
    this.nodes = (islandSpawns || []).map((is, i) => ({
      id: i,
      name: is.name,
      faction: is.faction,
      center: { x: is.center.x, z: is.center.z },
      spawns: is.spawns.map((s) => ({ ...s })),
      owner: "enemy",   // "player" once captured
      captured: false,
      awake: false,     // defenses have been triggered
      defended: false,  // air pickets have actually been spawned (once)
      targets: [],      // ground targets bound to this island (set at flight start)
    }));
    // Nothing is yours yet — you seize a single beachhead at setup and take the
    // rest of the map from there. (Faction still sets how hard each island hits;
    // see defenseFor.)
    this.startId = null;  // the beachhead the player chose
    this.activeId = null; // the enemy island currently awake / under assault
    this.won = false;
  }

  _own(n) { n.owner = "player"; n.captured = true; n.awake = false; }

  node(id) { return this.nodes.find((n) => n.id === id) || null; }

  // Grant the chosen beachhead and remember it as the first launch point.
  setStart(id) {
    const n = this.node(id);
    if (n) { this._own(n); this.startId = id; }
  }

  ownedNodes() { return this.nodes.filter((n) => n.owner === "player"); }
  enemyNodes() { return this.nodes.filter((n) => n.owner !== "player"); }

  // Flat list of every launch point on islands you hold (drives the spawn map).
  ownedSpawns() {
    const out = [];
    for (const n of this.ownedNodes()) for (const s of n.spawns) out.push({ ...s, node: n.id });
    return out;
  }

  // Every launch point on every island — used at setup, where any island can be
  // taken as the beachhead.
  allSpawns() {
    const out = [];
    for (const n of this.nodes) for (const s of n.spawns) out.push({ ...s, node: n.id });
    return out;
  }

  // Air picket strength for an island, scaled by the chosen difficulty rule.
  defenseFor(n) {
    const base = DEFENSE[n.faction] || DEFENSE.enemy;
    const k = DIFF_SCALE[this.difficulty] != null ? DIFF_SCALE[this.difficulty] : 1;
    return { fighters: Math.round(base.fighters * k), diff: base.diff * (0.85 + 0.3 * k) };
  }

  // Tag each spawned ground target with the island it sits on, so we can tell
  // when an island has been cleared. Targets on islands you already hold are
  // friendly ground — neutralise them so they aren't objectives.
  bindTargets(targets) {
    for (const n of this.nodes) n.targets = [];
    for (const t of targets || []) {
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        const dx = t.position.x - n.center.x, dz = t.position.z - n.center.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = n; }
      }
      if (best) { t._node = best.id; best.targets.push(t); }
    }
    for (const n of this.ownedNodes()) for (const t of n.targets) {
      t.alive = false;
      if (t.group) t.group.visible = false;
      if (t.mesh) t.mesh.visible = false;
    }
  }

  // Nearest still-enemy island to a world position, with its distance.
  nearestEnemy(pos) {
    let best = null, bd = Infinity;
    for (const n of this.enemyNodes()) {
      const d = Math.hypot(pos.x - n.center.x, pos.z - n.center.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best ? { node: best, dist: bd } : null;
  }

  // An island is cleared once its essential installations are down. Ambient
  // flak guns are flavour — they don't gate the capture. (An island with no
  // essential targets is taken simply by reaching it.)
  isCleared(n) {
    const essential = n.targets.filter((t) => !t.ambient);
    return essential.length ? essential.every((t) => !t.alive) : true;
  }

  capture(n) {
    n.owner = "player";
    n.captured = true;
    n.awake = false;
    // The island is yours now — silence anything still standing (leftover flak
    // guns that didn't gate the capture) so it doesn't shoot at its new owner.
    for (const t of n.targets) {
      if (!t.alive) continue;
      t.alive = false;
      if (t.group) t.group.visible = false;
      if (t.mesh) t.mesh.visible = false;
    }
    if (this.activeId === n.id) this.activeId = null;
  }

  checkWon() { this.won = this.nodes.every((n) => n.owner === "player"); return this.won; }
}
