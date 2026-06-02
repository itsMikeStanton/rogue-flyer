import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight, groundHeightAt, CARRIERS } from "./world.js";
import { Input } from "./input.js";
import { Hud } from "./hud.js";
import { UI } from "./ui.js";
import { TouchControls } from "./touch.js";
import { TiltControls } from "./tilt.js";
import { Weapons } from "./weapons.js";
import { Enemies } from "./enemies.js";
import { GroundTargets } from "./ground.js";
import { Explosions } from "./fx.js";
import { SoundEngine } from "./audio.js";

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
const ground = new GroundTargets(scene, fx);
const sound = new SoundEngine();
fx.onAdd = (size, pos) => sound.explosion(size, pos); // positional booms
enemies.onFire = (pos) => sound.enemyGun(pos);         // positional enemy guns
let lastLock = null;
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
let missionDone = false;
let startPos = "air"; // "air" | "runway" | "carrier"

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
    sound.hit();
    if (this.health <= 0) {
      state.crashed = true;
      fx.add(state.position, 2.6);
      sound.stopEngine();
      ui.showBanner("SHOT DOWN", "Press R / RESET to respawn");
    }
  },
};

function missilesForMode(mode) { return mode === "free" ? 0 : 6; }

const ui = new UI(input, {
  onFly: (type, mode, start) => startFlight(type, mode, start),
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
  if (e.code === "KeyM") updateSoundButton(sound.toggleMute());
});

// Resume audio on the first user interaction (browser autoplay policy).
function unlockAudio() {
  sound.resume();
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Mute toggle button on the menu.
const soundBtn = document.getElementById("btn-sound");
function updateSoundButton(muted) {
  if (soundBtn) soundBtn.textContent = muted ? "🔇 Sound off" : "🔊 Sound on";
}
if (soundBtn) {
  updateSoundButton(sound.muted);
  soundBtn.addEventListener("click", () => { sound.resume(); updateSoundButton(sound.toggleMute()); });
}

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
  if (startPos === "runway") {
    // Park at the start of the runway, level, stopped, throttle idle.
    const z = 520;
    state.position.set(0, terrainHeight(0, z) + 1.5, z);
    state.velocity.set(0, 0, 0);
    state.quaternion.identity();
    state.onGround = true;
    input.kbThrottle = 0;
  } else if (startPos === "carrier") {
    // Spotted at the back of our carrier deck; a catapult kick to start.
    const c = CARRIERS.find((k) => k.team === "ally");
    state.position.set(c.x, c.deckY + 1.5, c.z + c.halfL - 30);
    state.velocity.set(0, 0, -60);
    state.quaternion.identity();
    state.onGround = true;
    input.kbThrottle = 0.7;
  }
  ringsHit = 0;
  world.rings.forEach((r) => { r.visible = true; r.userData.hit = false; });
  weapons.reset(missilesForMode(gameMode));
  enemies.setMode(gameMode);
  ground.setActive(gameMode === "mission");
  missionDone = false;
  player.health = 100;
  fx.reset();
  ui.hideBanner();
}

function startFlight(type, mode, start) {
  gameMode = mode || gameMode;
  startPos = start || "air";
  setAircraft(type);
  resetFlight();
  flying = true;
  lastLock = null;
  touch.setVisible(true);
  sound.resume();
  sound.startEngine();
  // On touch devices, take over the full screen for an immersive cockpit.
  if (touch.enabled && fullscreenSupported() && !isFullscreen()) enterFullscreen();
}

function togglePause() {
  if (!mesh) return;
  if (flying) {
    flying = false;
    touch.setVisible(false);
    sound.stopEngine();
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
      const gh = groundHeightAt(state.position.x, state.position.z);
      step(state, def, controls, PHYS_DT, gh);
      acc -= PHYS_DT;
      steps++;
    }
    checkRings();

    const isMission = gameMode === "mission";
    const activeTargets = isMission ? ground.targets : enemies.targets;
    if (controls.fire && weapons.fire(state.position, state.quaternion)) sound.gun();
    if (controls.missilePressed && weapons.fireMissile(state.position, state.quaternion)) sound.missile();
    weapons.update(dt, state.position, state.quaternion, activeTargets);
    enemies.update(dt, player);
    if (isMission) ground.update(dt);
    fx.update(dt);
    sound.updateEngine(state.telemetry.throttle, state.telemetry.speed);

    if (isMission && ground.total > 0 && ground.remaining === 0 && !missionDone) {
      missionDone = true;
      ui.showBanner("MISSION COMPLETE", "Press R / RESET to fly again");
    }

    // Lock tone when a fresh target is acquired.
    if (weapons.lock && weapons.lock !== lastLock) sound.lock();
    lastLock = weapons.lock;

    if (state.crashed && player.health > 0) {
      fx.add(state.position, 2.6);
      sound.stopEngine();
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

  // Drift the cloud layer gently on the wind.
  if (world.clouds) world.clouds.position.x += dt * 3;

  updateCamera(dt);
  sound.setListener(camera);
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
    // Mission objective marker: point to the nearest surviving ground target.
    let objective = null;
    if (gameMode === "mission") {
      let best = null, bd = Infinity;
      for (const t of ground.targets) {
        if (!t.alive) continue;
        const d = state.position.distanceTo(t.position);
        if (d < bd) { bd = d; best = t; }
      }
      if (best) {
        _v.copy(best.position).project(camera);
        objective = {
          ndcx: _v.x, ndcy: _v.y, behind: _v.z > 1,
          onscreen: _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1,
          x: (_v.x * 0.5 + 0.5) * hud.w,
          y: (-_v.y * 0.5 + 0.5) * hud.h,
          dist: bd,
        };
      }
    }
    const isMissionHud = gameMode === "mission";
    hud.draw(state.telemetry, {
      jetName: def.name,
      camName: CAMS[camIndex],
      mode: gameMode,
      onGround: state.onGround,
      checkpoints: world.rings.length,
      ringsHit,
      kills: isMissionHud ? ground.destroyed : enemies.kills,
      bandits: isMissionHud ? ground.remaining : enemies.alive(),
      total: isMissionHud ? ground.total : null,
      health: player.health,
      missiles: weapons.missileCount,
      lock,
      objective,
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

// Show the deployed build version on the home screen (stamped at deploy time).
const versionEl = document.getElementById("version");
if (versionEl) {
  fetch("version.json?ts=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => { versionEl.textContent = `build ${v.build} · ${v.sha} · ${v.built}`; })
    .catch(() => { versionEl.textContent = "build dev"; });
}

// Preview aircraft on the menu so the scene isn't empty.
setAircraft("f16");
state.position.set(0, terrainHeight(0, 0) + 200, -200);
requestAnimationFrame(frame);
