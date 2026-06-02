import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight } from "./world.js";
import { Input } from "./input.js";
import { Hud } from "./hud.js";
import { UI } from "./ui.js";

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
const hud = new Hud(document.getElementById("hud"));
const input = new Input();

// --- Game state ---
let state = createState();
let def = AIRCRAFT.f16;
let jetType = "f16";
let mesh = null;
let flying = false;

const CAMS = ["Chase", "Far Chase", "Cockpit"];
let camIndex = 0;
let ringsHit = 0;

const ui = new UI(input, {
  onFly: (type) => startFlight(type),
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") togglePause();
});

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
  ui.hideBanner();
}

function startFlight(type) {
  setAircraft(type);
  resetFlight();
  flying = true;
}

function togglePause() {
  if (!mesh) return;
  if (flying) {
    flying = false;
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

    if (state.crashed) {
      ui.showBanner("CRASHED", "Press R to respawn");
    }
  } else if (flying && state.crashed && controls.resetPressed) {
    resetFlight();
  }

  // Sync mesh to physics state
  if (mesh) {
    mesh.position.copy(state.position);
    mesh.quaternion.copy(state.quaternion);
    mesh.visible = CAMS[camIndex] !== "Cockpit";
    const flame = mesh.getObjectByName("afterburner");
    if (flame) {
      const t = state.telemetry.throttle;
      flame.material.opacity = t > 0.6 ? (t - 0.6) / 0.4 * 0.8 : 0;
      flame.scale.setScalar(0.6 + t * 0.8);
    }
  }

  // Spin rings for visibility
  for (const r of world.rings) r.rotation.z += dt * 0.5;

  updateCamera(dt);
  renderer.render(scene, camera);

  // HUD
  if (flying) {
    hud.draw(state.telemetry, {
      jetName: def.name,
      camName: CAMS[camIndex],
      checkpoints: world.rings.length,
      ringsHit,
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
