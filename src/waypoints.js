// Flight-plan waypoint types. Shared by the map planner (display + editing) and
// the in-game HUD, so a waypoint's intent — "this is the ATTACK point" — reads
// the same on the map and in the cockpit.

export const WPT_TYPES = {
  nav:    { label: "NAV",    color: 0x46c8ff, desc: "Navigation turnpoint" },
  ip:     { label: "IP",     color: 0xffd23f, desc: "Ingress point — push to the target" },
  attack: { label: "ATTACK", color: 0xff5b5b, desc: "Attack point — engage the target" },
  rtb:    { label: "RTB",    color: 0x62c98a, desc: "Return to base" },
};
export const WPT_ORDER = ["nav", "ip", "attack", "rtb"];
export function wptType(t) { return WPT_TYPES[t] || WPT_TYPES.nav; }

// Bearing (deg, 0=N, world +x = E, world -z = N) and distance (m) between two
// world XZ points — used for leg labels and the plan readout.
export function legBearing(a, b) {
  const d = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
  return Math.round(d);
}
export function legDist(a, b) { return Math.hypot(b.x - a.x, b.z - a.z); }
