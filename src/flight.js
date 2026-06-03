import * as THREE from "three";
import { SEA_LEVEL } from "./world.js";

// Arcade-plus flight dynamics.
//
// We integrate position / velocity / orientation with simple aerodynamics that
// still capture the things that make a jet *feel* like a jet:
//   - airspeed-dependent control authority (mushy controls when slow)
//   - angle of attack, lift curve, and a stall break
//   - induced + parasitic drag, so turning bleeds energy
//   - thrust-to-weight that lets fast jets climb vertically
//
// Coordinate convention: forward = -Z, up = +Y, right = +X (Three.js default).

const GRAVITY = 9.81;

// Air density falls off with altitude — thinner air, less lift & drag up high.
function airDensity(altitude) {
  return 1.225 * Math.exp(-Math.max(0, altitude) / 9000);
}

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _liftDir = new THREE.Vector3();
const _force = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function createState() {
  return {
    position: new THREE.Vector3(0, 1200, 0),
    velocity: new THREE.Vector3(0, 0, -180), // start with forward airspeed
    quaternion: new THREE.Quaternion(),
    onGround: false,
    crashed: false,
    // smoothed control inputs (low-pass), to kill twitch
    sctrl: { pitch: 0, roll: 0, yaw: 0 },
    // last-frame telemetry for the HUD
    telemetry: {
      speed: 180, altitude: 1200, heading: 0, throttle: 0,
      aoa: 0, gForce: 1, vspeed: 0, stall: false, mach: 0,
    },
  };
}

// Lift curve. The wing holds up to clMax and only a very deep (practically
// unreachable, thanks to the AoA limiter) over-angle bleeds lift — so a true
// stall is almost impossible.
function liftCoeff(def, aoa) {
  const a = Math.abs(aoa);
  const sign = Math.sign(aoa) || 1;
  let cl = THREE.MathUtils.clamp(def.cl0 + def.clAlpha * aoa, -def.clMax, def.clMax);
  let stalling = false;
  const deep = def.stallAngle * 1.5;
  if (a > deep) {
    cl = (def.cl0 + sign * def.clMax) * Math.exp(-(a - deep) * 2.0);
    stalling = true;
  }
  return { cl, stalling };
}

// Advance one fixed physics step. `controls` = {pitch, roll, yaw, throttle} in
// [-1,1] (throttle 0..1). `groundHeight` is solid ground (terrain or carrier
// deck) at current XZ; if it's below sea level the surface there is open water.
export function step(state, def, controls, dt, groundHeight) {
  if (state.crashed) return;

  const q = state.quaternion;
  _fwd.set(0, 0, -1).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  _right.set(1, 0, 0).applyQuaternion(q);

  const vel = state.velocity;
  const speed = vel.length();
  const altitude = state.position.y;
  const rho = airDensity(altitude);
  const qDyn = 0.5 * rho * speed * speed; // dynamic pressure

  // --- Angle of attack (pitch-plane angle between velocity and nose) ---
  let aoa = 0;
  if (speed > 1) {
    const vFwd = vel.dot(_fwd);
    const vUp = vel.dot(_up);
    aoa = Math.atan2(-vUp, vFwd); // nose above velocity vector => positive
  }

  // --- Aerodynamic forces ---
  _force.set(0, 0, 0);

  // Thrust along the nose
  _tmp.copy(_fwd).multiplyScalar(controls.throttle * def.maxThrust);
  _force.add(_tmp);

  let cl = 0, stalling = false;
  if (speed > 1) {
    const lc = liftCoeff(def, aoa);
    cl = lc.cl;
    stalling = lc.stalling;

    // Lift acts perpendicular to velocity, in the aircraft's vertical plane.
    _liftDir.copy(_up).addScaledVector(vel, -vel.dot(_up) / (speed * speed)).normalize();
    if (!isFinite(_liftDir.x)) _liftDir.copy(_up);
    const liftMag = qDyn * def.wingArea * cl;
    _tmp.copy(_liftDir).multiplyScalar(liftMag);
    _force.add(_tmp);

    // Drag opposes velocity
    const cd = def.cd0 + def.k * cl * cl;
    const dragMag = qDyn * def.wingArea * cd;
    _tmp.copy(vel).multiplyScalar(-dragMag / speed);
    _force.add(_tmp);
  }

  // Gravity
  _force.y -= GRAVITY * def.mass;

  // Integrate linear motion (semi-implicit Euler)
  const invMass = 1 / def.mass;
  vel.addScaledVector(_force, invMass * dt);
  state.position.addScaledVector(vel, dt);

  // --- Rotational control ---
  // Low-pass the inputs so a flick of the stick ramps in instead of snapping —
  // this is what makes touch/keyboard flyable rather than twitchy.
  const sc = state.sctrl;
  const sm = 1 - Math.exp(-dt / 0.16);
  sc.pitch += (controls.pitch - sc.pitch) * sm;
  sc.roll += (controls.roll - sc.roll) * sm;
  sc.yaw += (controls.yaw - sc.yaw) * sm;

  // Manual roll — hold your bank (no auto-leveling, so turns stay put).
  const rollInput = sc.roll;

  // Angle-of-attack limiter (fly-by-wire): fade out the pitch command that
  // would push AoA past the stall angle, so you physically can't yank into a
  // stall. The aircraft holds just below critical alpha instead.
  let pitchCmd = sc.pitch;
  const aoaLimit = def.stallAngle * 0.9;
  const span = def.stallAngle - aoaLimit + 1e-3;
  if (aoa > aoaLimit && pitchCmd > 0) {
    pitchCmd *= THREE.MathUtils.clamp(1 - (aoa - aoaLimit) / span, 0, 1);
  } else if (aoa < -aoaLimit && pitchCmd < 0) {
    pitchCmd *= THREE.MathUtils.clamp(1 - (-aoa - aoaLimit) / span, 0, 1);
  }

  // Control authority scales with dynamic pressure: slow => mushy.
  const authority = THREE.MathUtils.clamp(qDyn / 6000, 0.15, 1.2);
  const pitch = pitchCmd * def.pitchRate * authority;
  const roll = rollInput * def.rollRate * authority;
  let yaw = sc.yaw * def.yawRate * authority;
  // Directional stability: weathervane the nose toward the velocity vector so
  // sideslip washes out when you let off the rudder (coordinated flight).
  if (speed > 20) {
    const side = vel.dot(_right) / speed; // + when the airflow is from the right
    yaw += -side * 2.5 * authority;
  }

  // Apply body-rate rotations: roll about fwd, pitch about right, yaw about up.
  _euler.set(pitch * dt, yaw * dt, -roll * dt, "XYZ");
  _dq.setFromEuler(_euler);
  q.multiply(_dq).normalize();

  // --- Ground / sea interaction (taxi / takeoff / landing / ditching) ---
  // If the solid ground here is below the sea, the real surface is water.
  const overWater = groundHeight < SEA_LEVEL;
  const surfaceY = overWater ? SEA_LEVEL : groundHeight;
  const groundY = surfaceY + 1.5;
  if (state.position.y <= groundY) {
    state.position.y = groundY;
    if (overWater) {
      // Hit the sea: ditching is a crash (unless basically stopped).
      if (speed > 10) state.crashed = true;
      else { vel.set(0, 0, 0); state.onGround = false; }
    } else {
    const sinkRate = -vel.y;
    const levelish = _up.y > 0.6;
    if ((sinkRate > 24 || !levelish) && speed > 35) {
      state.crashed = true; // slammed in too hard or not wings-level
    } else {
      vel.y = Math.max(0, vel.y);
      state.onGround = true;

      // Wheels: no sideways slide — redirect horizontal velocity along heading.
      _fwd.set(0, 0, -1).applyQuaternion(q);
      const hlen = Math.hypot(_fwd.x, _fwd.z) || 1;
      const hx = _fwd.x / hlen, hz = _fwd.z / hlen;
      let gs = Math.hypot(vel.x, vel.z);
      gs = Math.max(0, gs - 1.5 * dt); // light rolling resistance (constant, small)
      vel.x = hx * gs;
      vel.z = hz * gs;

      // Stay on the gear: level the wings, hold a slight ground pitch until you
      // reach rotate speed and pull back — then let the nose come up to fly.
      _euler.setFromQuaternion(q, "YXZ");
      const blend = 1 - Math.exp(-dt / 0.12);
      _euler.z = THREE.MathUtils.lerp(_euler.z, 0, blend);
      const ROTATE_SPEED = 68;
      const rotating = gs > ROTATE_SPEED && controls.pitch > 0.15;
      if (rotating) {
        _euler.x = THREE.MathUtils.clamp(_euler.x, -0.05, 0.28); // allow rotation, cap
      } else {
        _euler.x = THREE.MathUtils.lerp(_euler.x, 0.03, blend); // sit slightly nose-up
      }
      // Nosewheel steering: rudder turns the heading, more so with speed.
      _euler.y += controls.yaw * 0.5 * dt * Math.min(1, gs / 35);
      q.setFromEuler(_euler);
    }
    } // end solid-ground branch
  } else {
    state.onGround = false;
  }

  // --- Telemetry for HUD ---
  _euler.setFromQuaternion(q, "YXZ");
  const heading = (THREE.MathUtils.radToDeg(-_euler.y) + 360) % 360;
  // Load factor: lift component vs weight (approx G felt by pilot).
  const liftG = speed > 1 ? (qDyn * def.wingArea * cl) / (def.mass * GRAVITY) : 0;
  state.telemetry = {
    speed,
    altitude: state.position.y,
    heading,
    throttle: controls.throttle,
    aoa: THREE.MathUtils.radToDeg(aoa),
    gForce: 1 * _up.y + liftG, // rough: gravity component + aero load
    vspeed: vel.y,
    stall: stalling && speed > 5,
    mach: speed / 340,
  };
}
