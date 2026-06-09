import * as THREE from "three";
import { terrainHeight, SEA_LEVEL } from "./world.js";

// Shared enemy awareness, one Faction per enemy island. Every defence on an
// island reads the same Faction, so the instant one sensor notices you the whole
// island reacts together — searchlights swing on, then (after a beat to "pass the
// word") the guns open up — and when you slip away they stay on edge for a while
// before standing down. This is what lets you sneak in high and quiet, strike,
// and run before they pin you.
//
// Derived states:
//   UNAWARE  — no idea you're there. Guns cold; only a token picket light idles.
//   TRACKING — armed AND fresh contact: they know where you are. Guns hot, every
//              light converges on you.
//   HUNTING  — armed but contact gone stale: still hot + lit, sweeping around
//              where they last saw you. Times out back to UNAWARE if you vanish.

const SENSOR_RANGE = 6500;   // an island only notices things inside this bubble
const SEE_ALT = 1500;        // higher than this (m AGL) and passive spotting ~ nil
const SEE_NEAR = 1300;       // inside this you're easy to see at any altitude
const PASSIVE_RATE = 0.34;   // suspicion/sec at full detectability
const PASSIVE_COOL = 0.12;   // suspicion bleeds off at this/sec when you're subtle
const RANDOM_RATE = 0.02;    // tiny chance to be noticed even way up high
const FIRE_SUSPICION = 1.5;  // suspicion/sec while you're shooting in range
const CONTACT_GAIN = 1.6;    // how fast a fix firms up while they can see you
const CONTACT_FADE = 0.5;    // how fast the fix decays once you're unseen
const SEE_CONTACT = 0.4;     // contact above this = "they know where you are"
const FIRE_CONTACT = 0.35;   // guns need at least this much contact to shoot
const SHARE_DELAY = 1.3;     // after first detection, this long before guns join in
const ARM_HOLD = 26;         // stay armed/hunting this long after losing contact
const SEEN_DET = 0.12;       // detectability above this counts as "currently seen"

export class Faction {
  constructor(id, center) {
    this.id = id;
    this.center = { x: center.x, z: center.z };
    this.lastKnown = new THREE.Vector3();
    this.reset();
  }
  reset() {
    this.suspicion = 0;
    this.contact = 0;
    this.armed = false;
    this.armTimer = 0;
    this.shareTimer = 0;
    this.litT = 0;            // refreshed by a searchlight holding you in its beam
    this.state = "unaware";
    this.event = null;        // one-shot transition for the HUD/banners
  }

  // How visible the player is to this island right now, 0..1. Altitude is the
  // dominant lever (stay high to stay hidden); getting close raises it too.
  detectability(player) {
    const dx = player.position.x - this.center.x, dz = player.position.z - this.center.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz > SENSOR_RANGE) return 0;
    const gy = Math.max(terrainHeight(player.position.x, player.position.z), SEA_LEVEL);
    const alt = Math.max(0, player.position.y - gy);
    const altF = THREE.MathUtils.clamp(1 - alt / SEE_ALT, 0, 1);
    const nearF = THREE.MathUtils.clamp(1 - (horiz - SEE_NEAR) / (SENSOR_RANGE - SEE_NEAR), 0, 1);
    return altF * nearF;
  }

  update(dt, player, ev) {
    const dx = player.position.x - this.center.x, dz = player.position.z - this.center.z;
    const inRange = (dx * dx + dz * dz) < SENSOR_RANGE * SENSOR_RANGE;
    const det = inRange ? this.detectability(player) : 0;
    this.litT = Math.max(0, this.litT - dt);

    if (!this.armed) {
      let s = det * PASSIVE_RATE;
      if (inRange) s += RANDOM_RATE * (0.3 + det);
      if (ev.firing && inRange) s += FIRE_SUSPICION * (0.5 + 0.5 * det); // shooting gives you away
      this.suspicion += (s - PASSIVE_COOL) * dt;
      this.suspicion = THREE.MathUtils.clamp(this.suspicion, 0, 1);
      if (this.suspicion >= 1) this.spot(player.position);
    } else {
      const seen = det > SEEN_DET || this.litT > 0 || (ev.firing && inRange);
      if (seen) {
        this.contact = Math.min(1, this.contact + dt * CONTACT_GAIN);
        this.lastKnown.copy(player.position);
        this.armTimer = ARM_HOLD;
      } else {
        this.contact = Math.max(0, this.contact - dt * CONTACT_FADE);
        this.armTimer -= dt;
        if (this.armTimer <= 0) { this._standDown(); return; }
      }
      this.shareTimer = Math.max(0, this.shareTimer - dt);
    }
    this._updateState();
  }

  // Hard alert: a sensor positively has you (a hit landed, or a beam's on you).
  spot(pos) {
    if (!this.armed) { this.armed = true; this.shareTimer = SHARE_DELAY; this.event = "spotted"; }
    this.contact = 1;
    this.lastKnown.copy(pos);
    this.armTimer = ARM_HOLD;
    this.suspicion = 1;
    this._updateState();
  }
  // A searchlight is holding you: keep the fix fresh (and spot if they didn't
  // already know).
  illuminate(pos) {
    this.litT = 0.5;
    if (!this.armed) this.spot(pos);
    else { this.contact = 1; this.lastKnown.copy(pos); this.armTimer = ARM_HOLD; }
  }

  _standDown() {
    const was = this.armed;
    this.reset();
    if (was) this.event = "clear";
  }
  _updateState() {
    const prev = this.state;
    this.state = !this.armed ? "unaware" : (this.contact > SEE_CONTACT ? "tracking" : "hunting");
    if (prev === "tracking" && this.state === "hunting") this.event = "evaded";
  }

  // Queries used by the defences.
  canFire() { return this.armed && this.shareTimer <= 0 && this.contact > FIRE_CONTACT; }
  get knowsWhere() { return this.armed && this.contact > SEE_CONTACT; }
  get alerted() { return this.armed; }
  consumeEvent() { const e = this.event; this.event = null; return e; }
}

export class Awareness {
  constructor() { this.factions = new Map(); }
  reset() { this.factions.clear(); }
  faction(id, center) {
    let f = this.factions.get(id);
    if (!f) { f = new Faction(id, center); this.factions.set(id, f); }
    return f;
  }
  update(dt, player, ev) {
    if (!player || !player.alive) return;
    for (const f of this.factions.values()) f.update(dt, player, ev);
  }
  // Nearest faction to a world position (for the HUD + transition banners).
  nearest(pos) {
    let best = null, bd = Infinity;
    for (const f of this.factions.values()) {
      const dx = pos.x - f.center.x, dz = pos.z - f.center.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
}
