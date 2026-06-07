import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight, groundHeightAt, getCarriers, SEA_LEVEL } from "./world.js";
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
import { PostFX } from "./postfx.js";
import { Weather } from "./weather.js";
import { Smokestacks } from "./smoke.js";
import { Wrecks } from "./wreckage.js";
import { Net } from "./net.js";

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
let lastLocked = false;
const hud = new Hud(document.getElementById("hud"));

// Post-processing (bloom + colour grade). Off in VR. Look chosen in settings.
const post = new PostFX(renderer, scene, camera);
let fxLook = "cinematic";
try { fxLook = localStorage.getItem("rf.fx") || "cinematic"; } catch (_) { /* ignore */ }
if (fxLook === "golden") fxLook = "vivid"; // retired look -> nearest replacement
post.setLook(fxLook);
const fxSel = document.getElementById("fx-look");
if (fxSel) {
  fxSel.value = fxLook;
  fxSel.addEventListener("change", () => {
    fxLook = fxSel.value;
    post.setLook(fxLook);
    try { localStorage.setItem("rf.fx", fxLook); } catch (_) { /* ignore */ }
  });
}

// Chimney / power-plant smoke plumes (world scenery + live strike targets).
const smoke = new Smokestacks(scene);
smoke.addSources(world.smokeSources);
// Persistent crash wreckage (debris + fire + smoke) left in the world.
const wrecks = new Wrecks(scene, smoke);

// Spatial hash of (sub-sampled) trees so explosions can set nearby trees alight
// without scanning the whole forest. Each entry carries instance handles so a
// burnt-down tree can be removed.
const TREE_CELL = 140;
const TREES = world.trees || [];
const treeGrid = new Map();
for (let i = 0; i < TREES.length; i++) {
  const tr = TREES[i];
  const k = ((tr.x / TREE_CELL) | 0) + "," + ((tr.z / TREE_CELL) | 0);
  let arr = treeGrid.get(k); if (!arr) { arr = []; treeGrid.set(k, arr); }
  arr.push(i);
}
const _ZEROMAT = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
const burningTrees = []; // { tr, timer } — vanish the tree when its timer runs out
function igniteTreesNear(pos, size) {
  if (wrecks.fireCount > 150 || TREES.length === 0) return; // throttle runaway fires
  const R = 130 + size * 45, R2 = R * R, MAX = 16; // way bigger blast radius
  const cells = Math.ceil(R / TREE_CELL);
  const cx = (pos.x / TREE_CELL) | 0, cz = (pos.z / TREE_CELL) | 0;
  let lit = 0;
  for (let gx = cx - cells; gx <= cx + cells && lit < MAX; gx++) {
    for (let gz = cz - cells; gz <= cz + cells && lit < MAX; gz++) {
      const arr = treeGrid.get(gx + "," + gz); if (!arr) continue;
      for (const idx of arr) {
        if (lit >= MAX) break;
        const tr = TREES[idx];
        if (tr.burning) continue;
        const dx = tr.x - pos.x, dz = tr.z - pos.z;
        if (dx * dx + dz * dz > R2) continue;
        if (pos.y - tr.y > 90 || tr.y - pos.y > 50) continue; // blast must be near the trees
        if (Math.random() < 0.55) {
          tr.burning = true;
          const life = 6 + Math.random() * 3;
          // Fire sprouts from the greenery (canopy height), not the trunk.
          wrecks.spawnFire(new THREE.Vector3(tr.x, tr.cy, tr.z), { scale: 1.6, life, color: 0x2a261c, scorch: false });
          burningTrees.push({ tr, timer: life * 0.7 }); // burns down, then the tree vanishes
          lit++;
        }
      }
    }
  }
}
// Remove burnt-down trees once their timer elapses (call from the frame loop).
function updateBurningTrees(dt) {
  for (let i = burningTrees.length - 1; i >= 0; i--) {
    const b = burningTrees[i];
    b.timer -= dt;
    if (b.timer <= 0) {
      const tr = b.tr;
      tr.tm.setMatrixAt(tr.ti, _ZEROMAT); tr.tm.instanceMatrix.needsUpdate = true;
      tr.cm.setMatrixAt(tr.ci, _ZEROMAT); tr.cm.instanceMatrix.needsUpdate = true;
      burningTrees.splice(i, 1);
    }
  }
}
fx.onScorch = igniteTreesNear;
// Missiles that hit the ground leave a small burning patch (on land only).
weapons.onGroundImpact = (pos) => {
  const solid = groundHeightAt(pos.x, pos.z);
  if (solid >= SEA_LEVEL) wrecks.spawnFire(new THREE.Vector3(pos.x, solid + 0.3, pos.z), { scale: 1.1, life: 7, color: 0x242424 });
};

// Weather / time of day (sky, fog, lights, stars, rain).
const weather = new Weather(scene, world);
let weatherMode = "day";
try { weatherMode = localStorage.getItem("rf.weather") || "day"; } catch (_) { /* ignore */ }
weather.setMode(weatherMode);
const wxSel = document.getElementById("weather-mode");
if (wxSel) {
  wxSel.value = weatherMode;
  wxSel.addEventListener("change", () => {
    weatherMode = wxSel.value;
    weather.setMode(weatherMode);
    try { localStorage.setItem("rf.weather", weatherMode); } catch (_) { /* ignore */ }
  });
}
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
// In-game vehicle bay: sim paused, camera orbits the parked vehicle at the spawn.
let hangarMode = false, hangarAngle = 0;
let paused = false;                 // Esc pause menu (sim frozen)
let crashHandled = false, respawnTimer = 0; // crash → wreckage → soft respawn

// Throttle "arming" gesture before a flight begins (see updateArming).
let armActive = false, armUp = false, armOpposite = false, armInit = false, armHint = "";
const ARM_HI = 0.9, ARM_LO = 0.08;

const CAMS = ["Chase", "Far Chase", "Cockpit"];
let camIndex = 0;
let ringsHit = 0;
let lastPad = false; // tracks gamepad presence to toggle touch controls
// Manual gear/flaps state + animated gear-deploy fraction (0 up .. 1 down).
let gearDown = true, flapsDown = false, gearAnim = 1;
let vtolMode = false; // Harrier nozzle state: false = aft (jet), true = down (hover)
let brakeActive = false, brakeAnim = 0; // airbrake/wheel brake state + speedbrake panel anim

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
    if (this.health <= 0) { state.crashed = true; handleCrash("SHOT DOWN"); }
  },
};

// A crash: leave persistent burning wreckage at the site, hide the aircraft,
// and start the short timer that respawns the player (the world is untouched).
function handleCrash(title) {
  if (crashHandled) return;
  crashHandled = true;
  fx.add(state.position, 3.4);
  fx.shards(state.position, mesh, state.quaternion, 16); // fling actual pieces of the jet
  // Wreckage sits on the surface below the impact point — but only on land;
  // a crash into the sea just sinks (no burning wreck on the water).
  const gx = state.position.x, gz = state.position.z;
  const solid = groundHeightAt(gx, gz);
  if (solid >= SEA_LEVEL) wrecks.spawn(new THREE.Vector3(gx, solid + 0.5, gz), def.color);
  else fx.add(new THREE.Vector3(gx, SEA_LEVEL, gz), 2.2, 0x9fb4c4); // splash on the water
  // Kamikaze into the enemy carrier still counts.
  for (const t of ground.targets) {
    if (t.info && t.alive &&
        Math.abs(gx - t.info.x) < t.info.halfW + 14 && Math.abs(gz - t.info.z) < t.info.halfL + 14) t.hit(99999);
  }
  sound.stopEngine(); sound.stopSeek();
  ui.showBanner(title || "AIRCRAFT DOWN", "Recovering a new aircraft…");
  respawnTimer = 2.8;
}

function missilesForMode(mode) { return 6; } // every mode is armed (dumb-fire works anywhere)

const ui = new UI(input, {
  onFly: (type, mode, start) => startFlight(type, mode, start),
  onVR: (type, mode, start) => enterVR(type, mode, start),
  onSelectJet: (type) => { if (!flying) setAircraft(type); }, // live hero swap on the menu
  onPickVehicle: (type) => pickVehicle(type),   // in-game vehicle bay: spawn this ride
  onHangarStay: () => exitHangar(),             // keep the current vehicle, close the bay
  onPauseResume: () => closePause(),
  onPauseMenu: () => exitToMenu(),
}, touch, tilt);

// --- Multiplayer (LAN free-for-all) ---
const net = new Net();
const netMeshes = new Map(); // remote player id -> jet mesh
const netTargets = [];       // weapons.js-compatible {position,radius,alive,hit} for remote jets
let playerName = "Pilot";
try {
  playerName = localStorage.getItem("rf.name") || ("Pilot-" + Math.floor(Math.random() * 900 + 100));
  localStorage.setItem("rf.name", playerName);
} catch (_) { /* ignore */ }
function playerColor(id) { return new THREE.Color().setHSL(((id * 47) % 360) / 360, 0.62, 0.55).getHex(); }
net.onEvent = (t, m) => {
  if (t === "leave") { const mesh = netMeshes.get(m.id); if (mesh) { scene.remove(mesh); netMeshes.delete(m.id); } }
  else if (t === "hit") { if (flying && gameMode === "ffa") player.applyDamage(m.dmg); } // someone hit us
};
function clearRemotePlayers() { for (const mesh of netMeshes.values()) scene.remove(mesh); netMeshes.clear(); netTargets.length = 0; }
function updateRemotePlayers(dt) {
  net.interpolate(dt);
  for (const [id, mesh] of netMeshes) if (!net.players.has(id) || id === net.id) { scene.remove(mesh); netMeshes.delete(id); }
  netTargets.length = 0;
  for (const p of net.players.values()) {
    if (p.id === net.id) continue;
    let mesh = netMeshes.get(p.id);
    if (!mesh || mesh.userData.jet !== p.jet) {
      if (mesh) scene.remove(mesh);
      mesh = buildAircraftMesh(p.jet, playerColor(p.id));
      mesh.userData.jet = p.jet;
      scene.add(mesh);
      netMeshes.set(p.id, mesh);
    }
    mesh.position.copy(p.cur.p);
    mesh.quaternion.copy(p.cur.q);
    mesh.visible = p.alive !== false;
    if (mesh.userData.rotors) for (const r of mesh.userData.rotors) r.m.rotation[r.axis] += r.spd * 22 * dt;
    // Shooter-authoritative hit target (stable per player; we report damage).
    if (!p._target) {
      p._target = {
        position: p.cur.p, radius: 11,
        get alive() { return p.alive !== false && p.health > 0; },
        hit(dmg) { net.sendHit(p.id, dmg); },
      };
    }
    p._target.position = p.cur.p;
    if (p._target.alive) netTargets.push(p._target);
  }
}

// World editor (top-down). Entered from the menu button or ?edit.
const editor = new Editor(scene, renderer, hud, world);
editor.onExit = () => ui.showMenu();
function showAllIslands() { if (world.islands) for (const isl of world.islands) isl.group.visible = true; }

// Keep the global ocean + cloud field centred on the active camera so they
// exist everywhere (water never runs out; clouds wrap seamlessly past the fog).
const _skyPos = new THREE.Vector3();
function updateSky(cam, showClouds) {
  cam.getWorldPosition(_skyPos);
  if (world.ocean) {
    const c = 56000 / 256; // snap to the mesh cell so vertices stay world-aligned
    world.ocean.position.x = Math.round(_skyPos.x / c) * c;
    world.ocean.position.z = Math.round(_skyPos.z / c) * c;
  }
  if (world.clouds) {
    world.clouds.visible = showClouds;
    if (showClouds) {
      const t = world.clouds.userData.tile;
      world.clouds.position.x = Math.round(_skyPos.x / t) * t;
      world.clouds.position.z = Math.round(_skyPos.z / t) * t;
    }
  }
}
const edBtn = document.getElementById("btn-editor");
if (edBtn) edBtn.addEventListener("click", () => { ui.hideAll(); touch.setVisible(false); showAllIslands(); editor.enter(); });

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
  if (e.code === "Escape") openPause();
  if (e.code === "KeyF") toggleFullscreen();
  if (e.code === "KeyM") updateSoundButton(sound.toggleMute());
  if (e.code === "KeyH" && flying && !inXR) { hangarMode ? exitHangar() : enterHangar(true); }
});

// Floating in-flight button to reopen the vehicle bay.
const hangarFab = document.getElementById("btn-hangar");
if (hangarFab) hangarFab.addEventListener("click", () => { if (flying && !hangarMode) enterHangar(true); });

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
  vtolMode = false; // start with nozzles aft
  touch.setVtol(false);
  if (mesh) scene.remove(mesh);
  mesh = buildAircraftMesh(type);
  scene.add(mesh);
}

// Decorative airbase beside the runway + a few aircraft parked on the deck, so
// the spawn point reads as a real base while you choose a vehicle in the bay.
function park(type, x, y, z, ry) {
  const v = buildAircraftMesh(type);
  v.position.set(x, y, z);
  v.rotation.y = ry;
  v.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(v);
}
function populateBases() {
  const tarmac = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.96 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, flatShading: true, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b7178, flatShading: true, metalness: 0.5, roughness: 0.5 });
  const towerGlass = new THREE.MeshStandardMaterial({ color: 0x14313c, flatShading: true, metalness: 0.2, roughness: 0.3, emissive: 0x0a1a22 });
  const base = new THREE.Group();

  // Apron east of the runway, with a taxiway stub linking it to the strip.
  const bx = 150, bz = 300, gy = terrainHeight(bx, bz);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(170, 340), tarmac);
  apron.rotation.x = -Math.PI / 2; apron.position.set(bx, gy + 0.4, bz); apron.receiveShadow = true; base.add(apron);
  const taxi = new THREE.Mesh(new THREE.PlaneGeometry(110, 26), tarmac);
  taxi.rotation.x = -Math.PI / 2; taxi.position.set(bx - 100, gy + 0.38, bz); taxi.receiveShadow = true; base.add(taxi);

  // Control tower.
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(8, 26, 8), concrete); shaft.position.y = 13; tower.add(shaft);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(13, 4.5, 13), concrete); cab.position.y = 28; tower.add(cab);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(13.6, 3, 13.6), towerGlass); glass.position.y = 27.6; tower.add(glass);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(14.5, 1, 14.5), concrete); roof.position.y = 30.6; tower.add(roof);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a20, emissiveIntensity: 2 }));
  beacon.position.y = 32; tower.add(beacon);
  tower.position.set(bx + 60, gy, bz - 150); base.add(tower);

  // Two hangar sheds (box + dark door opening).
  for (let i = 0; i < 2; i++) {
    const shed = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(36, 13, 28), concrete); body.position.y = 6.5; shed.add(body);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(38, 2.5, 30), metal); ridge.position.y = 13.5; shed.add(ridge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(28, 10, 0.6), new THREE.MeshStandardMaterial({ color: 0x1b1f24, flatShading: true }));
    door.position.set(0, 5, -14.2); shed.add(door);
    shed.position.set(bx + 64, gy, bz + 30 + i * 46); base.add(shed);
  }

  // Two fuel bowsers for flavour.
  for (const tz of [bz - 30, bz + 90]) {
    const truck = new THREE.Group();
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3.4), new THREE.MeshStandardMaterial({ color: 0x3a5a44, flatShading: true })); cabin.position.set(0, 2.2, -3); truck.add(cabin);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 6.5, 12), metal); tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.4, 1.5); truck.add(tank);
    for (const wx of [-1.4, 1.4]) for (const wz of [-3.2, 0.5, 3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x16181c }));
      wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.7, wz); truck.add(wheel);
    }
    truck.position.set(bx - 60, gy, tz); base.add(truck);
  }

  base.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(base);

  // Parked aircraft on the apron — a static line-up of the fleet.
  const lineup = ["a10", "f15", "apache", "blackhawk", "littlebird"];
  lineup.forEach((t, i) => park(t, bx - 56 + i * 30, gy + 1.6, bz - 70, -Math.PI / 2 + (i % 2 ? 0.12 : -0.12)));
  park("chinook", bx + 20, gy + 1.8, bz + 120, -Math.PI / 2);

  // Parked aircraft on the ally carrier deck (visible from the catapult spawn).
  const carrier = getCarriers().find((c) => c.team === "ally");
  if (carrier) {
    const deckTop = SEA_LEVEL + 25;
    // Spotted along the port edge, clear of the centreline launch lane.
    park("fa18", carrier.x - 28, deckTop + 1.4, carrier.z + carrier.halfL * 0.30, Math.PI * 0.82);
    park("f14", carrier.x - 28, deckTop + 1.4, carrier.z + carrier.halfL * 0.55, Math.PI * 0.78);
    park("blackhawk", carrier.x - 28, deckTop + 1.5, carrier.z + carrier.halfL * 0.05, Math.PI * 0.9);
  }
}

// Put a fresh player aircraft down at the spawn point (the runway, carrier or
// air). This is a SOFT reset — it touches only the player, leaving the rest of
// the world (enemies, ground targets, rings, score, wreckage) exactly as it is.
function placePlayer() {
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
  weapons.reset(missilesForMode(gameMode)); // fresh ammo + clear our own projectiles
  player.health = 100;
  crashHandled = false; respawnTimer = 0;
  // Gear down for ground/carrier starts, up for air starts; flaps up. Snap the
  // animation so it doesn't visibly deploy on spawn.
  gearDown = startPos !== "air";
  flapsDown = false;
  gearAnim = gearDown ? 1 : 0;
  brakeActive = false; brakeAnim = 0;
  vtolMode = false;
  touch.setGearFlaps(gearDown, flapsDown);
  touch.setVtol(false);
  ui.hideBanner();
  // Require a deliberate throttle gesture before the sim runs.
  armActive = true;
  armUp = startPos === "air";
  armInit = false;
  armHint = "";
}

// Reset the whole world for a fresh game (enemies, ground targets, rings, FX,
// wreckage), then place the player. Used when launching from the main menu.
function resetFlight() {
  ringsHit = 0;
  world.rings.forEach((r) => { r.visible = true; r.userData.hit = false; });
  enemies.setMode(gameMode);
  ground.setActive(gameMode === "mission", world.carriers.enemy, getCarriers().find((c) => c.team === "enemy"));
  missionDone = false;
  fx.reset();
  wrecks.reset();
  placePlayer();
}

function startFlight(type, mode, start, vr) {
  gameMode = mode || gameMode;
  startPos = start || "air";
  setAircraft(type);
  resetFlight();
  // Multiplayer: connect for FFA, drop the connection for any other mode.
  if (gameMode === "ffa") net.connect(playerName, type);
  else if (net.status !== "offline") { net.disconnect(); clearRemotePlayers(); }
  flying = true;
  lastLocked = false;
  touch.setVisible(!input.hasGamepad()); // a gamepad (e.g. Steam Deck) hides touch
  sound.resume();
  sound.startEngine();
  // On touch devices, take over the full screen for an immersive cockpit — but
  // never in VR (that would fight the immersive XR session for the gesture).
  if (!vr && touch.enabled && fullscreenSupported() && !isFullscreen()) enterFullscreen();
  // Drop into the vehicle bay at the spawn point first (VR skips it).
  if (!vr) enterHangar(false);
}

// --- In-game vehicle bay -------------------------------------------------
// Park at the spawn point with the sim held, orbit the camera, and let the
// player pick (or swap) a vehicle. This is also how you "change vehicles in
// game": reopening it returns you to base in whatever you choose.
function enterHangar(canStay) {
  hangarMode = true;
  hangarAngle = 0;
  placePlayer();                 // soft: park a fresh vehicle, world untouched
  armActive = false;             // no throttle-gate prompt while choosing
  const fab = document.getElementById("btn-hangar");
  if (fab) fab.classList.add("hidden");
  touch.setVisible(false);
  ui.showHangar(jetType, !!canStay);
}
function exitHangar() {
  hangarMode = false;
  ui.hideHangar();
  placePlayer();                 // re-arm at the spawn so the throttle gate runs
  sound.startEngine();           // (restarts it after a crash silenced it)
  touch.setVisible(!input.hasGamepad());
  const fab = document.getElementById("btn-hangar");
  if (fab && !inXR) fab.classList.remove("hidden");
}
function pickVehicle(type) {
  setAircraft(type);             // rebuild the hero mesh for the new ride
  exitHangar();
}

// Esc / Start opens an in-game pause menu (Resume or quit to the main menu).
function openPause() {
  if (!flying || hangarMode) return;
  paused = !paused;
  if (paused) {
    sound.stopEngine(); sound.stopSeek();
    const fab = document.getElementById("btn-hangar"); if (fab) fab.classList.add("hidden");
    touch.setVisible(false);
    ui.showPause();
  } else {
    closePause();
  }
}
function closePause() {
  paused = false;
  ui.hidePause();
  sound.startEngine();
  touch.setVisible(!input.hasGamepad());
  const fab = document.getElementById("btn-hangar"); if (fab && !inXR) fab.classList.remove("hidden");
}
// Full restart: drop back to the main menu to make new choices.
function exitToMenu() {
  paused = false; flying = false; hangarMode = false;
  wrecks.reset();
  ui.hidePause(); ui.hideHangar();
  const fab = document.getElementById("btn-hangar"); if (fab) fab.classList.add("hidden");
  touch.setVisible(false);
  sound.stopEngine(); sound.stopSeek();
  if (net.status !== "offline") { net.disconnect(); clearRemotePlayers(); }
  ui.showMenu();
}

// --- Camera positioning per mode ---
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function updateCamera(dt) {
  const mode = CAMS[camIndex];
  const pos = state.position;
  const q = state.quaternion;

  // Vehicle bay: slow orbit of the parked vehicle at the spawn point so the base
  // / carrier tower drifts through frame while you choose.
  if (hangarMode) {
    hangarAngle += dt * 0.22;
    const r = 26, h = 9;
    const a = hangarAngle + 0.7;
    camera.position.set(pos.x + Math.cos(a) * r, pos.y + h, pos.z + Math.sin(a) * r);
    camera.up.set(0, 1, 0);
    camera.lookAt(pos.x, pos.y + 2.2, pos.z);
    camera.fov += (60 - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    return;
  }

  // Crash: pull right out (whatever the selected view) so the blast and the
  // wreckage are framed — first-person sees nothing once the jet is gone.
  if (state.crashed) {
    // Horizontal "behind" from the heading so it never dips underground.
    _v2.set(0, 0, 1).applyQuaternion(q); _v2.y = 0;
    if (_v2.lengthSq() < 0.01) _v2.set(0, 0, 1);
    _v2.normalize();
    const gy0 = Math.max(groundHeightAt(pos.x, pos.z), SEA_LEVEL);
    const behind = _v.copy(pos).addScaledVector(_v2, 130);
    behind.y = Math.max(pos.y, gy0) + 48;
    const lerp = 1 - Math.pow(0.02, dt);
    camPos.lerp(behind, lerp);
    if (camPos.lengthSq() === 0) camPos.copy(behind);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.fov += (64 - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    camera.lookAt(pos.x, (pos.y + gy0) * 0.5 + 6, pos.z);
    return;
  }

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

  // Far Chase = the old close chase; close Chase now sits right on the tail.
  const dist = mode === "Far Chase" ? 24 : 9.5;
  const height = mode === "Far Chase" ? 8 : 3.6;
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
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3();

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
  // A canopy bow up high so it frames the top without blocking the forward view.
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 8, 24, Math.PI), frame);
  bow.position.set(0, 0.42, -0.5); bow.rotation.x = Math.PI / 2; grp.add(bow);

  // Heads-up display: a see-through panel straight ahead at eye level. depthTest
  // off so it always reads over the world (a real HUD), transparent background.
  vrHudCanvas = document.createElement("canvas"); vrHudCanvas.width = 512; vrHudCanvas.height = 256;
  vrHudCtx = vrHudCanvas.getContext("2d");
  vrHudTex = new THREE.CanvasTexture(vrHudCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6),
    new THREE.MeshBasicMaterial({ map: vrHudTex, transparent: true, depthTest: false, depthWrite: false }));
  screen.position.set(0, 0.0, -1.15); screen.rotation.x = -0.08; screen.renderOrder = 998;
  grp.add(screen);
  return grp;
}

function drawVRHud() {
  const c = vrHudCtx; if (!c) return;
  c.clearRect(0, 0, 512, 256); // transparent — only the glowing symbology shows
  c.textBaseline = "middle";
  const cx = 256, cy = 128, green = "#36ff9a";

  if (armActive) {
    c.fillStyle = "#ffd27d"; c.font = "bold 44px Consolas, monospace"; c.textAlign = "center";
    c.fillText("READY?", cx, 96);
    c.fillStyle = green; c.font = "26px Consolas, monospace";
    c.fillText(armHint || "Move throttle", cx, 152);
    vrHudTex.needsUpdate = true; return;
  }

  // Attitude (pitch/roll) for the horizon ladder.
  _h1.set(0, 0, -1).applyQuaternion(state.quaternion);
  const pitch = Math.asin(THREE.MathUtils.clamp(_h1.y, -1, 1));
  _h2.set(1, 0, 0).applyQuaternion(state.quaternion);
  _h3.set(0, 1, 0).applyQuaternion(state.quaternion);
  const roll = Math.atan2(_h2.y, _h3.y);

  // Horizon line + pitch ladder, clipped to a central window.
  c.save();
  c.beginPath(); c.rect(96, 34, 320, 188); c.clip();
  c.translate(cx, cy); c.rotate(-roll); c.translate(0, pitch * 340);
  c.strokeStyle = green; c.lineWidth = 2;
  c.beginPath(); c.moveTo(-150, 0); c.lineTo(-46, 0); c.moveTo(46, 0); c.lineTo(150, 0); c.stroke();
  for (const deg of [-20, -10, 10, 20]) {
    const yy = -deg * Math.PI / 180 * 340;
    c.beginPath(); c.moveTo(-70, yy); c.lineTo(-34, yy); c.moveTo(34, yy); c.lineTo(70, yy); c.stroke();
  }
  c.restore();

  // Boresight.
  c.strokeStyle = green; c.lineWidth = 3;
  c.beginPath();
  c.moveTo(cx - 34, cy); c.lineTo(cx - 12, cy); c.moveTo(cx + 12, cy); c.lineTo(cx + 34, cy);
  c.moveTo(cx, cy - 10); c.lineTo(cx, cy - 3); c.stroke();

  // Speed (left) + altitude (right).
  const kts = Math.round(state.telemetry.speed * 1.94384);
  const ft = Math.round(state.telemetry.altitude * 3.281);
  c.fillStyle = green; c.textAlign = "left"; c.font = "bold 40px Consolas, monospace";
  c.fillText(String(kts), 18, 110);
  c.fillStyle = "#9fb3c4"; c.font = "15px Consolas, monospace"; c.fillText("KTS", 20, 142);
  c.fillStyle = green; c.textAlign = "right"; c.font = "bold 40px Consolas, monospace";
  c.fillText(String(ft), 494, 110);
  c.fillStyle = "#9fb3c4"; c.font = "15px Consolas, monospace"; c.fillText("ALT FT", 494, 142);

  // Heading (top).
  c.fillStyle = "#9fb3c4"; c.textAlign = "center"; c.font = "20px Consolas, monospace";
  c.fillText("HDG " + String(Math.round(state.telemetry.heading)).padStart(3, "0"), cx, 22);

  // Throttle bar (bottom).
  c.fillStyle = "rgba(22,50,74,0.8)"; c.fillRect(40, 232, 432, 16);
  c.fillStyle = "#2ee6a6"; c.fillRect(40, 232, 432 * THREE.MathUtils.clamp(state.telemetry.throttle, 0, 1), 16);

  // Hull + missiles.
  c.textAlign = "left"; c.font = "bold 17px Consolas, monospace";
  c.fillStyle = player.health > 50 ? green : player.health > 25 ? "#ffd23f" : "#ff5a5a";
  c.fillText("HULL " + Math.max(0, Math.round(player.health)), 18, 210);
  c.textAlign = "right"; c.fillStyle = weapons.missileCount > 0 ? green : "#888";
  c.fillText("MSL x" + weapons.missileCount, 494, 210);

  // Lock status.
  if (weapons.locked) { c.fillStyle = "#ff5a5a"; c.font = "bold 24px Consolas, monospace"; c.textAlign = "center"; c.fillText("◉ LOCK", cx, cy + 46); }
  else if (weapons.lock) { c.fillStyle = "#ffd23f"; c.font = "20px Consolas, monospace"; c.textAlign = "center"; c.fillText("SEEK " + Math.round(weapons.lockProgress * 100) + "%", cx, cy + 46); }

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
  const simDt = paused ? 0 : dt; // freeze the world while the pause menu is open

  // World editor takes over rendering with its top-down camera. The ocean still
  // follows so coasts read right; clouds are hidden (no geometry over the map).
  if (editor.active) { updateSky(editor.cam, false); weather.update(dt, _skyPos); editor.render(); return; }

  const controls = inXR ? getXRControls(dt) : input.getControls(dt);

  // Live monitor for the settings panel
  ui.updateMonitors();

  // Hide on-screen touch controls whenever a gamepad (Steam Deck / Xbox) is live.
  if (flying) {
    const pad = input.hasGamepad();
    if (pad !== lastPad) { lastPad = pad; touch.setVisible(!pad); }
  }

  // Vehicle bay / pause from the joystick (Back/Select & Start).
  if (flying && !inXR && controls.hangarPressed) { hangarMode ? exitHangar() : enterHangar(true); }
  if (flying && controls.pausePressed) openPause();

  // Throttle-arming gate: hold the sim until the player engages the throttle.
  if (flying && !hangarMode && !paused && !state.crashed && armActive) updateArming(controls);

  if (flying && !hangarMode && !paused && !state.crashed && !armActive) {
    if (controls.viewPressed) camIndex = (camIndex + 1) % CAMS.length;

    // Gear + flaps are manual now (G / V keys, or on-screen GEAR / FLAPS).
    if (controls.gearPressed) gearDown = !gearDown;
    if (controls.flapsPressed) flapsDown = !flapsDown;
    if (controls.gearPressed || controls.flapsPressed) touch.setGearFlaps(gearDown, flapsDown);
    controls.gear = gearDown;
    controls.flaps = flapsDown;
    // Harrier: T / D-pad-down / VTOL button vectors the nozzles down for hover.
    if (def.vtol && controls.vtolPressed) { vtolMode = !vtolMode; touch.setVtol(vtolMode); }
    controls.vtol = def.vtol ? vtolMode : false;
    brakeActive = !!controls.brake; // airbrake (air) / wheel brake (ground)

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
    const activeTargets = gameMode === "ffa" ? netTargets : (isMission ? ground.targets : enemies.targets);
    if (controls.fire && weapons.fire(state.position, state.quaternion)) sound.gun();
    if (controls.missilePressed && weapons.fireMissile(state.position, state.quaternion, state.velocity)) sound.missile();
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
      ui.showBanner("MISSION COMPLETE", "Keep flying — Esc for the menu");
    }

    // Lock audio: a growl that ramps while a target sits in the box, then a
    // confirmation chirp the moment it goes solid.
    if (weapons.lock && !weapons.locked) { sound.startSeek(); sound.updateSeek(weapons.lockProgress); }
    else sound.stopSeek();
    if (weapons.locked && !lastLocked) sound.lock();
    lastLocked = weapons.locked;

    if (state.crashed) handleCrash("AIRCRAFT DOWN");
  } else if (flying && state.crashed && !paused) {
    // Burning wreckage stays in the world; auto-respawn a fresh aircraft.
    sound.stopSeek();
    fx.update(dt);
    if (respawnTimer > 0) { respawnTimer -= dt; if (respawnTimer <= 0) { if (inXR) placePlayer(); else enterHangar(false); } }
  }

  // Sync mesh to physics state
  if (mesh) {
    mesh.position.copy(state.position);
    mesh.quaternion.copy(state.quaternion);
    mesh.visible = !state.crashed && (inXR ? false : CAMS[camIndex] !== "Cockpit"); // gone on crash; hidden in VR cockpit
    const flames = mesh.userData.flames;
    if (flames) {
      const t = state.telemetry.throttle;
      const op = t > 0.6 ? (t - 0.6) / 0.4 * 0.8 : 0;
      for (const fl of flames) {
        fl.material.opacity = op;
        fl.scale.setScalar((fl.userData.base || 1) * (0.6 + t * 0.8));
      }
    }
    // Gear extends/retracts smoothly (legs telescope out of the belly); flaps
    // swing down. Both ease toward the manual gear/flaps state.
    gearAnim += ((gearDown ? 1 : 0) - gearAnim) * Math.min(1, dt * 3.5);
    if (mesh.userData.gear) {
      mesh.userData.gear.visible = gearAnim > 0.02;
      mesh.userData.gear.scale.y = Math.max(0.0001, gearAnim);
    }
    const flapTarget = flapsDown ? 0.6 : 0;
    if (mesh.userData.flaps) {
      for (const p of mesh.userData.flaps) p.rotation.x += (flapTarget - p.rotation.x) * Math.min(1, dt * 4);
    }
    // Speedbrake panel pops up when the airbrake is held.
    brakeAnim += ((brakeActive ? 1 : 0) - brakeAnim) * Math.min(1, dt * 6);
    if (mesh.userData.speedbrake) mesh.userData.speedbrake.rotation.x = -brakeAnim * 1.05; // hinge up ~60°
    // Harrier vectoring nozzles swing from aft (0) to straight down (~90°).
    if (mesh.userData.nozzles) {
      const tgt = vtolMode ? Math.PI / 2 : 0;
      for (const n of mesh.userData.nozzles) n.rotation.x += (tgt - n.rotation.x) * Math.min(1, dt * 5);
    }
    // Spin helicopter rotors — always turning while running, faster on collective.
    const rotors = mesh.userData.rotors;
    if (rotors && rotors.length) {
      const rs = 16 + state.telemetry.throttle * 12;
      for (const r of rotors) r.m.rotation[r.axis] += r.spd * rs * dt;
    }
  }

  // Multiplayer: broadcast our state + sync remote jets (runs even while dead).
  if (flying && gameMode === "ffa" && net.connected) {
    net.sendState(state, jetType, player.health, !state.crashed);
    updateRemotePlayers(dt);
  }

  // Spin rings for visibility
  for (const r of world.rings) r.rotation.z += dt * 0.5;

  // Distance-cull far islands (cheap archipelago LOD).
  if (world.islands && world.islands.length > 1) {
    const px = state.position.x, pz = state.position.z, R = 40000;
    for (const isl of world.islands) {
      const dx = px - isl.center.x, dz = pz - isl.center.z;
      isl.group.visible = dx * dx + dz * dz < R * R;
    }
  }

  // Animate the sea/river waves.
  if (world.waveMats) {
    const tsec = now / 1000;
    for (const m of world.waveMats) {
      if (m.userData.shader) m.userData.shader.uniforms.uTime.value = tsec;
    }
  }

  if (inXR) { updateVRRig(dt); sound.setListener(playerRig); }
  else if (flying) { updateCamera(simDt); sound.setListener(camera); }
  else { menuCinematic(dt); sound.setListener(camera); }
  updateSky(camera, true); // ocean + clouds follow the active camera
  weather.update(simDt, _skyPos); // stars/rain follow the camera; storm lightning
  // Smoke plumes: scenery sources + any still-alive power-plant strike targets.
  const dyn = smoke.dynamic; dyn.length = 0;
  for (const t of ground.targets) if (t.alive && t.smokeStacks) for (const s of t.smokeStacks) dyn.push(s);
  smoke.update(simDt, _skyPos);
  wrecks.update(simDt, now / 1000); // crash wreckage fire flicker
  updateBurningTrees(simDt);         // burnt-down trees vanish
  // Post FX on flat screen; VR renders direct (composer + WebXR don't mix).
  // Any composer failure falls back to a plain render so FX can't break the game.
  if (!inXR && post.enabled) {
    try { post.render(dt); }
    catch (e) { console.error("post FX disabled:", e); post.enabled = false; renderer.render(scene, camera); }
  } else {
    renderer.render(scene, camera);
  }

  // HUD
  if (flying && !hangarMode) {
    // Project the locked target to screen space for the lock box.
    let lock = null;
    if (weapons.lock && weapons.lock.alive) {
      _v.copy(weapons.lock.position).project(camera);
      if (_v.z < 1) {
        lock = {
          x: (_v.x * 0.5 + 0.5) * hud.w,
          y: (-_v.y * 0.5 + 0.5) * hud.h,
          dist: state.position.distanceTo(weapons.lock.position),
          progress: weapons.lockProgress,
          locked: weapons.locked,
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
    // Nav markers to other islands (so the open ocean isn't a void).
    let islandMarkers = null;
    if (world.islands && world.islands.length > 1) {
      islandMarkers = [];
      for (const isl of world.islands) {
        const dx = state.position.x - isl.center.x, dz = state.position.z - isl.center.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9000) continue; // don't mark the island you're over
        _v.set(isl.center.x, SEA_LEVEL + 1500, isl.center.z).project(camera);
        islandMarkers.push({
          name: isl.name, faction: isl.faction, dist,
          ndcx: _v.x, ndcy: _v.y, behind: _v.z > 1,
          onscreen: _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1,
          x: (_v.x * 0.5 + 0.5) * hud.w,
          y: (-_v.y * 0.5 + 0.5) * hud.h,
        });
      }
    }
    // Air contacts: mark every aircraft (enemy jets, drones, other players) on
    // the HUD and a radar scope — easy to find/track/target, esp. in MP.
    let netStatus = null;
    const contacts = [];
    const radar = { range: 6000, blips: [] };
    _v.set(0, 0, -1).applyQuaternion(state.quaternion);
    const _fl = Math.hypot(_v.x, _v.z) || 1;
    const fwdX = _v.x / _fl, fwdZ = _v.z / _fl, rgtX = -fwdZ, rgtZ = fwdX; // heading basis (XZ)
    const addContact = (pos, opts) => {
      const dx = pos.x - state.position.x, dz = pos.z - state.position.z;
      const dist = Math.hypot(dx, dz);
      _v.copy(pos); _v.y += 12; _v.project(camera);
      contacts.push({
        color: opts.color, name: opts.name, health: opts.health, dist,
        ndcx: _v.x, ndcy: _v.y, behind: _v.z > 1,
        onscreen: _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1,
        x: (_v.x * 0.5 + 0.5) * hud.w, y: (-_v.y * 0.5 + 0.5) * hud.h,
      });
      radar.blips.push({
        nx: THREE.MathUtils.clamp((dx * rgtX + dz * rgtZ) / radar.range, -1, 1),
        ny: THREE.MathUtils.clamp((dx * fwdX + dz * fwdZ) / radar.range, -1, 1),
        far: dist > radar.range, color: opts.color,
      });
    };
    if (gameMode === "dogfight" || gameMode === "practice") {
      for (const t of enemies.targets) if (t.alive) addContact(t.position, { color: "#ff5b5b" });
    } else if (gameMode === "ffa") {
      netStatus = net.status === "online" ? `LAN  ·  ${net.count() + 1} pilots` :
        net.status === "connecting" ? "Connecting…" :
        net.status === "error" ? "No server (run the LAN server)" : "Offline";
      for (const [id, m] of netMeshes) {
        const p = net.players.get(id);
        if (!p || p.alive === false) continue;
        addContact(m.position, { color: "#" + playerColor(id).toString(16).padStart(6, "0"), name: p.name, health: p.health });
      }
    }
    // Attitude for the HUD horizon ladder.
    _v.set(0, 0, -1).applyQuaternion(state.quaternion);
    const pitchAng = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
    _v2.set(1, 0, 0).applyQuaternion(state.quaternion);
    _v3.set(0, 1, 0).applyQuaternion(state.quaternion);
    const rollAng = Math.atan2(_v2.y, _v3.y);
    hud.draw(state.telemetry, {
      pitch: pitchAng,
      roll: rollAng,
      jetName: def.name,
      camName: CAMS[camIndex],
      mode: gameMode,
      onGround: state.onGround,
      checkpoints: world.rings.length,
      ringsHit,
      kills: gameMode === "ffa" ? null : (isMissionHud ? ground.destroyed : enemies.kills),
      bandits: gameMode === "ffa" ? null : (isMissionHud ? ground.remaining : enemies.alive()),
      total: isMissionHud ? ground.total : null,
      health: player.health,
      missiles: weapons.missileCount,
      gear: def.rotor ? null : gearDown, // helis have skids — no gear/flaps readouts
      flaps: def.rotor ? null : flapsDown,
      brake: brakeActive,
      vtol: def.vtol ? vtolMode : null,
      gearWarn: !def.rotor && !gearDown && !state.onGround && state.telemetry.altitude < 350 && state.telemetry.speed < 140 && state.telemetry.vspeed < 0,
      lock,
      objective,
      islandMarkers,
      netStatus,
      contacts,
      radar,
    });
  } else {
    hud.ctx.clearRect(0, 0, hud.w, hud.h);
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
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
if (location.search.includes("edit")) { ui.hideAll(); showAllIslands(); editor.enter(); }

// Decorative airbase + parked aircraft at the spawn points.
populateBases();

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
