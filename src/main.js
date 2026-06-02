import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight } from "./world.js";
import { Input } from "./input.js";
import { Hud } from "./hud.js";
import { UI } from "./ui.js";
import { TouchControls } from "./touch.js";
import { TiltControls } from "./tilt.js";
import { Weapons } from "./weapons.js";
import { Enemies } from "./enemies.js";
import { Explosions } from "./fx.js";

// --- Renderer / scene / camera ---
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 30000);

const world = buildWorld(scene);
const fx = new Explosions(scene);
const weapons = new Weapons(scene, fx);
const enemies = new Enemies(scene, fx);
const hud = new Hud(document.getElementById("hud"));
const input = new Input();
const touch = new TouchControls(input.touchState);
const tilt = new TiltControls(input.touchState);

// --- Game state ---
let state = createState();
let def = AIRCRAFT.f16;
let jetType = "f16";
let mesh = null;
let flying = false;
let gameMode = "dogfight";

const CAMS = ["Chase", "Far Chase", "Cockpit"];
let camIndex = 0;
let ringsHit = 0;

// The player as a combat target the enemy can damage.
const player = {
  radius: 9,
  health: 100,
  get position() { return state.position; },
  get alive() { return flying && !state.crashed; },
  applyDamage(d) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - d);
    if (this.health <= 0) {
      state.crashed = true;
      ui.showBanner("SHOT DOWN", "Press R / RESET to respawn");
    }
  },
};

function missilesForMode(mode) { return mode === "free" ? 0 : 6; }

const ui = new UI(input, {
  onFly: (type, mode) => startFlight(type, mode),
}, touch, tilt);

// --- Fullscreen ("takeover") ---
function fullscreenSupported() {
  return !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
}
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function enterFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn) { try { fn.call(el); } catch (_) {} }
}
function toggleFullscreen() {
  if (isFullscreen()) {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) { try { fn.call(document); } catch (_) {} }
  } else {
    enterFullscreen();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") togglePause();
  if (e.code === "KeyF") toggleFullscreen();
});

// Wire the menu's fullscreen button (hide it where unsupported, e.g. iPhone).
const fsBtn = document.getElementById("btn-fullscreen");
if (fsBtn) {
  if (!fullscreenSupported()) fsBtn.style.display = "none";
  else fsBtn.addEventListener("click", toggleFullscreen);
}

function setAircraft(type) {
  jetType = type;
  def = AIRCRAFT[type];
  if (mesh) scene.remove(mesh);
  mesh = buildAircraftMesh(type);
  scene.add(mesh);
}

function resetFlight() {
  state = createState();
  ringsHit = 0;
  world.rings.forEach((r) => { r.visible = true; r.userData.hit = false; });
  weapons.reset(missilesForMode(gameMode));
  enemies.setMode(gameMode);
  player.health = 100;
  fx.reset();
  ui.hideBanner();
}

function startFlight(type, mode) {
  gameMode = mode || gameMode;
  setAircraft(type);
  resetFlight();
  flying = true;
  touch.setVisible(true);
  // On touch devices, take over the full screen for an immersive cockpit.
  if (touch.enabled && fullscreenSupported() && !isFullscreen()) enterFullscreen();
}

function togglePause() {
  if (!mesh) return;
  if (flying) {
    flying = false;
    touch.setVisible(false);
    ui.showMenu();
  } else if (ui.menu.classList.contains("hidden") === false) {
    // resuming from menu is done via FLY button
  }
}

// --- Camera positioning per mode ---
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function updateCamera(dt) {
  const mode = CAMS[camIndex];
  const pos = state.position;
  const q = state.quaternion;

  if (mode === "Cockpit") {
    const eye = _v.set(0, 0.5, -1.5).applyQuaternion(q).add(pos);
    camera.position.copy(eye);
    const look = new THREE.Vector3(0, 0.3, -20).applyQuaternion(q).add(pos);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    camera.lookAt(look);
    return;
  }

  const dist = mode === "Far Chase" ? 60 : 24;
  const height = mode === "Far Chase" ? 16 : 8;
  const behind = _v.set(0, height, dist).applyQuaternion(q).add(pos);
  // smooth follow
  const lerp = 1 - Math.pow(0.0008, dt);
  camPos.lerp(behind, lerp);
  if (camPos.lengthSq() === 0) camPos.copy(behind);
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camTarget.copy(pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(q), 30);
  camTarget.y += 4;
  camera.lookAt(camTarget);
}

// --- Ring checkpoint detection ---
function checkRings() {
  for (const ring of world.rings) {
    if (ring.userData.hit) continue;
    if (state.position.distanceTo(ring.position) < 130) {
      ring.userData.hit = true;
      ring.visible = false;
      ringsHit++;
    }
  }
}

// --- Fixed-timestep loop ---
const PHYS_DT = 1 / 120;
let acc = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab-out

  const controls = input.getControls(dt);

  // Live monitor for the settings panel
  ui.updateMonitors();

  if (flying && !state.crashed) {
    if (controls.viewPressed) camIndex = (camIndex + 1) % CAMS.length;
    if (controls.resetPressed) resetFlight();

    acc += dt;
    let steps = 0;
    while (acc >= PHYS_DT && steps < 8) {
      const gh = terrainHeight(state.position.x, state.position.z);
      step(state, def, controls, PHYS_DT, gh);
      acc -= PHYS_DT;
      steps++;
    }
    checkRings();

    if (controls.fire) weapons.fire(state.position, state.quaternion);
    if (controls.missilePressed) weapons.fireMissile(state.position, state.quaternion);
    weapons.update(dt, state.position, state.quaternion, enemies.targets);
    enemies.update(dt, player);
    fx.update(dt);

    if (state.crashed && player.health > 0) {
      ui.showBanner("CRASHED", "Press R / RESET to respawn");
    }
  } else if (flying && state.crashed) {
    // keep effects animating on the wreckage screen
    fx.update(dt);
    if (controls.resetPressed) resetFlight();
  }

  // Sync mesh to physics state
  if (mesh) {
    mesh.position.copy(state.position);
    mesh.quaternion.copy(state.quaternion);
    mesh.visible = CAMS[camIndex] !== "Cockpit";
    const flames = mesh.userData.flames;
    if (flames) {
      const t = state.telemetry.throttle;
      const op = t > 0.6 ? (t - 0.6) / 0.4 * 0.8 : 0;
      for (const fl of flames) {
        fl.material.opacity = op;
        fl.scale.setScalar((fl.userData.base || 1) * (0.6 + t * 0.8));
      }
    }
  }

  // Spin rings for visibility
  for (const r of world.rings) r.rotation.z += dt * 0.5;

  updateCamera(dt);
  renderer.render(scene, camera);

  // HUD
  if (flying) {
    // Project the locked target to screen space for the lock box.
    let lock = null;
    if (weapons.lock && weapons.lock.alive) {
      _v.copy(weapons.lock.position).project(camera);
      if (_v.z < 1) {
        lock = {
          x: (_v.x * 0.5 + 0.5) * hud.w,
          y: (-_v.y * 0.5 + 0.5) * hud.h,
          dist: state.position.distanceTo(weapons.lock.position),
        };
      }
    }
    hud.draw(state.telemetry, {
      jetName: def.name,
      camName: CAMS[camIndex],
      mode: gameMode,
      checkpoints: world.rings.length,
      ringsHit,
      kills: enemies.kills,
      bandits: enemies.alive(),
      health: player.health,
      missiles: weapons.missileCount,
      lock,
    });
  } else {
    hud.ctx.clearRect(0, 0, hud.w, hud.h);
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Preview aircraft on the menu so the scene isn't empty.
setAircraft("f16");
state.position.set(0, terrainHeight(0, 0) + 200, -200);
requestAnimationFrame(frame);
