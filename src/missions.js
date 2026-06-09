// Mission objective model + runtime manager.
//
// A mission is an ordered set of objectives. The manager binds destroy/defend
// objectives to spawned ground targets, ticks completion/fail each frame, and
// produces HUD-ready data (a single waypoint diamond for the nearest active
// objective + a list for the objective panel). It is camera-free: callers hand
// in a project(vec3) callback, exactly like approach.js.
//
// Only objective-relevant targets are flagged (t.objective = true) so the HUD
// marks just what matters — ambient defenses stay unmarked until you find them.

import * as THREE from "three";

export class MissionManager {
  constructor() {
    this.def = null;
    this.objectives = [];
    this.active = false;
    this.status = "idle"; // idle | in-progress | complete | failed
    this.onComplete = null;
    this.onFail = null;
  }

  // def.objectives: [{ type, priority, label, match, waypoint?, radius?, timer? }]
  //   type:     "destroy" | "reach" | "land" | "survive" | "defend"
  //   priority: "primary" | "secondary" | "optional"  (optional never gates win)
  //   match:    target type string | array of types | predicate(t) | "all"
  load(def, ground) {
    this.def = def;
    this.status = "in-progress";
    this.active = true;
    this.objectives = (def.objectives || []).map((o, i) => ({
      id: o.id || ("obj" + i),
      type: o.type,
      priority: o.priority || "primary",
      label: o.label || "Objective",
      match: o.match || null,
      targets: [],
      waypoint: o.waypoint ? new THREE.Vector3(o.waypoint.x, o.waypoint.y, o.waypoint.z) : null,
      radius: o.radius || 170,
      timer: o.timer != null ? o.timer : null,
      timeLeft: o.timer != null ? o.timer : 0,
      state: "active", // active | done | failed
    }));
    if (ground) this.bind(ground);
  }

  // Flag the targets that belong to each (non-optional) destroy/defend objective.
  bind(ground) {
    for (const t of ground.targets) t.objective = false;
    for (const o of this.objectives) {
      if (o.type !== "destroy" && o.type !== "defend") continue;
      o.targets = ground.targets.filter((t) => this._matches(t, o.match));
      if (o.priority !== "optional") for (const t of o.targets) t.objective = true;
    }
  }

  _matches(t, match) {
    if (!match || match === "all") return true;
    if (typeof match === "function") return match(t);
    if (Array.isArray(match)) return match.includes(t.type);
    return t.type === match;
  }

  isObjectiveTarget(t) { return !!t.objective; }

  // dt seconds; player has {position}; state has {onGround, telemetry.speed}.
  update(dt, player, state) {
    if (!this.active || this.status !== "in-progress") return;
    let allDone = true, anyFail = false;
    for (const o of this.objectives) {
      if (o.state === "done") continue;
      if (o.state === "failed") { if (o.priority !== "optional") anyFail = true; continue; }
      if (o.type === "destroy") {
        if (o.targets.length && o.targets.every((t) => !t.alive)) o.state = "done";
      } else if (o.type === "reach" || o.type === "land") {
        if (o.waypoint) {
          const near = player.position.distanceTo(o.waypoint) < o.radius;
          if (o.type === "reach" && near) o.state = "done";
          else if (o.type === "land" && near && state.onGround && state.telemetry.speed < 45) o.state = "done";
        }
      } else if (o.type === "survive") {
        o.timeLeft -= dt; if (o.timeLeft <= 0) o.state = "done";
      } else if (o.type === "defend") {
        if (o.targets.length && o.targets.every((t) => !t.alive)) o.state = "failed";
        else if (o.timer != null) { o.timeLeft -= dt; if (o.timeLeft <= 0) o.state = "done"; }
      }
      if (o.priority !== "optional" && o.state !== "done") allDone = false;
    }
    if (anyFail) { this.status = "failed"; this.active = false; if (this.onFail) this.onFail(); return; }
    if (allDone) { this.status = "complete"; this.active = false; if (this.onComplete) this.onComplete(); }
  }

  // Returns { objective, objectives } for the HUD. `objective` is the nearest
  // active objective's marker (a destroy target or a waypoint), projected.
  hudData(project, playerPos) {
    let bd = Infinity, bp = null;
    for (const o of this.objectives) {
      if (o.state !== "active") continue;
      if (o.type === "destroy" || o.type === "defend") {
        for (const t of o.targets) {
          if (!t.alive) continue;
          const d = playerPos.distanceTo(t.position);
          if (d < bd) { bd = d; bp = t.position; }
        }
      } else if ((o.type === "reach" || o.type === "land") && o.waypoint) {
        const d = playerPos.distanceTo(o.waypoint);
        if (d < bd) { bd = d; bp = o.waypoint; }
      }
    }
    let objective = null;
    if (bp) objective = { dist: bd, ...project(bp) };
    const objectives = this.objectives.map((o) => ({
      label: o.label, priority: o.priority, state: o.state,
      timeLeft: o.timer != null && o.state === "active" ? Math.max(0, Math.ceil(o.timeLeft)) : null,
    }));
    return { objective, objectives };
  }
}

// Build a default Strike mission from whatever ground targets were spawned:
// the high-value targets become primary/secondary objectives; tanks/bunkers are
// left as ambient (unmarked) destroyables.
export function defaultStrikeMission(ground) {
  const ts = ground.targets;
  const has = (type) => ts.some((t) => t.type === type);
  const objectives = [];
  if (has("powerplant")) objectives.push({ type: "destroy", priority: "primary", label: "Destroy the power plant", match: "powerplant" });
  if (ts.some((t) => t.info)) objectives.push({ type: "destroy", priority: objectives.length ? "secondary" : "primary", label: "Sink the enemy carrier", match: (t) => !!t.info });
  if (has("radar") || has("sam")) objectives.push({ type: "destroy", priority: "secondary", label: "Knock out the air defenses", match: ["radar", "sam"] });
  if (!objectives.length) objectives.push({ type: "destroy", priority: "primary", label: "Destroy all targets", match: "all" });
  return { title: "Strike", objectives };
}

// "Surprise Me": a random objective set drawn from the spawned targets.
export function randomObjectiveSet(ground) {
  const ts = ground.targets;
  const kinds = ["powerplant", "radar", "sam", "bunker", "tank"].filter((k) => ts.some((t) => t.type === k));
  const objectives = [];
  if (kinds.length) {
    const primary = kinds[Math.floor(Math.random() * kinds.length)];
    objectives.push({ type: "destroy", priority: "primary", label: "Destroy all " + primary + "s", match: primary });
    const rest = kinds.filter((k) => k !== primary);
    if (rest.length && Math.random() < 0.7) {
      const sec = rest[Math.floor(Math.random() * rest.length)];
      objectives.push({ type: "destroy", priority: "secondary", label: "Hit the " + sec + "s", match: sec });
    }
  }
  if (ts.some((t) => t.info) && Math.random() < 0.5) objectives.push({ type: "destroy", priority: "optional", label: "Bonus: sink the carrier", match: (t) => !!t.info });
  if (!objectives.length) objectives.push({ type: "destroy", priority: "primary", label: "Destroy all targets", match: "all" });
  return { title: "Surprise Strike", objectives };
}
