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
  if (def.rotor) return stepHeli(state, def, controls, dt, groundHeight);

  const q = state.quaternion;
  _fwd.set(0, 0, -1).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  _right.set(1, 0, 0).applyQuaternion(q);

  const vel = state.velocity;
  const speed = vel.length();
  const altitude = state.position.y - SEA_LEVEL; // height above the sea surface
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

  // Thrust along the nose. Squared throttle curve = gentle low end, punchy top
  // (more arcade contrast between idle and full).
  const thr = controls.throttle * controls.throttle;
  _tmp.copy(_fwd).multiplyScalar(thr * def.maxThrust);
  _force.add(_tmp);

  let cl = 0, stalling = false;
  if (speed > 1) {
    const lc = liftCoeff(def, aoa);
    cl = lc.cl;
    stalling = lc.stalling;
    if (controls.flaps) cl += 0.45; // flaps add lift for slow flight / landing

    // Lift acts perpendicular to velocity, in the aircraft's vertical plane.
    _liftDir.copy(_up).addScaledVector(vel, -vel.dot(_up) / (speed * speed)).normalize();
    if (!isFinite(_liftDir.x)) _liftDir.copy(_up);
    const liftMag = qDyn * def.wingArea * cl;
    _tmp.copy(_liftDir).multiplyScalar(liftMag);
    _force.add(_tmp);

    // Drag opposes velocity (gear + flaps add drag)
    let cd = def.cd0 + def.k * cl * cl;
    if (controls.gear) cd += 0.022;
    if (controls.flaps) cd += 0.014;
    if (controls.brake) cd += 0.10; // airbrake / speedbrake: big drag to bleed speed
    const dragMag = qDyn * def.wingArea * cd;
    _tmp.copy(vel).multiplyScalar(-dragMag / speed);
    _force.add(_tmp);

    // Side force from sideslip: airflow from the side pushes the jet laterally,
    // curving the velocity to follow the nose — this is what makes rudder/yaw
    // actually turn your flight path (and lets turns coordinate themselves).
    const vSide = vel.dot(_right);
    const sideMag = qDyn * def.wingArea * 0.8 * (vSide / speed);
    _tmp.copy(_right).multiplyScalar(-sideMag);
    _force.add(_tmp);
  }

  // Gravity
  _force.y -= GRAVITY * def.mass;

  // Integrate linear motion (semi-implicit Euler)
  const invMass = 1 / def.mass;
  vel.addScaledVector(_force, invMass * dt);
  // World-movement multiplier: how far airspeed carries you through the world.
  // Bumped so jets feel like jets (covering ground) rather than fast helicopters.
  state.position.addScaledVector(vel, dt * 1.6);

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
  const yaw = sc.yaw * def.yawRate * authority;

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
    const levelish = _up.y > 0.7;     // wings/nose within ~45° of level
    const gearUp = !controls.gear;    // wheels must be down to land
    // A real landing now: wheels down, gentle sink, wings level. Otherwise — if
    // we're moving with any speed — it's a crash (slam, belly-flop, or cartwheel).
    if (speed > 30 && (sinkRate > 11 || !levelish || gearUp)) {
      state.crashed = true; // slammed in too hard, not level, or no gear
    } else {
      vel.y = Math.max(0, vel.y);
      state.onGround = true;

      // Wheels: no sideways slide — redirect horizontal velocity along heading.
      _fwd.set(0, 0, -1).applyQuaternion(q);
      const hlen = Math.hypot(_fwd.x, _fwd.z) || 1;
      const hx = _fwd.x / hlen, hz = _fwd.z / hlen;
      let gs = Math.hypot(vel.x, vel.z);
      // Rolling resistance, plus strong wheel braking when the brake is held.
      const decel = controls.brake ? 70 : 1.5;
      gs = Math.max(0, gs - decel * dt);
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
    altitude, // height above sea level (0 at the water surface)
    heading,
    throttle: controls.throttle,
    aoa: THREE.MathUtils.radToDeg(aoa),
    gForce: 1 * _up.y + liftG, // rough: gravity component + aero load
    vspeed: vel.y,
    stall: stalling && speed > 5,
    mach: speed / 340,
  };
}

// ---- Helicopter dynamics ------------------------------------------------
// A different beast entirely. The rotor makes thrust along the *body up* axis;
// you fly by tilting the whole airframe (cyclic) so that thrust gets a sideways
// component, while the collective (throttle) sets how hard the rotor pushes.
//   - throttle 1/twr  => hover (rotor thrust balances weight)
//   - tilt nose-down  => the thrust vector leans forward, you accelerate
//   - tail rotor      => pedal yaw, spins the heading on the spot
//   - cyclic self-centres back to level, so letting go returns you to a hover
// No wing, no stall, lots of drag — it bleeds speed the instant you level off.
export function stepHeli(state, def, controls, dt, groundHeight) {
  const q = state.quaternion;
  _fwd.set(0, 0, -1).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  _right.set(1, 0, 0).applyQuaternion(q);

  const vel = state.velocity;
  const speed = vel.length();
  const altitude = state.position.y - SEA_LEVEL;
  const rho = airDensity(altitude);

  _force.set(0, 0, 0);

  // Collective -> rotor thrust along the (tilted) body-up axis. Air thins with
  // altitude so the rotor loses bite up high (a service ceiling, gently).
  const hoverThrust = def.mass * GRAVITY;
  const densityFactor = 0.72 + 0.28 * (rho / 1.225);
  const thrustMag = hoverThrust * def.twr * controls.throttle * densityFactor;
  _tmp.copy(_up).multiplyScalar(thrustMag);
  _force.add(_tmp);

  // Body drag (no wings to help) — quadratic, lumped Cd*A from the def.
  if (speed > 0.05) {
    const dragMag = 0.5 * rho * speed * speed * def.bodyDrag;
    _tmp.copy(vel).multiplyScalar(-dragMag / speed);
    _force.add(_tmp);
  }

  // Gravity
  _force.y -= GRAVITY * def.mass;

  // Integrate linear motion. Helis cover less ground per m/s than jets.
  const invMass = 1 / def.mass;
  vel.addScaledVector(_force, invMass * dt);
  state.position.addScaledVector(vel, dt * 1.3);

  // --- Attitude control: cyclic (pitch/roll) + pedal (yaw) -----------------
  const sc = state.sctrl;
  const sm = 1 - Math.exp(-dt / 0.14);
  sc.pitch += (controls.pitch - sc.pitch) * sm;
  sc.roll += (controls.roll - sc.roll) * sm;
  sc.yaw += (controls.yaw - sc.yaw) * sm;

  // Rate command from cyclic, minus a self-levelling rate proportional to the
  // current tilt away from level. The equilibrium tilt at full stick is
  // pitchRate/levelRate, so the airframe naturally caps how far it leans and
  // springs back to a hover when you release.
  const pitch = sc.pitch * def.pitchRate - _fwd.y * def.levelRate;
  const roll = sc.roll * def.rollRate + _right.y * def.levelRate;
  const yaw = sc.yaw * def.yawRate;
  _euler.set(pitch * dt, yaw * dt, -roll * dt, "XYZ");
  _dq.setFromEuler(_euler);
  q.multiply(_dq).normalize();

  // --- Ground / sea interaction (set down on skids anywhere) ---------------
  const overWater = groundHeight < SEA_LEVEL;
  const surfaceY = overWater ? SEA_LEVEL : groundHeight;
  const groundY = surfaceY + 1.4;
  if (state.position.y <= groundY) {
    state.position.y = groundY;
    if (overWater) {
      if (speed > 6) state.crashed = true; // ditching in the sea
      else { vel.set(0, 0, 0); state.onGround = false; }
    } else {
      const sinkRate = -vel.y;
      if (sinkRate > 9) {
        state.crashed = true; // dropped onto the skids too hard
      } else {
        vel.y = Math.max(0, vel.y);
        state.onGround = true;
        // Skid friction (strong braking if held); kill sideways slide gently.
        let gs = Math.hypot(vel.x, vel.z);
        const decel = controls.brake ? 45 : 9;
        const ngs = Math.max(0, gs - decel * dt);
        const f = gs > 1e-3 ? ngs / gs : 0;
        vel.x *= f; vel.z *= f;
        // Settle flat on the ground; still allow a pedal turn on the skids.
        _euler.setFromQuaternion(q, "YXZ");
        const blend = 1 - Math.exp(-dt / 0.2);
        _euler.x = THREE.MathUtils.lerp(_euler.x, 0, blend);
        _euler.z = THREE.MathUtils.lerp(_euler.z, 0, blend);
        _euler.y -= sc.yaw * def.yawRate * dt;
        q.setFromEuler(_euler);
      }
    }
  } else {
    state.onGround = false;
  }

  // --- Telemetry -----------------------------------------------------------
  _euler.setFromQuaternion(q, "YXZ");
  const heading = (THREE.MathUtils.radToDeg(-_euler.y) + 360) % 360;
  state.telemetry = {
    speed, altitude, heading,
    throttle: controls.throttle,
    aoa: 0, gForce: _up.y, vspeed: vel.y, stall: false, mach: speed / 340,
  };
}
