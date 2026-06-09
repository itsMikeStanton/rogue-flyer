// Landing-approach guidance ("Approach Mode").
//
// Toggle it on when you want to come home: it picks the nearer end of the home
// runway, lays an ILS-style glideslope + extended centerline out in front of it,
// and feeds the HUD everything it needs to guide you down — a localizer/
// glideslope deviation cross, a string of "gates" to fly through, a recommended
// speed schedule, gear/flaps prompts, and altitude callouts in the flare.
//
// The runway is the home strip built in world.js: centred on the island origin,
// aligned with the Z axis, 2000 long / 80 wide. All maths here are in WORLD
// space; projection to the screen is done by a callback the caller supplies, so
// this module never touches the camera.

import * as THREE from "three";
import { terrainHeight, SEA_LEVEL } from "./world.js";

const HALF_LEN = 1000;                       // runway half-length (2000-long strip)
const GLIDE = 4.5 * Math.PI / 180;           // glideslope angle (a touch steep, arcade-friendly)
const TAN_GLIDE = Math.tan(GLIDE);
const IAF_DIST = 7000;                        // initial approach fix: distance out from the threshold
const GATE_DISTS = [900, 1900, 3100, 4600, 6400]; // along-track gate positions (m from threshold)
const LOC_SCALE = 520;                        // lateral deviation that pegs the localizer needle
const GS_SCALE = 95;                          // vertical deviation that pegs the glideslope needle
const TOUCH_INSET = 180;                      // aim point sits this far inside the threshold

export class Approach {
  constructor(opts = {}) {
    this.cx = opts.cx || 0;                   // runway centre (world XZ)
    this.cz = opts.cz || 0;
    this.elev = terrainHeight(this.cx, this.cz) + 0.5; // runway surface world-Y
    this.active = false;
    this.end = 1;                             // +1: approach over the +Z end; -1: the -Z end
  }

  toggle(state) { this.active = !this.active; if (this.active) this._chooseEnd(state); return this.active; }
  off() { this.active = false; }

  // Approach over whichever threshold is on the aircraft's side of the field.
  _chooseEnd(state) { this.end = (state.position.z - this.cz) >= 0 ? 1 : -1; }

  // Recompute guidance. opts: { gearDown, flapsDown, speedKts, project(v3) }.
  // project(v3) -> { x, y, onscreen, behind, dirx, diry } (HUD pixels + clip dir).
  // Returns a HUD-ready object, or null when inactive.
  update(state, opts) {
    if (!this.active) return null;
    const sgn = this.end;
    const project = opts.project;

    // Geometry --------------------------------------------------------------
    const thZ = this.cz + sgn * HALF_LEN;     // threshold (start of pavement on the approach side)
    const aimZ = thZ - sgn * TOUCH_INSET;     // touchdown aim point, just inside the bricks
    const az = state.position.z - thZ;        // Z offset from the threshold
    const d = sgn * az;                        // along-track distance still to fly (>0 on the approach side)
    const latRaw = state.position.x - this.cx;
    const lateral = sgn * latRaw;             // >0 => course is to your right (steer right)
    const hgt = state.position.y - this.elev; // height above the runway
    const gsTarget = Math.max(0, d) * TAN_GLIDE;
    const gsErr = hgt - gsTarget;             // >0 high, <0 low

    // Deviation needles (normalised -1..1; positive x = course right, positive y = course low)
    const locDev = THREE.MathUtils.clamp(lateral / LOC_SCALE, -1, 1);
    const gsDev = THREE.MathUtils.clamp(gsErr / GS_SCALE, -1, 1);

    // Speed schedule --------------------------------------------------------
    const vTarget = Math.round(THREE.MathUtils.clamp(135 + (d / 6000) * 75, 135, 210));
    const vNow = Math.round(opts.speedKts);

    // Phase + cues ----------------------------------------------------------
    const offCourse = d > IAF_DIST + 1800 || Math.abs(lateral) > 1300 || d < -350;
    let status, fixData = null;
    const gates = [];
    let callout = null;

    if (offCourse) {
      status = "PROCEED TO APPROACH FIX";
      const fix = new THREE.Vector3(this.cx, this.elev + IAF_DIST * TAN_GLIDE, thZ + sgn * IAF_DIST);
      const pr = project(fix);
      fixData = { dist: state.position.distanceTo(fix), ...pr };
    } else if (d < 90) {
      // Over the threshold / on the runway: altitude callouts into the flare.
      status = hgt < 6 ? "FLARE — IDLE THRUST" : "OVER THRESHOLD";
      for (const b of [100, 50, 40, 30, 20, 10]) { if (hgt <= b) callout = String(b); }
      if (hgt < 6) callout = "FLARE";
    } else {
      status = (Math.abs(locDev) < 0.22 && Math.abs(gsDev) < 0.3) ? "● ON GLIDEPATH" : "ON APPROACH";
    }

    if (!offCourse) {
      // Gates ahead are the ones BETWEEN you and the threshold (di < d). Iterate
      // farthest-out first so gates[0] is the nearest one in front of you (drawn
      // biggest), giving a receding tunnel toward the runway.
      for (let i = GATE_DISTS.length - 1; i >= 0; i--) {
        const di = GATE_DISTS[i];
        if (di < d + 150) {                   // ahead of you (or the one you're at)
          const g = new THREE.Vector3(this.cx, this.elev + di * TAN_GLIDE, thZ + sgn * di);
          const pr = project(g);
          gates.push({ near: (d - di) < 900, ...pr });
        }
      }
    }

    // Build the steering cue list.
    const cues = [];
    if (!offCourse) {
      if (d < 4800 && !opts.flapsDown) cues.push("SET FLAPS ▼");
      if (d < 3500 && !opts.gearDown) cues.push("LOWER GEAR ▼");
      if (vNow > vTarget + 18) cues.push("REDUCE SPEED");
      else if (vNow < vTarget - 18 && d > 120) cues.push("ADD POWER");
    }

    // Aim-point marker on the runway.
    const aim = project(new THREE.Vector3(this.cx, this.elev + 2, aimZ));

    return {
      status, cues, callout, fix: fixData, gates, aim,
      locDev, gsDev, onPath: status.startsWith("●"),
      dist: Math.max(0, Math.round(d)), height: Math.round(hgt),
      vNow, vTarget,
    };
  }
}
