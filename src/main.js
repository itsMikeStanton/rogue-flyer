import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight, groundHeightAt, getCarriers } from "./world.js";
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
import { Editor } from "./editor.js";

// --- Renderer / scene / camera ---
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.xr.enabled = true; // seated VR (head rides in the cockpit)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 30000);
// In VR the camera is parented to this rig, which we pin to the cockpit each
// frame; the headset pose then adds head movement/look on top.
const playerRig = new THREE.Group();
scene.add(playerRig);
let inXR = false;
let vrLevelHorizon = false, vrVignetteOn = false; // VR comfort options

const world = buildWorld(scene);
const fx = new Explosions(scene);
const weapons = new Weapons(scene, fx);
const enemies = new Enemies(scene, fx);
const ground = new GroundTargets(scene, fx);
const sound = new SoundEngine();
fx.onAdd = (size, pos) => sound.explosion(size, pos); // positional booms
enemies.onFire = (pos) => sound.enemyGun(pos);         // positional enemy guns
ground.onFire = (pos) => sound.enemyGun(pos);          // carrier flak
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

// Throttle "arming" gesture before a flight begins (see updateArming).
let armActive = false, armUp = false, armOpposite = false, armInit = false, armHint = "";
const ARM_HI = 0.9, ARM_LO = 0.08;

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
      fx.burst(state.position, def.color, 16);
      sound.stopEngine();
      ui.showBanner("SHOT DOWN", "Press R / RESET to respawn");
    }
  },
};

function missilesForMode(mode) { return mode === "free" ? 0 : 6; }

const ui = new UI(input, {
  onFly: (type, mode, start) => startFlight(type, mode, start),
  onVR: (type, mode, start) => enterVR(type, mode, start),
  onSelectJet: (type) => { if (!flying) setAircraft(type); }, // live hero swap on the menu
}, touch, tilt);

// World editor (top-down). Entered from the menu button or ?edit.
const editor = new Editor(scene, renderer, hud);
editor.onExit = () => ui.showMenu();
const edBtn = document.getElementById("btn-editor");
if (edBtn) edBtn.addEventListener("click", () => { ui.hideAll(); touch.setVisible(false); editor.enter(); });

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
  if (soundBtn) { soundBtn.textContent = muted ? "🔇" : "🔊"; soundBtn.title = muted ? "Sound off" : "Sound on"; }
}
if (soundBtn) {
  updateSoundButton(sound.muted);
  soundBtn.addEventListener("click", () => { sound.resume(); updateSoundButton(sound.toggleMute()); });
}

// VR comfort toggles (default off to honour 1:1 head motion).
try {
  vrLevelHorizon = localStorage.getItem("rf.vrLevel") === "1";
  vrVignetteOn = localStorage.getItem("rf.vrVig") === "1";
} catch (_) { /* ignore */ }
const vlBox = document.getElementById("vr-level");
if (vlBox) { vlBox.checked = vrLevelHorizon; vlBox.addEventListener("change", () => { vrLevelHorizon = vlBox.checked; try { localStorage.setItem("rf.vrLevel", vlBox.checked ? "1" : "0"); } catch (_) {} }); }
const vvBox = document.getElementById("vr-vignette");
if (vvBox) { vvBox.checked = vrVignetteOn; vvBox.addEventListener("change", () => { vrVignetteOn = vvBox.checked; try { localStorage.setItem("rf.vrVig", vvBox.checked ? "1" : "0"); } catch (_) {} }); }

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
    const c = getCarriers().find((k) => k.team === "ally");
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
  ground.setActive(gameMode === "mission", world.carriers.enemy, getCarriers().find((c) => c.team === "enemy"));
  missionDone = false;
  player.health = 100;
  fx.reset();
  ui.hideBanner();
  // Require a deliberate throttle gesture before the sim runs: idle for a ground
  // start (so a parked jet doesn't bolt), full for an air start.
  armActive = true;
  armUp = startPos === "air";
  armInit = false;
  armHint = "";
}

function startFlight(type, mode, start, vr) {
  gameMode = mode || gameMode;
  startPos = start || "air";
  setAircraft(type);
  resetFlight();
  flying = true;
  lastLock = null;
  touch.setVisible(true);
  sound.resume();
  sound.startEngine();
  // On touch devices, take over the full screen for an immersive cockpit — but
  // never in VR (that would fight the immersive XR session for the gesture).
  if (!vr && touch.enabled && fullscreenSupported() && !isFullscreen()) enterFullscreen();
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

  // Speed-driven FOV kick for a sense of velocity.
  const targetFov = 70 + THREE.MathUtils.clamp((state.velocity.length() - 140) * 0.06, 0, 18);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();

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

// Touch-controller flight input for VR (backup when no USB stick is exposed).
// Left stick = roll/pitch, right stick = yaw + throttle (integrated), triggers
// fire, A = missile, B/Y = flares, stick-press = camera. A real (non-XR)
// gamepad, if the browser exposes one in VR, overrides the sticks.
let xrThrottle = 0;
const xrEdge = {};
function xrPressed(id, down) { const was = xrEdge[id] || false; xrEdge[id] = down; return down && !was; }
function getXRControls(dt) {
  let pitch = 0, roll = 0, yaw = 0;
  let fire = false, missilePressed = false, flarePressed = false, viewPressed = false, resetPressed = false;
  const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
  const session = renderer.xr.getSession();
  let usedStick = false;
  if (session) for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const ax = gp.axes, bt = gp.buttons;
    const sx = dz(ax.length >= 4 ? ax[2] : (ax[0] || 0));
    const sy = dz(ax.length >= 4 ? ax[3] : (ax[1] || 0));
    const btn = (i) => bt[i] && bt[i].pressed;
    if (btn(0)) fire = true; // either trigger fires
    if (src.handedness === "right") {
      yaw += sx;
      xrThrottle = THREE.MathUtils.clamp(xrThrottle - sy * dt * 0.9, 0, 1); // push up = more throttle
      usedStick = true;
      if (xrPressed("xR-msl", btn(4))) missilePressed = true; // A
      if (xrPressed("xR-flr", btn(5))) flarePressed = true;   // B
      if (xrPressed("xR-view", btn(3))) viewPressed = true;   // stick press
    } else { // left (and any unknown handedness)
      roll += sx; pitch += sy;
      if (xrPressed("xL-flr", btn(5))) flarePressed = true;   // Y
      if (xrPressed("xL-reset", btn(4))) resetPressed = true; // X
      if (xrPressed("xL-view", btn(3))) viewPressed = true;
    }
  }
  // A genuine USB/Bluetooth stick (non-XR mapping) takes over the axes if present.
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let stick = null;
  for (const p of pads) if (p && p.mapping !== "xr-standard") { stick = p; break; }
  if (stick) {
    roll = input.readAxis(stick, input.bindings.roll);
    pitch = input.readAxis(stick, input.bindings.pitch);
    yaw = input.readAxis(stick, input.bindings.yaw);
    const t = input.bindings.throttle; let raw = stick.axes[t.axis] || 0; if (t.invert) raw = -raw;
    xrThrottle = (raw + 1) / 2;
    const b = input.bindings.buttons;
    if (stick.buttons[b.fire] && stick.buttons[b.fire].pressed) fire = true;
    if (xrPressed("us-msl", !!(stick.buttons[b.missile] && stick.buttons[b.missile].pressed))) missilePressed = true;
    usedStick = true;
  }
  return {
    pitch: Math.max(-1, Math.min(1, pitch)),
    roll: Math.max(-1, Math.min(1, roll)),
    yaw: Math.max(-1, Math.min(1, yaw)),
    throttle: usedStick ? xrThrottle : 0,
    viewPressed, resetPressed, fire, missilePressed, flarePressed,
  };
}

// Cinematic idle: orbit a gently banking jet with a soft afterburner glow so
// the menu reads as a living scene rather than a parked preview.
let menuT = 0;
const _e = new THREE.Euler();
function menuCinematic(dt) {
  menuT += dt;
  const jx = 0, jz = -160;
  const jy = terrainHeight(jx, jz) + 240;
  if (mesh) {
    const bank = Math.sin(menuT * 0.45) * 0.32;
    const pitch = Math.sin(menuT * 0.32) * 0.07;
    mesh.position.set(jx, jy + Math.sin(menuT * 0.6) * 5, jz);
    _e.set(pitch, 0, bank);
    mesh.quaternion.setFromEuler(_e);
    mesh.visible = true;
    const flames = mesh.userData.flames;
    if (flames) for (const fl of flames) {
      fl.material.opacity = 0.32 + Math.sin(menuT * 6) * 0.08;
      fl.scale.setScalar((fl.userData.base || 1) * 0.9);
    }
  }
  const r = 46, a = menuT * 0.16;
  camera.position.set(jx + Math.cos(a) * r, jy + 14 + Math.sin(menuT * 0.22) * 4, jz + Math.sin(a) * r);
  camera.up.set(0, 1, 0);
  camera.lookAt(jx, jy + 2, jz);
  camera.fov += (58 - camera.fov) * Math.min(1, dt * 2);
  camera.updateProjectionMatrix();
}

// Gate the start of a flight on a throttle gesture. Ground starts arm at idle
// (bump up-then-down if the lever is already idle); air starts arm at full
// (bump down-then-up if already full). Clears armActive when satisfied.
function updateArming(controls) {
  const t = controls.throttle;
  if (!armInit) {
    armInit = true;
    armOpposite = armUp ? t >= ARM_HI : t <= ARM_LO;
  }
  if (armOpposite) {
    if (armUp ? t <= ARM_LO : t >= ARM_HI) armOpposite = false;
  } else if (armUp ? t >= ARM_HI : t <= ARM_LO) {
    armActive = false;
    armHint = "";
    ui.hideBanner();
    return;
  }
  const hint = armUp
    ? (armOpposite ? "Throttle to IDLE, then to FULL to launch" : "Throttle to FULL to launch")
    : (armOpposite ? "Throttle UP, then back to IDLE to launch" : "Throttle to IDLE to launch");
  if (hint !== armHint) { armHint = hint; ui.showBanner("READY?", hint); }
}

// --- Seated VR: cockpit interior, in-headset HUD, comfort options ---
let vrCockpit = null, vrHudCanvas = null, vrHudCtx = null, vrHudTex = null, vrVignette = null;
const _prevQ = new THREE.Quaternion();

function buildVignetteTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 64, 128, 128, 150);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.7, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

function buildCockpit() {
  const grp = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.75, metalness: 0.35, side: THREE.DoubleSide });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.3), frame);
  dash.position.set(0, -0.62, -0.95); dash.rotation.x = -0.5; grp.add(dash);
  for (const s of [-1, 1]) {
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 1.3), frame);
    con.position.set(s * 0.78, -0.55, -0.15); grp.add(con);
  }
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 8, 24, Math.PI), frame);
  bow.position.set(0, 0.18, -0.35); bow.rotation.x = Math.PI / 2; grp.add(bow);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 28), frame);
  ring.position.set(0, -0.12, -1.0); grp.add(ring);
  // HUD screen on the dashboard
  vrHudCanvas = document.createElement("canvas"); vrHudCanvas.width = 512; vrHudCanvas.height = 256;
  vrHudCtx = vrHudCanvas.getContext("2d");
  vrHudTex = new THREE.CanvasTexture(vrHudCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.41),
    new THREE.MeshBasicMaterial({ map: vrHudTex, transparent: true }));
  screen.position.set(0, -0.5, -0.9); screen.rotation.x = -0.5; grp.add(screen);
  return grp;
}

function drawVRHud() {
  const c = vrHudCtx; if (!c) return;
  c.clearRect(0, 0, 512, 256);
  c.fillStyle = "rgba(6,20,14,0.6)"; c.fillRect(0, 0, 512, 256);
  c.strokeStyle = "#2ee6a6"; c.lineWidth = 4; c.strokeRect(6, 6, 500, 244);
  c.textBaseline = "middle";
  if (armActive) {
    c.fillStyle = "#ffd27d"; c.font = "bold 34px Consolas, monospace"; c.textAlign = "center";
    c.fillText("READY?", 256, 80);
    c.fillStyle = "#36ff9a"; c.font = "22px Consolas, monospace";
    c.fillText(armHint || "Move throttle", 256, 150);
    vrHudTex.needsUpdate = true; return;
  }
  c.fillStyle = "#36ff9a"; c.textAlign = "left"; c.font = "bold 44px Consolas, monospace";
  c.fillText(String(Math.round(state.telemetry.speed)), 28, 64);
  c.fillStyle = "#9fb3c4"; c.font = "16px Consolas, monospace"; c.fillText("KTS", 30, 104);
  c.fillStyle = "#36ff9a"; c.textAlign = "right"; c.font = "bold 44px Consolas, monospace";
  c.fillText(String(Math.round(state.position.y)), 484, 64);
  c.fillStyle = "#9fb3c4"; c.font = "16px Consolas, monospace"; c.fillText("ALT", 484, 104);
  c.fillStyle = "#16324a"; c.fillRect(28, 168, 456, 28);
  c.fillStyle = "#2ee6a6"; c.fillRect(28, 168, 456 * THREE.MathUtils.clamp(state.telemetry.throttle, 0, 1), 28);
  c.fillStyle = "#04140e"; c.font = "bold 16px Consolas, monospace"; c.textAlign = "left"; c.fillText("THR", 36, 183);
  if (weapons.lock) { c.fillStyle = "#ff5a5a"; c.font = "bold 24px Consolas, monospace"; c.textAlign = "center"; c.fillText("◎ LOCK", 256, 136); }
  vrHudTex.needsUpdate = true;
}

function updateVRRig(dt) {
  const q = state.quaternion;
  _v.set(0, 0.9, -1.6).applyQuaternion(q).add(state.position); // pilot's eye
  playerRig.position.copy(_v);
  if (vrLevelHorizon) {
    // Keep the horizon level: face the plane's heading, no roll/pitch.
    _v.set(0, 0, -1).applyQuaternion(q);
    const len = Math.hypot(_v.x, _v.z) || 1;
    playerRig.quaternion.setFromEuler(_e.set(0, Math.atan2(-_v.x / len, -_v.z / len), 0));
  } else {
    playerRig.quaternion.copy(q);
  }
  playerRig.updateMatrixWorld(true);

  if (vrVignette) {
    let target = 0;
    if (vrVignetteOn) {
      const ang = 2 * Math.acos(Math.min(1, Math.abs(_prevQ.dot(q)))); // turn this frame
      const rate = ang / Math.max(dt, 1e-3);
      target = THREE.MathUtils.clamp((rate - 0.5) / 2.2, 0, 0.85);
    }
    const m = vrVignette.material;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 6);
  }
  _prevQ.copy(q);
  drawVRHud();
}

renderer.xr.addEventListener("sessionstart", () => {
  inXR = true;
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  camera.near = 0.1; camera.updateProjectionMatrix(); // see the cockpit up close
  playerRig.add(camera);
  if (!vrCockpit) vrCockpit = buildCockpit();
  playerRig.add(vrCockpit);
  if (!vrVignette) {
    vrVignette = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: buildVignetteTexture(), transparent: true, depthTest: false, opacity: 0 }));
    vrVignette.position.set(0, 0, -0.5); vrVignette.renderOrder = 999;
  }
  camera.add(vrVignette);
  if (mesh) mesh.visible = false; // hide the exterior, you're inside now
  _prevQ.copy(state.quaternion);
});
renderer.xr.addEventListener("sessionend", () => {
  inXR = false;
  scene.add(camera); // detach from the rig for flatscreen
  camera.near = 1; camera.updateProjectionMatrix();
  if (vrCockpit) playerRig.remove(vrCockpit);
  if (vrVignette) camera.remove(vrVignette);
});

let xrSupported = false;
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported("immersive-vr").then((ok) => {
    xrSupported = ok;
    const b = document.getElementById("btn-vr");
    if (b && !ok) b.style.display = "none";
  });
} else {
  const b = document.getElementById("btn-vr");
  if (b) b.style.display = "none";
}

async function enterVR(type, mode, start) {
  if (!navigator.xr) {
    const why = !window.isSecureContext
      ? "the page isn't a secure context — load it over https://"
      : "this browser doesn't expose WebXR (use the Meta Quest Browser)";
    ui.showBanner("VR UNAVAILABLE", "navigator.xr missing — " + why + ".");
    return;
  }
  // requestSession MUST be the first call off the click gesture (no await before
  // it) or the browser drops the activation and refuses to go immersive.
  let session;
  try {
    session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
    });
  } catch (e) {
    ui.showBanner("VR REQUEST FAILED", "requestSession → " + ((e && e.name) || "") + ": " + ((e && e.message) || e));
    return;
  }
  try {
    renderer.xr.setReferenceSpaceType("local"); // seated: eye starts at the rig
    await renderer.xr.setSession(session);
  } catch (e) {
    ui.showBanner("VR START FAILED", "setSession → " + ((e && e.message) || e));
    return;
  }
  ui.hideAll();                       // only leave the menu once we're truly in VR
  startFlight(type, mode, start, true); // true = VR (skip fullscreen)
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
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab-out

  // World editor takes over rendering with its top-down camera.
  if (editor.active) { editor.render(); return; }

  const controls = inXR ? getXRControls(dt) : input.getControls(dt);

  // Live monitor for the settings panel
  ui.updateMonitors();

  // Throttle-arming gate: hold the sim until the player engages the throttle.
  if (flying && !state.crashed && armActive) updateArming(controls);

  if (flying && !state.crashed && !armActive) {
    if (controls.viewPressed) camIndex = (camIndex + 1) % CAMS.length;
    if (controls.resetPressed) resetFlight();

    // Gear + flaps auto-deploy at low speed / on the ground.
    const sp = state.telemetry.speed;
    controls.gear = state.onGround || sp < 110;
    controls.flaps = sp < 130;

    acc += dt;
    let steps = 0;
    while (acc >= PHYS_DT && steps < 8) {
      const gh = groundHeightAt(state.position.x, state.position.z);
      step(state, def, controls, PHYS_DT, gh);
      acc -= PHYS_DT;
      steps++;
    }
    checkRings();

    // Crash if we fly into a building.
    if (!state.crashed) {
      const px = state.position.x, py = state.position.y, pz = state.position.z;
      for (const b of world.colliders) {
        if (py < b.top + 2 && Math.abs(px - b.x) < b.hx + 6 && Math.abs(pz - b.z) < b.hz + 6) {
          state.crashed = true;
          break;
        }
      }
    }

    const isMission = gameMode === "mission";
    const activeTargets = isMission ? ground.targets : enemies.targets;
    if (controls.fire && weapons.fire(state.position, state.quaternion)) sound.gun();
    if (controls.missilePressed && weapons.fireMissile(state.position, state.quaternion)) sound.missile();
    weapons.update(dt, state.position, state.quaternion, activeTargets);
    enemies.update(dt, player);
    if (isMission) ground.update(dt, player);
    fx.update(dt);
    sound.updateEngine(state.telemetry.throttle, state.telemetry.speed);

    // Eject countermeasure flares.
    if (controls.flarePressed) {
      _v.set(0, 0, 1).applyQuaternion(state.quaternion);
      const away = _v.clone().multiplyScalar(Math.max(50, state.velocity.length()));
      const tail = state.position.clone().addScaledVector(_v, 6);
      for (let i = 0; i < 6; i++) fx.flare(tail, away);
    }

    if (isMission && ground.total > 0 && ground.remaining === 0 && !missionDone) {
      missionDone = true;
      ui.showBanner("MISSION COMPLETE", "Press R / RESET to fly again");
    }

    // Lock tone when a fresh target is acquired.
    if (weapons.lock && weapons.lock !== lastLock) sound.lock();
    lastLock = weapons.lock;

    if (state.crashed && player.health > 0) {
      fx.add(state.position, 2.6);
      fx.burst(state.position, def.color, 16);
      // If we slammed into the enemy carrier, blow it up too.
      for (const t of ground.targets) {
        if (t.info && t.alive &&
            Math.abs(state.position.x - t.info.x) < t.info.halfW + 14 &&
            Math.abs(state.position.z - t.info.z) < t.info.halfL + 14) {
          t.hit(99999);
        }
      }
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
    mesh.visible = inXR ? false : CAMS[camIndex] !== "Cockpit"; // exterior hidden in VR (cockpit inside)
    const flames = mesh.userData.flames;
    if (flames) {
      const t = state.telemetry.throttle;
      const op = t > 0.6 ? (t - 0.6) / 0.4 * 0.8 : 0;
      for (const fl of flames) {
        fl.material.opacity = op;
        fl.scale.setScalar((fl.userData.base || 1) * (0.6 + t * 0.8));
      }
    }
    // Gear + flaps animation following the auto-deploy state.
    const sp = state.telemetry.speed;
    const gearDown = state.onGround || sp < 110;
    const flapTarget = sp < 130 ? 0.5 : 0;
    if (mesh.userData.gear) mesh.userData.gear.visible = gearDown;
    if (mesh.userData.flaps) {
      for (const p of mesh.userData.flaps) p.rotation.x += (flapTarget - p.rotation.x) * Math.min(1, dt * 4);
    }
  }

  // Spin rings for visibility
  for (const r of world.rings) r.rotation.z += dt * 0.5;

  // Drift the cloud layer gently on the wind.
  if (world.clouds) world.clouds.position.x += dt * 3;

  // Animate the sea/river waves.
  if (world.waveMats) {
    const tsec = now / 1000;
    for (const m of world.waveMats) {
      if (m.userData.shader) m.userData.shader.uniforms.uTime.value = tsec;
    }
  }

  if (inXR) { updateVRRig(dt); sound.setListener(playerRig); }
  else if (flying) { updateCamera(dt); sound.setListener(camera); }
  else { menuCinematic(dt); sound.setListener(camera); }
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

// Jump straight into the editor with ?edit in the URL.
if (location.search.includes("edit")) { ui.hideAll(); editor.enter(); }

// Preview aircraft on the menu so the scene isn't empty.
setAircraft("f16");
state.position.set(0, terrainHeight(0, 0) + 200, -200);
renderer.setAnimationLoop(frame); // drives both flatscreen and the XR session

// Boot sequence: animate the loader, then fade it to reveal the live menu.
(function runLoader() {
  const el = document.getElementById("loader");
  if (!el) return;
  if (location.search.includes("edit")) { el.remove(); return; } // skip straight to editor
  const fill = el.querySelector(".load-fill");
  const status = el.querySelector(".load-status");
  const steps = ["BOOTING AVIONICS", "SPOOLING TURBINES", "CALIBRATING GYROS", "LINKING CONTROLS", "ARMING SYSTEMS"];
  const t0 = performance.now(), dur = 2200;
  let si = -1;
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    if (fill) fill.style.width = (p * 100).toFixed(0) + "%";
    const idx = Math.min(steps.length - 1, Math.floor(p * steps.length));
    if (idx !== si && status) { si = idx; status.textContent = steps[idx]; }
    if (p < 1) requestAnimationFrame(tick);
    else {
      if (status) status.textContent = "READY";
      setTimeout(() => {
        ui.showMenu();            // reveal the menu only now
        el.classList.add("done"); // fade the loader out
        setTimeout(() => el.remove(), 700);
      }, 280);
    }
  })(t0);
})();
