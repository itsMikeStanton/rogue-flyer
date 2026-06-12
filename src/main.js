import * as THREE from "three";
import { AIRCRAFT, buildAircraftMesh } from "./aircraft.js";
import { createState, step } from "./flight.js";
import { buildWorld, terrainHeight, groundHeightAt, getCarriers, getIslandSpawns, getMissionBases, getWorldConfig, getFactionConfig, moveCarrier, SEA_LEVEL, lightPoolTexture } from "./world.js";
import { Factions } from "./factions.js";
import { MapView } from "./mapview.js";
import { SupplyDrop } from "./supply.js";
import { WPT_TYPES, WPT_ORDER, wptType } from "./waypoints.js";
import { Input } from "./input.js";
import { Hud } from "./hud.js";
import { UI } from "./ui.js";
import { TouchControls } from "./touch.js";
import { TiltControls } from "./tilt.js";
import { Weapons } from "./weapons.js";
import { Enemies } from "./enemies.js";
import { GroundTargets, THREAT_RANGE } from "./ground.js";
import { EnemyOrdnance } from "./enemyWeapons.js";
import { Awareness } from "./awareness.js";
import { Traffic } from "./traffic.js";
import { Explosions } from "./fx.js";
import { SoundEngine } from "./audio.js";
import { Editor } from "./editor.js";
import { PostFX } from "./postfx.js";
import { Weather } from "./weather.js";
import { Smokestacks } from "./smoke.js";
import { Wrecks } from "./wreckage.js";
import { Net } from "./net.js";
import { Approach } from "./approach.js";
import { MissionManager, defaultStrikeMission } from "./missions.js";
import * as campaign from "./campaign.js";
import * as cq from "./conquest.js";

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
restoreCarrier(); // put the ally carrier back at its last planted station
const fx = new Explosions(scene);
const weapons = new Weapons(scene, fx);
const enemies = new Enemies(scene, fx);
const ground = new GroundTargets(scene, fx);
// Shared pool for enemy missiles & dumb-fire rockets, fired by both fighters
// (enemies) and SAM batteries (ground). It flies/guides/resolves them vs. the
// player each frame.
const enemyOrdnance = new EnemyOrdnance(scene, fx);
enemies.ordnance = enemyOrdnance;
ground.ordnance = enemyOrdnance;
// Shared per-island enemy awareness: detection + alert state every defence reads.
const awareness = new Awareness();
// Allegiance: who's hostile/neutral/friendly to the player. Rebuilt on each
// flight start so live edits to the world's faction setup take effect.
let factions = new Factions(getFactionConfig());
// Runtime island→faction assignment. Islands are NOT permanently bound to a
// faction: the world config only seeds the starting allegiance, and gameplay
// reassigns from there (conquest flips a captured island to your colours; modes
// can re-side islands on the fly). Everything reads allegiance through
// factionOf(), never island.faction directly.
const islandFaction = new Map();
function factionOf(is) { return islandFaction.get(is.name) || is.faction; }
function factionIdByName(name) { const is = (world.islands || []).find((i) => i.name === name); return is ? factionOf(is) : null; }

// Tactical map site data: airfields + carriers (always), and either the live
// ground defences (exact type + destroyed state, in a strike sortie) or the
// planned defence-site clusters. Consumed by the map for symbols + hover detail.
const SITE_LABEL = { sam: "SAM site", radar: "Radar", aa: "AA gun", bunker: "Bunker", tank: "Fuel depot", powerplant: "Power plant", carrier: "Carrier", runway: "Airfield", site: "Defence site" };
const OBJ_LABEL = { sam: "SAM", radar: "RADAR", bunker: "BUNKER", tank: "FUEL", powerplant: "PWR PLANT", carrier: "CARRIER" };
function stanceSide(stance) { return stance === "enemy" ? "hostile" : stance === "ally" ? "friendly" : "neutral"; }
function buildMapSites() {
  const sites = [];
  for (const isl of getIslandSpawns()) {
    for (const s of isl.spawns) {
      if (s.kind === "runway") sites.push({ x: s.x, z: s.z, kind: "runway", label: isl.name + " airfield", side: stanceSide(factions.vsPlayer(factionIdByName(isl.name))) });
    }
  }
  for (const c of getCarriers()) sites.push({ x: c.x, z: c.z, kind: "carrier", label: (c.team === "ally" ? "Allied" : "Hostile") + " carrier", side: c.team === "ally" ? "friendly" : "hostile" });
  const live = (flying && ground.targets && ground.targets.length) ? ground.targets : null;
  if (live) {
    for (const t of live) {
      if (!t.type || t.type === "searchlight") continue; // carrier handled above; searchlights are clutter
      const side = t.factionId ? stanceSide(factions.vsPlayer(t.factionId)) : "hostile";
      sites.push({ x: t.position.x, z: t.position.z, kind: t.type, label: SITE_LABEL[t.type] || t.type, alive: t.alive !== false, side, range: THREAT_RANGE[t.type] });
    }
  } else {
    for (const [wx, wz] of getMissionBases()) sites.push({ x: wx, z: wz, kind: "site", label: "Defence site · SAM/radar/AA", side: "hostile", range: THREAT_RANGE.site });
  }
  // Signature landmarks/structures, derived from the world config (so editor
  // additions show up too): radio tower + lighthouse on landmark islands, a
  // glowing spire on spire islands, and the power plant by each city.
  for (const is of getWorldConfig().islands) {
    const c = is.center, cf = is.cliff, side = stanceSide(factions.vsPlayer(factionIdByName(is.name)));
    if (cf && is.landmarks !== false) {
      sites.push({ x: c.x + cf.x, z: c.z + cf.z, kind: "radio", label: is.name + " radio tower", side: "neutral" });
      const cd = Math.hypot(cf.x, cf.z) || 1;
      sites.push({ x: c.x + (-cf.x / cd) * 6900, z: c.z + (-cf.z / cd) * 6900, kind: "lighthouse", label: is.name + " lighthouse", side: "neutral" });
    }
    if (cf && is.spire) sites.push({ x: c.x + cf.x, z: c.z + cf.z, kind: "spire", label: is.name + " spire", side });
    const px = c.x + 4900, pz = c.z + 5200;
    if (terrainHeight(px, pz) > SEA_LEVEL + 2) sites.push({ x: px, z: pz, kind: "powerplant", label: is.name + " power plant", side });
  }
  return sites;
}
function setIslandFaction(name, id) { if (name && id) islandFaction.set(name, id); }
function seedIslandFactions() {
  islandFaction.clear();
  for (const is of (world.islands || [])) islandFaction.set(is.name, is.faction);
}
let threatState = null; // nearest faction's state ("tracking"|"hunting"|null) for the HUD
// Ambient moving traffic (train, container ships, war zeppelin) — alive in
// every mode as roaming targets that the player can also crash into.
const traffic = new Traffic(scene, fx, { islands: world.islands, sea: SEA_LEVEL });
const sound = new SoundEngine();
fx.onAdd = (size, pos) => sound.explosion(size, pos); // positional booms
enemies.onFire = (pos) => sound.enemyGun(pos);         // positional enemy guns
ground.onFire = (pos) => sound.enemyGun(pos);          // carrier flak
traffic.onFire = (pos) => sound.enemyGun(pos);         // ship / zeppelin flak
enemyOrdnance.onLaunch = (pos) => sound.missile();     // incoming missile/rocket whoosh
ground.onLaunch = (pos) => sound.missile();            // SAM launch
// A detonation near the player jolts the camera — a real hit jolts it harder.
enemyOrdnance.onNearMiss = (pos, didDamage) => addShake(didDamage ? 4.5 : 3.0);
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
          const life = 12 + Math.random() * 6; // trees burn a good long while
          const fs = 2.0 + Math.random() * 1.4; // bigger flames, varied per tree
          // Fire sprouts from the greenery (canopy height), not the trunk.
          wrecks.spawnFire(new THREE.Vector3(tr.x, tr.cy, tr.z), { scale: fs, life, color: 0x2a261c, scorch: false });
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
// Landing a hit instantly alerts that target's island — they now know exactly
// where you are — and, if they weren't already hostile, drags their whole
// faction into war with you (retaliation).
weapons.onHit = (t) => {
  if (!t) return;
  if (t.faction) t.faction.spot(state.position);
  provokeByPlayer(t.factionId);
};

// Weather / time of day (sky, fog, lights, stars, rain).
const weather = new Weather(scene, world);
let weatherMode = "cycle"; // default to the deterministic real-clock day/night cycle
try { weatherMode = localStorage.getItem("rf.weather") || "cycle"; } catch (_) { /* ignore */ }
function applyWeather(mode) {
  if (mode === "cycle") weather.setAutoCycle(true);
  else { weather.setAutoCycle(false); weather.setMode(mode); }
}
applyWeather(weatherMode);
const wxSel = document.getElementById("weather-mode");
if (wxSel) {
  wxSel.value = weatherMode;
  wxSel.addEventListener("change", () => {
    weatherMode = wxSel.value;
    applyWeather(weatherMode);
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
let liveryId = "factory"; // selected paint scheme (persisted)
let insigniaId = "none";  // selected national/squadron insignia (persisted)
let tailNumber = -1;      // selected modex/tail number, -1 = off (persisted)
try {
  liveryId = localStorage.getItem("rf.livery") || "factory";
  insigniaId = localStorage.getItem("rf.insignia") || "none";
  const tn = localStorage.getItem("rf.tailnum");
  if (tn != null) tailNumber = parseInt(tn, 10);
} catch (_) { /* ignore */ }
const currentMarkings = () => ({ insignia: insigniaId, number: tailNumber });
let mesh = null;
let flying = false;
let gameMode = "free";
let missionDone = false;
let pendingMissionDef = null; // a specific mission def to load on next resetFlight (Surprise Me / campaign)
let currentMission = null;    // the active campaign mission def (null outside campaign)
let spawnOverride = null;     // {x,z} world center to spawn near (campaign missions on far islands)
let campaignProgress = campaign.loadProgress();
// Conquest: the live run (island ownership / progress) + the launch point chosen
// on the map screen. Both null outside conquest mode.
let conquestRun = null;
let conquestSpawn = null;     // {kind,x,z,...} runway/carrier the player launches from
let startPos = "air"; // "air" | "runway" | "carrier"
let preflight = null, pfPick = null; // strategic-map pre-flight planner: config + chosen launch point
let pendingSpawn = null, pendingJet = null, pendingMode = null; // quick/free planner launch
const AIR_START_ALT = 1200; // altitude (m) for an air start (free-flight pick or campaign drop-in)
// Every airfield + carrier across the archipelago — launch points for non-conquest planning.
function allLaunchPoints() {
  const out = [];
  for (const isl of getIslandSpawns()) for (const s of isl.spawns) out.push({ ...s });
  return out;
}
// Current target island: flagged on the planning map, drawn prominently in flight.
let targetIslandName = null;
try { targetIslandName = localStorage.getItem("rf.target") || null; } catch (_) { /* ignore */ }
function setTargetIsland(name) {
  targetIslandName = (targetIslandName === name) ? null : name; // click again to clear
  try { if (targetIslandName) localStorage.setItem("rf.target", targetIslandName); else localStorage.removeItem("rf.target"); } catch (_) { /* ignore */ }
  if (mapView && mapView.isOpen) mapView.draw();
}
// In-game vehicle bay: sim paused, camera orbits the parked vehicle at the spawn.
let hangarMode = false, hangarAngle = 0;
let hangarSpin = 0, hangarRadius = 8; // showroom preview: spin + auto-frame by size
const _hbBox = new THREE.Box3(), _hbTmp = new THREE.Box3(), _hbSph = new THREE.Sphere();
function measureHangarVehicle() {
  if (!mesh) { hangarRadius = 8; return; }
  mesh.updateWorldMatrix(true, true);
  _hbBox.makeEmpty();
  const skip = new Set(mesh.userData.flames || []);
  mesh.traverse((o) => {
    if (o.isMesh && o.geometry && !skip.has(o)) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _hbTmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      _hbBox.union(_hbTmp);
    }
  });
  _hbBox.getBoundingSphere(_hbSph);
  hangarRadius = Math.max(3, _hbSph.radius);
}
let paused = false;                 // Esc pause menu (sim frozen)
let crashHandled = false, respawnTimer = 0; // crash → wreckage → soft respawn
// Camera shake: a decaying jolt that nearby blasts / missile hits add to
// (addShake), applied to the camera each frame once it's been positioned.
let camShake = 0;
function addShake(amt) { camShake = Math.min(7, camShake + amt); }

// Afterburner / turbo boost: hold the throttle at the firewall (turbo jets only)
// for ~1.7x thrust. boostFx is the eased 0..1 visual amount (engine cones, FOV
// punch, world warp, speed streaks). You can't fire while boosting.
const BOOST_THRUST = 2.6;   // thrust multiplier when lit — punchy accel + a clearly higher top speed
const BOOST_FOV = 18;       // extra FOV (degrees) at full boost
let boostActive = false;
let boostFx = 0;
// Comms event tracking (kill tallies + airborne state) for callouts.
let prevDestroyed = 0, prevKills = 0, wasOnGround = true;

// Speed streaks that rip past the camera while the afterburner is lit. A small
// pool of additive dashes scattered ahead in world space, streaming aft.
const speedLines = (() => {
  const N = 80;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const seg = new THREE.LineSegments(geo, mat);
  seg.frustumCulled = false; seg.visible = false;
  scene.add(seg);
  const pts = []; for (let i = 0; i < N; i++) { const p = new THREE.Vector3(); p._init = false; pts.push(p); }
  return { N, geo, mat, seg, pts };
})();
function updateSpeedLines(dt, amt) {
  const sl = speedLines;
  const vis = amt > 0.03 && flying && !state.crashed && !hangarMode;
  sl.seg.visible = vis;
  if (!vis) { sl.mat.opacity = 0; return; }
  sl.mat.opacity = amt * 0.5;
  const v = state.velocity, sp = Math.max(80, v.length());
  const fX = v.x / sp, fY = v.y / sp, fZ = v.z / sp;     // forward unit
  const cam = camera.position;
  const len = 26 + sp * 0.16, R = 230, spawnDist = 360;
  const arr = sl.geo.attributes.position.array;
  for (let i = 0; i < sl.N; i++) {
    const p = sl.pts[i];
    p.addScaledVector(v, -dt);                            // stream aft relative to the jet
    const ahead = (p.x - cam.x) * fX + (p.y - cam.y) * fY + (p.z - cam.z) * fZ;
    if (!p._init || ahead < -90) {
      p._init = true;
      p.set(cam.x + fX * spawnDist + (Math.random() - 0.5) * R * 2,
            cam.y + fY * spawnDist + (Math.random() - 0.5) * R * 2,
            cam.z + fZ * spawnDist + (Math.random() - 0.5) * R * 2);
    }
    const k = i * 6;
    arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.z;
    arr[k + 3] = p.x - fX * len; arr[k + 4] = p.y - fY * len; arr[k + 5] = p.z - fZ * len;
  }
  sl.geo.attributes.position.needsUpdate = true;
}

// Throttle "arming" gesture before a flight begins (see updateArming).
let armActive = false, armUp = false, armOpposite = false, armInit = false, armHint = "";
const ARM_HI = 0.9, ARM_LO = 0.08;

const CAMS = ["Chase", "Far Chase", "Cockpit", "Rear View"];
function camList() { return CAMS; }
function currentCam() { return CAMS[camIndex % CAMS.length]; }
let camIndex = 0;
try { camIndex = Math.max(0, parseInt(localStorage.getItem("rf.cam") || "0", 10)) % CAMS.length; } catch (_) { /* ignore */ }
function setCamIndex(i) {
  camIndex = ((i % CAMS.length) + CAMS.length) % CAMS.length;
  try { localStorage.setItem("rf.cam", String(camIndex)); } catch (_) { /* ignore */ }
}
// Bomb Sight (bombardier look-down) is a separate toggle, only on bombers — not
// part of the camera rotation. It overrides whatever chase view is selected.
let bombSightOn = false;
function bombSightActive() { return bombSightOn && def && def.loadout && def.loadout.bombs > 0; }
function activeCamName() { return flybyActive ? "Flyby" : (bombSightActive() ? "Bomb Sight" : currentCam()); }

// Flyby: a one-shot cinematic pass. Press the button → a camera is dropped far
// ahead, almost directly on your flight path; you streak past it, then it hands
// control back to your normal view. Not part of the camera cycle.
let flybyActive = false, flybyT = 0;
let flybyAnchor = null;
const _flyFwd = new THREE.Vector3(), _flySide = new THREE.Vector3();
function triggerFlyby() {
  if (!flying || state.crashed || hangarMode || inXR) return;
  _flyFwd.copy(state.velocity); _flyFwd.y = 0;
  if (_flyFwd.lengthSq() < 1) { _flyFwd.set(0, 0, -1).applyQuaternion(state.quaternion); _flyFwd.y = 0; }
  _flyFwd.normalize();
  if (!flybyAnchor) flybyAnchor = new THREE.Vector3();
  // Far out and almost dead ahead on the path (tiny lateral so the jet doesn't
  // clip the lens), a touch above and clear of the ground.
  _flySide.set(-_flyFwd.z, 0, _flyFwd.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * 12);
  flybyAnchor.copy(state.position).addScaledVector(_flyFwd, 440).add(_flySide);
  flybyAnchor.y = Math.max(state.position.y + 14, groundHeightAt(flybyAnchor.x, flybyAnchor.z) + 16);
  camTarget.copy(state.position);
  flybyActive = true; flybyT = 0;
}

// HUD toggles (persisted): radar-off = "pure flight" (no target/enemy markers or
// radar); hud-off = blank screen, just the world.
let radarOff = false, hudOff = false;
try { radarOff = localStorage.getItem("rf.radarOff") === "1"; hudOff = localStorage.getItem("rf.hudOff") === "1"; } catch (_) { /* ignore */ }
function setRadarOff(v) { radarOff = v; try { localStorage.setItem("rf.radarOff", v ? "1" : "0"); } catch (_) { /* ignore */ } }
function setHudOff(v) { hudOff = v; try { localStorage.setItem("rf.hudOff", v ? "1" : "0"); } catch (_) { /* ignore */ } }

// Rearm: always free + instant at a friendly base. Out in the fight, when you're
// low a supply balloon is air-dropped near the edge of the combat zone — reach
// it (fly through / gun it / lock a missile onto it) to rearm (toggle).
let autoRearm = true, canReload = true, supplyCd = 0;
try { autoRearm = localStorage.getItem("rf.autoRearm") !== "0"; } catch (_) { /* ignore */ }
function setAutoRearm(v) { autoRearm = v; try { localStorage.setItem("rf.autoRearm", v ? "1" : "0"); } catch (_) { /* ignore */ } if (!v) supply.consume(); }
const supply = new SupplyDrop(scene);
function nearestIsland() { let n = null, bd = Infinity; for (const is of (world.islands || [])) { const d = Math.hypot(state.position.x - is.center.x, state.position.z - is.center.z); if (d < bd) { bd = d; n = is; } } return n; }
function atFriendlyBase() {
  const c = getCarriers().find((k) => k.team === "ally");
  if (c && Math.hypot(state.position.x - c.x, state.position.z - c.z) < 800) return true;
  for (const sp of getIslandSpawns()) {
    if (factions.vsPlayer(factionIdByName(sp.name)) !== "ally") continue;
    for (const s of sp.spawns) if (s.kind === "runway" && Math.hypot(state.position.x - s.x, state.position.z - s.z) < 900) return true;
  }
  return false;
}
function doRearm(sub) {
  player.health = 100;
  weapons.rearm(def.loadout);
  flashBanner("REARMED", sub, 2.4);
  comms("Rearmed and ready", "rearm", 0);
}
function needsRearm() { return player.health < 100 || weapons.needsRearm(def.loadout); }
// Drop a supply balloon offshore on the player's side, out near the safe range.
function spawnSupplyBalloon() {
  const n = nearestIsland();
  let dx = n ? state.position.x - n.center.x : 0, dz = n ? state.position.z - n.center.z : -1;
  const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const cfg = n ? getWorldConfig().islands.find((i) => i.name === n.name) : null;
  const outer = (cfg && cfg.terrain && cfg.terrain.islandOuter) || 9500;
  const px = (n ? n.center.x : state.position.x) + dx * (outer + 5000);
  const pz = (n ? n.center.z : state.position.z) + dz * (outer + 5000);
  supply.spawn(px, pz);
  flashBanner("RESUPPLY INBOUND", "Reach the supply balloon — fly through, gun, or missile it", 3.2);
  comms("Supply balloon inbound", "supply", 0);
}
function updateResupply(dt) {
  if (!flying || state.crashed) { return; }
  // Base: free, instant, any time you need it.
  if (atFriendlyBase()) {
    if (canReload && needsRearm()) { doRearm("At base — full ammo + armour"); canReload = false; }
    return;
  }
  canReload = true; // re-arm the base reload once you leave
  if (!autoRearm) return;
  if (supply.active) {
    supply.update(dt);
    const d = supply.active;
    if (d.delivered || state.position.distanceTo(d.position) < d.radius + (player.radius || 30)) {
      doRearm("Resupplied — full ammo + armour");
      fx.add(d.position, 1.6, 0xffd27d);
      supply.consume();
      supplyCd = 30; // a beat before another can be called
    }
    return;
  }
  supplyCd -= dt;
  if (supplyCd <= 0 && needsRearm()) { spawnSupplyBalloon(); supplyCd = 1e9; } // stays until reached
}
// Landing-approach guidance (toggle with L / a joystick button). Targets the
// home runway at the island origin.
const approach = new Approach({ cx: 0, cz: 0 });
let approachOn = false;

// Mission objectives (Strike / Campaign). Completion/fail drive the banners.
const missions = new MissionManager();
missions.onComplete = () => {
  // Conquest detects a captured island in updateConquest (it may have several
  // islands in flight) — don't let the objective-cleared signal end the run.
  if (gameMode === "conquest") return;
  if (missionDone) return;
  missionDone = true;
  if (gameMode === "campaign" && currentMission) {
    campaign.markComplete(currentMission.id, campaignProgress);
    const nxt = campaign.nextMission(currentMission.id);
    ui.showBanner("MISSION COMPLETE", nxt ? `Next up: ${nxt.title} — Esc for the briefing` : "Campaign clear! — Esc for the menu");
  } else {
    ui.showBanner("MISSION COMPLETE", "Keep flying — Esc for the menu");
  }
  comms("All objectives complete", "obj", 0);
  bannerTimer = 0;
};
missions.onFail = () => { flashBanner("OBJECTIVE FAILED", "", 3); };

// Open the campaign: pick the furthest unlocked-but-incomplete mission and brief it.
function openCampaign() {
  let target = campaign.firstMission();
  for (const m of campaign.CAMPAIGN) {
    if (campaign.isUnlocked(m.id, campaignProgress) && !campaign.isComplete(m.id, campaignProgress)) { target = m; break; }
  }
  openBriefing(target.id);
}
function openBriefing(missionId) {
  const m = campaign.missionById(missionId) || campaign.firstMission();
  currentMission = m;
  flying = false;
  ui.showBriefing(m, campaignProgress, world);
}

// --- Conquest: take the whole archipelago, island by island ----------------
// Campaigns persist their strategic state (owned islands + rules) to
// localStorage as named save slots, so a browser refresh resumes where you left
// off — you relaunch fresh from a held island, with all progress intact.
const CQ_KEY = "rf.cq.saves";
let conquestSlot = null; // id of the campaign currently in play
let cqPendingName = null; // name for a brand-new campaign (used at its first save)
function cqReadSaves() { try { return JSON.parse(localStorage.getItem(CQ_KEY) || "{}") || {}; } catch (_) { return {}; } }
function cqWriteSaves(m) { try { localStorage.setItem(CQ_KEY, JSON.stringify(m)); } catch (_) { /* ignore */ } }
function listConquestSaves() { const m = cqReadSaves(); return Object.keys(m).map((id) => ({ id, ...m[id] })).sort((a, b) => b.ts - a.ts); }
function saveConquest() {
  if (!conquestSlot || !conquestRun) return;
  const m = cqReadSaves(), prev = m[conquestSlot];
  const ac = getCarriers().find((c) => c.team === "ally");
  m[conquestSlot] = {
    name: (prev && prev.name) || cqPendingName || ("Campaign " + (Object.keys(m).length + 1)),
    ts: Date.now(), difficulty: conquestRun.difficulty,
    owned: conquestRun.ownedNodes().length, total: conquestRun.nodes.length, won: !!conquestRun.won,
    carrier: ac ? { x: ac.x, z: ac.z } : null, // remember where the carrier is parked
    data: conquestRun.serialize(),
  };
  cqWriteSaves(m);
  cqPendingName = null;
}
function deleteConquestSave(id) { const m = cqReadSaves(); delete m[id]; cqWriteSaves(m); }
function renameConquest(id, name) { const m = cqReadSaves(); if (m[id] && name && name.trim()) { m[id].name = name.trim(); cqWriteSaves(m); } }
// Menu → Conquest: pick a campaign (new, or resume a saved one).
function openConquestSaves() {
  flying = false;
  ui.showConquestSaves(listConquestSaves(), {
    onNew: (name) => { ui.hideConquestSaves(); newConquestCampaign(name); },
    onLoad: (id) => loadConquest(id),
    onRename: (id, name) => { renameConquest(id, name); openConquestSaves(); },
    onDelete: (id) => { deleteConquestSave(id); openConquestSaves(); },
    onBack: () => { ui.hideConquestSaves(); ui.showMenu(); },
  });
}
function newConquestCampaign(name) { cqPendingName = (name && name.trim()) ? name.trim() : null; conquestSlot = "cq" + Date.now().toString(36); openConquest(); }
// Resume a saved campaign: rebuild the run, restore ownership, launch fresh.
function loadConquest(id) {
  const save = cqReadSaves()[id];
  if (!save) return;
  factions = new Factions(getFactionConfig());
  conquestRun = new cq.ConquestRun(getIslandSpawns(), { difficulty: "veteran", factions });
  conquestRun.restore(save.data);
  conquestSlot = id;
  gameMode = "conquest";
  // Put the carrier back where it was parked.
  const c = save.carrier;
  if (c && moveCarrier("ally", c.x, c.z) && world.carriers && world.carriers.ally) world.carriers.ally.position.set(c.x, SEA_LEVEL, c.z);
  ui.hideConquestSaves();
  openPreflight({ mode: "conquest-resume", title: "RESUME CAMPAIGN",
    hint: "Your held islands are yours — pick a captured airfield or carrier to launch from.",
    rules: true, diff: conquestRun.difficulty, spawns: conquestRun.ownedSpawns() });
}
function resumeConquest(spawn) { conquestSpawn = spawn; startFlight(jetType, "conquest"); }

// Open the strategic map as the pre-flight planner: pick a beachhead + rules, then launch.
function openConquest() {
  factions = new Factions(getFactionConfig()); // current allegiances drive who you must take
  conquestRun = new cq.ConquestRun(getIslandSpawns(), { difficulty: "veteran", factions });
  openPreflight({ mode: "conquest-setup", title: "CHOOSE YOUR BEACHHEAD",
    hint: "Pick an island to land and seize — click its airfield or carrier to launch from.",
    rules: true, diff: "veteran", spawns: conquestRun.allSpawns() });
}
// Setup → flight: grant the chosen beachhead and launch from it.
function beginConquest(spawn, lives, difficulty) {
  if (!conquestRun) return;
  setLives(lives);
  conquestRun.difficulty = difficulty || conquestRun.difficulty;
  conquestRun.setStart(spawn.node);
  saveConquest(); // record the new campaign with its beachhead
  conquestSpawn = spawn;
  startFlight(jetType, "conquest");
}
// Death with lives left → reopen the planner to pick another owned runway/carrier.
function openConquestRespawn() {
  openPreflight({ mode: "conquest-respawn", title: "CHOOSE A LAUNCH POINT",
    hint: "Aircraft down. Pick a captured airfield or carrier to get back in the fight.",
    rules: false, spawns: conquestRun.ownedSpawns() });
}
function respawnConquest(spawn) {
  conquestSpawn = spawn;
  enterHangar(false); // drop into the vehicle bay at the chosen launch point
}

// --- Strategic-map pre-flight planner -------------------------------------
// Opens the full tactical map with a bottom bar: pick a launch point (any
// airfield/carrier), set rules, plot a route / plant the carrier / flag a
// target, then LAUNCH. Replaces the old cramped beachhead panel.
function openPreflight(cfg) {
  preflight = cfg; pfPick = cfg.pick || null;
  flying = false;
  ui.hideConquestSaves(); ui.hideConquest(); // the full-screen map overlay covers the menu
  const el = (id) => document.getElementById(id);
  el("pf-title").textContent = cfg.title;
  const rules = el("preflight-bar").querySelector(".pf-rules");
  if (rules) rules.style.display = cfg.rules ? "" : "none";
  const lv = el("pf-lives"); if (lv && cfg.lives) lv.value = cfg.lives;
  const df = el("pf-diff"); if (df && cfg.diff) df.value = cfg.diff;
  el("preflight-bar").classList.remove("hidden");
  document.getElementById("mapview").classList.add("planning");
  // Pre-flight is a planning context: full editing tools available, none active.
  mapView.editable = true;
  mapView.setRouteMode(false); mapView.setCarrierMode(false); mapView.setTargetMode(false);
  mapView.preflightAir = !!cfg.allowAir; // free flight: click open map to air-start anywhere
  for (const t of ["map-route", "map-route-clear", "map-routes", "map-carrier", "map-target", "map-labels"]) { const e = el(t); if (e) e.style.display = ""; }
  hideRoutesPanel();
  syncRouteBtn();
  updatePfReadout();
  el("pf-launch").disabled = !pfPick;
  mapView.setPreflight(true);
  mapView.open();
}
function pickLaunchByIsland(name) {
  if (!preflight) return;
  // Spawn names are "<Island> airfield" / "<Island> carrier" — prefer the runway.
  const sp = preflight.spawns.find((s) => s.kind === "runway" && s.name.indexOf(name) === 0)
    || preflight.spawns.find((s) => s.name.indexOf(name) === 0);
  if (!sp) return; // island has no available launch point (e.g. enemy island on respawn)
  pfPick = sp; afterPfPick();
}
// Quick/free modes: open the strategic map to pick any airfield/carrier (and,
// for Free Flight, click open map to air-start anywhere), then LAUNCH.
function openQuickPlanner(jet, mode) {
  pendingJet = jet; pendingMode = mode;
  const allowAir = mode === "free";
  const cfg = { mode: "quick", title: "PLAN YOUR SORTIE",
    hint: allowAir ? "Click any airfield or carrier — or click open map to air-start anywhere." : "Click any airfield or carrier to launch from.",
    rules: false, allowAir, spawns: allLaunchPoints() };
  cfg.pick = restoreLastStart(cfg.spawns, allowAir);
  openPreflight(cfg);
}
function saveLastStart(pick) {
  try { localStorage.setItem("rf.lastStart", JSON.stringify({ kind: pick.kind, x: pick.x, z: pick.z, name: pick.name })); } catch (_) { /* ignore */ }
}
function restoreLastStart(spawns, allowAir) {
  let last = null;
  try { last = JSON.parse(localStorage.getItem("rf.lastStart") || "null"); } catch (_) { /* ignore */ }
  if (last && last.kind === "air") return allowAir ? { kind: "air", x: last.x, z: last.z, name: "Air start" } : null;
  if (last) { const m = spawns.find((s) => s.name === last.name) || spawns.find((s) => Math.hypot(s.x - last.x, s.z - last.z) < 50); if (m) return m; }
  return spawns.find((s) => s.kind === "runway") || spawns[0] || null;
}
function afterPfPick() {
  updatePfReadout();
  const b = document.getElementById("pf-launch"); if (b) b.disabled = !pfPick;
  if (mapView.isOpen) mapView.draw();
}
function updatePfReadout() {
  const r = document.getElementById("pf-readout"); if (!r) return;
  if (pfPick) r.textContent = pfPick.kind === "air" ? "Air start — flying in over the chosen point"
    : ("Launching from " + pfPick.name + (pfPick.kind === "carrier" ? " — carrier" : " — airfield"));
  else r.textContent = (preflight && preflight.allowAir) ? "Click an airfield/carrier — or open map to air-start anywhere"
    : "Click an airfield or carrier on the map to launch from";
}
// Tear down the planner UI (shared by launch / back / Esc).
function teardownPreflight() {
  preflight = null; pfPick = null;
  mapView.setPreflight(false);
  const bar = document.getElementById("preflight-bar"); if (bar) bar.classList.add("hidden");
  hideRoutesPanel();
  document.getElementById("mapview").classList.remove("planning");
  if (mapView.isOpen) mapView.close();
}
function pfLaunch() {
  if (!pfPick || !preflight) return;
  const mode = preflight.mode, pick = pfPick, qjet = preflight.jet || pendingJet, qmode = pendingMode;
  const lv = document.getElementById("pf-lives"), df = document.getElementById("pf-diff");
  const lives = lv ? lv.value : "infinite", diff = df ? df.value : "veteran";
  teardownPreflight();
  if (mode === "conquest-setup") beginConquest(pick, lives, diff);
  else if (mode === "conquest-resume") { if (conquestRun) conquestRun.difficulty = diff; setLives(lives); resumeConquest(pick); }
  else if (mode === "conquest-respawn") respawnConquest(pick);
  else if (mode === "quick") { saveLastStart(pick); pendingSpawn = pick; startFlight(qjet, qmode, pick.kind === "air" ? "air" : "runway"); }
}
function pfBack() { teardownPreflight(); ui.showMenu(); }
// Esc/✕ closed the map mid-plan: cancel and return to the menu.
function cancelPreflight() {
  preflight = null; pfPick = null;
  mapView.setPreflight(false);
  const bar = document.getElementById("preflight-bar"); if (bar) bar.classList.add("hidden");
  hideRoutesPanel();
  document.getElementById("mapview").classList.remove("planning");
  ui.showMenu();
}
// The nearest enemy island's pickets scramble as you arrive; its targets become
// the active objective so the HUD marks them.
function wakeIsland(node) {
  node.awake = true;
  conquestRun.activeId = node.id;
  if (!node.defended) {
    node.defended = true;
    const d = conquestRun.defenseFor(node);
    if (d.fighters > 0) {
      const isl = getIslandSpawns().find((s) => s.name === node.name);
      const rw = isl && isl.spawns.find((s) => s.kind === "runway");
      const patrol = d.fighters >= 4 ? 1 : 0; // a small standing CAP already up
      enemies.spawnDefenders(d.fighters, d.diff, { x: node.center.x, z: node.center.z }, { runway: rw, patrol });
      assignFactions();
    }
  }
  missionDone = false;
  missions.load({ objectives: [{ type: "destroy", priority: "primary", label: "Seize " + node.name, match: (t) => t._node === node.id }] }, ground);
  flashBanner("DEFENSES SCRAMBLING", node.name + " is defending — clear it out", 3);
}
// Plant the friendly carrier at a player-chosen world point. The map already
// validates the spot (deep water, clear of hostile islands); here we move it,
// reposition the mesh, and persist so it stays put between sorties + campaigns.
function plantCarrier(wx, wz) {
  if (!moveCarrier("ally", wx, wz)) return;
  if (world.carriers && world.carriers.ally) world.carriers.ally.position.set(wx, SEA_LEVEL, wz);
  try { localStorage.setItem("rf.carrier", JSON.stringify({ x: wx, z: wz })); } catch (_) { /* ignore */ }
  if (gameMode === "conquest" && conquestRun) saveConquest(); // persist the carrier's station with the campaign
  flashBanner("CARRIER STATIONED", "Allied carrier repositioned", 2.2);
}
// Restore the carrier to its last planted station (saved globally). Conquest
// campaigns carry their own carrier position and override this on load.
function restoreCarrier() {
  try {
    const c = JSON.parse(localStorage.getItem("rf.carrier") || "null");
    if (c && isFinite(c.x) && isFinite(c.z) && moveCarrier("ally", c.x, c.z) && world.carriers && world.carriers.ally) {
      world.carriers.ally.position.set(c.x, SEA_LEVEL, c.z);
    }
  } catch (_) { /* ignore */ }
}
function captureIsland(node) {
  conquestRun.capture(node);
  setIslandFaction(node.name, factions.playerFaction); // it flies your colours now
  awareness.factions.delete(node.name); // its defences are yours/dead — stop detecting
  missions.active = false; missions.status = "idle";
  if (conquestRun.checkWon()) {
    ui.showBanner("ARCHIPELAGO SECURED", "Every island is yours — Esc for the menu"); bannerTimer = 0;
    comms("Archipelago secured", "obj", 0);
  } else {
    flashBanner("ISLAND CAPTURED", node.name + " is yours — launch from it anytime", 3.4);
    comms("Island secured", "obj", 0);
  }
  saveConquest(); // persist strategic progress on every capture
}
// Per-frame conquest tick: wake the island you're closing on, and claim any
// awake island whose defenses are wiped out.
function updateConquest() {
  if (!conquestRun || conquestRun.won) return;
  const near = conquestRun.nearestEnemy(state.position);
  if (near && !near.node.awake && near.dist < cq.AWAKE_RANGE) wakeIsland(near.node);
  const a = conquestRun.activeId != null ? conquestRun.node(conquestRun.activeId) : null;
  if (a && a.awake && !a.captured && conquestRun.isCleared(a)) captureIsland(a);
}

let ringsHit = 0;
// Transient on-screen banner (auto-hides). Persistent banners use ui.showBanner
// directly and set bannerTimer = 0 so this never clears them early.
let bannerTimer = 0;
function flashBanner(title, sub, secs = 2.4) { ui.showBanner(title, sub); bannerTimer = secs; }
// Lives / respawns: "1" (Pro, one life) | "3" | "infinite" (default; kid mode —
// you can keep going forever). Free flight, multiplayer and VR are always
// infinite. Out of lives ends the run (mission retry is wired in once campaigns
// land).
let livesMode = "infinite";
try { livesMode = localStorage.getItem("rf.lives") || "infinite"; } catch (_) { /* ignore */ }
let livesLeft = Infinity;
function setLives(v) { livesMode = v; try { localStorage.setItem("rf.lives", v); } catch (_) { /* ignore */ } }
function livesForMode() {
  if (gameMode === "free" || gameMode === "ffa" || inXR) return Infinity;
  return livesMode === "1" ? 1 : livesMode === "3" ? 3 : Infinity;
}

// Ground reticle showing the predicted bomb impact (shown in Bomb Sight).
const bombMarker = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(8, 11, 28), mat);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(20, 22, 32), mat);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(28, 0.6, 1.4), mat);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 28), mat);
  for (const m of [ring, ring2]) m.rotation.x = -Math.PI / 2;
  bombMarker.add(ring, ring2, cross, cross2);
  bombMarker.renderOrder = 997;
  bombMarker.visible = false;
  scene.add(bombMarker);
}
const _bombHit = new THREE.Vector3();
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
    else comms(this.health < 35 ? "We're hit, going down" : "We're hit", "hit", 3);
  },
};

const CRASH_DAMAGE = 130;   // ramming something hits it like a missile would
const CRASH_CAM_TIME = 5.0; // death-cam length before the respawn switch

// A crash: leave persistent burning wreckage at the site, hide the aircraft,
// and start the timer that respawns the player.
function handleCrash(title) {
  if (crashHandled) return;
  crashHandled = true;
  fx.add(state.position, 3.4, 0xffa233, true); // silent: the dedicated crash sound plays instead
  sound.crash(state.position);
  fx.shards(state.position, mesh, state.quaternion, 16); // fling actual pieces of the jet
  // Wreckage sits on the surface below the impact point — but only on land;
  // a crash into the sea just sinks (no burning wreck on the water).
  const gx = state.position.x, gz = state.position.z;
  const solid = groundHeightAt(gx, gz);
  if (solid >= SEA_LEVEL) wrecks.spawn(new THREE.Vector3(gx, solid + 0.5, gz), def.color);
  else fx.add(new THREE.Vector3(gx, SEA_LEVEL, gz), 2.2, 0x9fb4c4); // splash on the water
  // Whatever you slammed into takes a missile-grade hit (you take it with you).
  const py = state.position.y;
  const ramOne = (t) => {
    if (!t.alive) return;
    const r = (t.radius || 24) + 16;
    const tp = t.position;
    if (Math.abs(gx - tp.x) < r && Math.abs(gz - tp.z) < r && Math.abs(py - tp.y) < r + 30) t.hit(CRASH_DAMAGE);
  };
  for (const t of ground.targets) ramOne(t);
  for (const e of enemies.targets) ramOne(e);
  for (const t of traffic.targets) ramOne(t);
  sound.stopEngine(); sound.stopSeek();
  const sub = livesLeft === Infinity ? "Recovering a new aircraft…"
    : (livesLeft > 1 ? `Recovering a new aircraft…  (${livesLeft - 1} left)` : "Last aircraft down…");
  ui.showBanner(title || "AIRCRAFT DOWN", sub); bannerTimer = 0;
  respawnTimer = CRASH_CAM_TIME;
}

// No aircraft left (finite lives ran out). For now this ends the run and drops
// to the menu; once campaigns land this routes to a mission-retry/briefing.
function outOfLives() {
  flying = false;
  const isCamp = gameMode === "campaign" && currentMission;
  ui.showBanner("OUT OF AIRCRAFT", isCamp ? "Regroup and try again" : "Run over — returning to base"); bannerTimer = 0;
  sound.stopEngine(); sound.stopSeek();
  const m = currentMission;
  setTimeout(() => {
    if (flying) return; // already restarted some other way
    if (isCamp && m) { exitFlightToBriefing(m.id); } else { exitToMenu(); }
  }, 2400);
}
// Tear down the flight and reopen the briefing room (campaign mission retry).
function exitFlightToBriefing(missionId) {
  paused = false; hangarMode = false;
  wrecks.reset();
  ui.hidePause(); ui.hideHangar();
  const fab = document.getElementById("btn-hangar"); if (fab) fab.classList.add("hidden");
  touch.setVisible(false);
  sound.stopEngine(); sound.stopSeek(); sound.setBoost(0);
  sound.startMenuMusic();
  openBriefing(missionId);
}


const ui = new UI(input, {
  onFly: (type, mode, start) => { pendingSpawn = null; startFlight(type, mode, start); }, // "Launch now" — quick start
  onPlan: (type, mode) => openQuickPlanner(type, mode), // "Plan" — open the strategic map planner
  onVR: (type, mode, start) => { pendingSpawn = null; enterVR(type, mode, start); },
  onSelectJet: (type) => { if (!flying) setAircraft(type); }, // live hero swap on the menu
  onPickVehicle: (type) => pickVehicle(type),   // in-game vehicle bay: spawn this ride
  onPreviewVehicle: (type) => previewVehicle(type), // live-swap the rotating preview model
  onPreviewLivery: (id) => setLivery(id),       // repaint the previewed vehicle
  onPreviewInsignia: (id) => setInsignia(id),   // restick the previewed vehicle's insignia
  onPreviewNumber: (n) => setTailNumber(n),     // change the tail/modex number
  liveryId: () => liveryId,                     // current paint, so the bay can highlight it
  insigniaId: () => insigniaId,                 // current insignia
  tailNumber: () => tailNumber,                 // current number (-1 = off)
  onHangarStay: () => exitHangar(),             // keep the current vehicle, close the bay
  onPauseResume: () => closePause(),
  onPauseMenu: () => exitToMenu(),
  onLives: (v) => setLives(v),                  // 1 / 3 / infinite respawns
  livesMode: () => livesMode,
  onOpenCampaign: () => openCampaign(),         // menu "Campaign" → briefing room
  onBriefingLaunch: (missionId, type) => {      // briefing "Launch" → fly the mission
    const m = campaign.missionById(missionId);
    currentMission = m;
    startFlight(type, "campaign", m ? m.start : "air");
  },
  factionHoldings: () => {                       // islands each faction holds (for the dossier)
    const h = {};
    for (const is of (world.islands || [])) (h[factionOf(is)] = h[factionOf(is)] || []).push(is.name);
    return h;
  },
  drawConquestMap: (selectedNodeId, startMarker) => { // render the accurate planner map
    cqSelectedNodeId = selectedNodeId;
    cqStartMarker = startMarker || null;        // plane icon at the chosen launch point
    cqMap.refresh();
  },
  onOpenConquest: () => openConquestSaves(),    // menu "Conquest" → campaign picker
  onConquestLaunch: (spawn, lives, diff) => beginConquest(spawn, lives, diff),
  onConquestResume: (spawn) => resumeConquest(spawn), // launch a loaded campaign
  onConquestRespawn: (spawn) => respawnConquest(spawn),
}, touch, tilt);

// Accurate archipelago map — overview + click-to-zoom, on the menu and live in
// flight (a tactical kneeboard; the sim keeps running underneath).
// --- Flight-plan route: waypoints drawn on the map, flown in-game ------------
const ROUTE_REACH = 450;   // pass within this (m) of a waypoint to tick it off
let route = [];     // [{x, z, alt, type, snap}] world coords — the ACTIVE route's wpts
let routes = [];    // [{ id, name, wpts }] all named routes
let activeRouteId = null;
let routeIdx = 0;   // index of the current target waypoint (auto-advances)
let routeOn = true; // in-game route visibility (toggle with P)
function routeAlt(x, z) { return Math.max(terrainHeight(x, z) + 300, SEA_LEVEL + 500); }
function normWpt(w) {
  return { x: +w.x, z: +w.z, alt: isFinite(w.alt) ? w.alt : (isFinite(w.y) ? w.y : routeAlt(+w.x, +w.z)),
    type: WPT_TYPES[w.type] ? w.type : "nav", snap: w.snap || null };
}
function newRouteId() { return "r" + Date.now().toString(36) + Math.floor(Math.random() * 1000); }
function activeRoute() { return routes.find((r) => r.id === activeRouteId) || routes[0]; }
// Load named routes, migrating the legacy single `rf.route` into "Route 1".
(function loadRoutes() {
  try {
    const raw = JSON.parse(localStorage.getItem("rf.routes") || "null");
    if (raw && Array.isArray(raw.list) && raw.list.length) {
      routes = raw.list.map((r) => ({ id: r.id || newRouteId(), name: r.name || "Route",
        wpts: (r.wpts || []).filter((w) => w && isFinite(w.x) && isFinite(w.z)).map(normWpt) }));
      activeRouteId = raw.active;
    }
  } catch (_) { /* ignore */ }
  if (!routes.length) {
    let legacy = [];
    try { const r = JSON.parse(localStorage.getItem("rf.route") || "[]"); if (Array.isArray(r)) legacy = r.filter((w) => w && isFinite(w.x) && isFinite(w.z)).map(normWpt); } catch (_) { /* ignore */ }
    routes = [{ id: newRouteId(), name: "Route 1", wpts: legacy }];
  }
  if (!routes.find((r) => r.id === activeRouteId)) activeRouteId = routes[0].id;
  route = activeRoute().wpts;
})();
function saveRoute() { // persist all routes (kept the old name — many callers)
  try { localStorage.setItem("rf.routes", JSON.stringify({ list: routes.map((r) => ({ id: r.id, name: r.name, wpts: r.wpts })), active: activeRouteId })); } catch (_) { /* ignore */ }
  const p = document.getElementById("routes-panel"); // keep the plans panel's wp counts live
  if (p && !p.classList.contains("hidden")) renderRoutesPanel();
}
// --- Named-route management (the ROUTES panel on the map) ---
function setActiveRoute(id) {
  if (!routes.find((r) => r.id === id)) return;
  activeRouteId = id; route = activeRoute().wpts; routeIdx = 0;
  saveRoute(); showWptInspector(null); if (mapView.isOpen) mapView.draw();
}
function addRoute(name) {
  const r = { id: newRouteId(), name: (name && name.trim()) || ("Route " + (routes.length + 1)), wpts: [] };
  routes.push(r); setActiveRoute(r.id); return r;
}
function renameRoute(id, name) { const r = routes.find((x) => x.id === id); if (r && name && name.trim()) { r.name = name.trim(); saveRoute(); } }
function deleteRoute(id) {
  if (routes.length <= 1) { const r = routes[0]; r.wpts.length = 0; routeIdx = 0; saveRoute(); } // keep one route; just empty it
  else { routes = routes.filter((r) => r.id !== id); if (id === activeRouteId) { activeRouteId = routes[0].id; route = activeRoute().wpts; routeIdx = 0; } saveRoute(); }
  showWptInspector(null); if (mapView.isOpen) mapView.draw();
}
function renderRoutesPanel() {
  const list = document.getElementById("rp-list"); if (!list) return;
  list.innerHTML = "";
  for (const r of routes) {
    const row = document.createElement("div");
    row.className = "rp-row" + (r.id === activeRouteId ? " active" : "");
    row.innerHTML = `<span class="rp-name"></span><span class="rp-count">${r.wpts.length} wp</span>`
      + `<button data-ren title="Rename">✎</button><button data-del title="Delete">🗑</button>`;
    row.querySelector(".rp-name").textContent = r.name;
    row.addEventListener("click", (e) => { if (e.target.closest("button")) return; setActiveRoute(r.id); renderRoutesPanel(); });
    row.querySelector("[data-ren]").addEventListener("click", () => { const n = window.prompt("Rename flight plan", r.name); if (n && n.trim()) { renameRoute(r.id, n); renderRoutesPanel(); } });
    row.querySelector("[data-del]").addEventListener("click", () => { deleteRoute(r.id); renderRoutesPanel(); });
    list.appendChild(row);
  }
}
function toggleRoutesPanel(on) {
  const p = document.getElementById("routes-panel"); if (!p) return;
  const show = on == null ? p.classList.contains("hidden") : on;
  p.classList.toggle("hidden", !show);
  const b = document.getElementById("map-routes"); if (b) b.classList.toggle("on", show);
  if (show) renderRoutesPanel();
}
function hideRoutesPanel() { toggleRoutesPanel(false); }
function routeAdd(x, z, index) {
  const w = { x, z, alt: routeAlt(x, z), type: "nav", snap: null };
  if (index == null || index >= route.length) route.push(w); else route.splice(index, 0, w);
  saveRoute(); return w;
}
function routeMove(i, x, z) { const w = route[i]; if (w) { w.x = x; w.z = z; } }     // live drag, no save
function routeCommit() { saveRoute(); }
function routeDeleteAt(i) { if (route[i]) { route.splice(i, 1); if (routeIdx > route.length) routeIdx = route.length; saveRoute(); } }
function routeUpdate(i, patch) { if (route[i]) { Object.assign(route[i], patch); saveRoute(); } }
function routeSnap(i) {
  const w = route[i]; if (!w) return null;
  const sites = buildMapSites(); let best = null, bd = Infinity;
  for (const s of sites) { const d = Math.hypot(s.x - w.x, s.z - w.z); if (d < bd) { bd = d; best = s; } }
  if (best && bd < 6000) { w.x = best.x; w.z = best.z; w.snap = best.label; if (w.type === "nav") w.type = best.side === "friendly" ? "rtb" : "attack"; saveRoute(); }
  return best && bd < 6000 ? best.label : null;
}
function routeUndo() { route.pop(); if (routeIdx > route.length) routeIdx = route.length; saveRoute(); }
function routeClear() { route.length = 0; routeIdx = 0; saveRoute(); }

// A glowing world beam at the active waypoint, so it's findable in the air.
const routeBeam = (() => {
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 1400, 12, 1, true), beamMat);
  beam.position.y = 700; g.add(beam);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 3, 6, 28), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 4; g.add(ring);
  g.visible = false; scene.add(g);
  return { group: g, beamMat, ringMat, ring };
})();

const mapView = new MapView(document.getElementById("map-canvas"), {
  factionOf: factionIdByName,
  getFactions: () => factions,
  getSites: buildMapSites,
  getRoute: () => route,
  onRouteAdd: (x, z, index) => routeAdd(x, z, index),
  onRouteMove: (i, x, z) => routeMove(i, x, z),
  onRouteCommit: () => routeCommit(),
  onRouteDelete: (i) => routeDeleteAt(i),
  onRouteSnap: (i) => routeSnap(i),
  onSelectWaypoint: (i) => showWptInspector(i),
  onClose: () => { showWptInspector(null); if (preflight) cancelPreflight(); }, // Esc/✕ out of the planner → menu
  // Conquest ownership rings (only for a conquest plan / conquest flight).
  getNodes: () => {
    const isCq = preflight ? /^conquest/.test(preflight.mode) : gameMode === "conquest";
    return (isCq && conquestRun) ? conquestRun.nodes : null;
  },
  getSelected: () => (preflight ? (pfPick && pfPick.node != null ? pfPick.node : null) : (conquestRun && gameMode === "conquest" ? conquestRun.activeId : null)),
  // Air-start pick (free flight): drawn as the "you start here" plane marker.
  getStartMarker: () => ((preflight && pfPick && pfPick.kind === "air") ? { x: pfPick.x, z: pfPick.z } : null),
  // Pre-flight launch-point picking (runways + carriers).
  getLaunchPoints: () => {
    if (!preflight) return null;
    return preflight.spawns.map((s, i) => {
      const n = (conquestRun && s.node != null) ? conquestRun.node(s.node) : null;
      return { id: i, x: s.x, z: s.z, kind: s.kind, name: s.name, held: !!(n && n.owner === "player"), selected: s === pfPick };
    });
  },
  onPickLaunch: (id) => { pfPick = preflight ? preflight.spawns[id] : null; afterPfPick(); },
  onPickIsland: (name) => pickLaunchByIsland(name),
  onPickAir: (wx, wz) => { if (preflight && preflight.allowAir) { pfPick = { kind: "air", x: wx, z: wz, name: "Air start" }; afterPfPick(); } },
  onRouteUndo: () => routeUndo(),
  onRouteClear: () => routeClear(),
  getContacts: () => {                          // live bogeys on the nav map (in flight)
    if (!flying) return null;
    const out = [];
    for (const e of enemies.targets) if (e.alive) out.push({ x: e.position.x, z: e.position.z, hostile: true });
    return out;
  },
  getPlayer: () => {
    if (!flying || paused) return null;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion);
    const fl = Math.hypot(f.x, f.z) || 1;
    return { x: state.position.x, z: state.position.z, heading: Math.atan2(f.x / fl, -f.z / fl) };
  },
  onPlantCarrier: (wx, wz) => plantCarrier(wx, wz),
  getTargetIsland: () => targetIslandName,
  onPickTarget: (name) => setTargetIsland(name),
});
// Open the tactical map. Editable (route planning) only when NOT flying; in
// flight it's a read-only nav system, so the route tools are hidden.
function syncRouteBtn() {
  const mr = document.getElementById("map-route");
  if (mr) { mr.classList.toggle("on", mapView.routeMode); mr.textContent = mapView.routeMode ? "✓ DONE" : "◇ ROUTE"; }
  const mcr = document.getElementById("map-carrier");
  if (mcr) { mcr.classList.toggle("on", mapView.carrierMode); mcr.textContent = mapView.carrierMode ? "✓ DONE" : "⊟ CARRIER"; }
  const mt = document.getElementById("map-target");
  if (mt) { mt.classList.toggle("on", mapView.targetMode); mt.textContent = mapView.targetMode ? "✓ DONE" : "◎ TARGET"; }
}
function openMap() {
  mapView.editable = !flying;
  mapView.setPreflight(false); // normal tactical map — never the planner
  const bar = document.getElementById("preflight-bar"); if (bar) bar.classList.add("hidden");
  document.getElementById("mapview").classList.remove("planning");
  hideRoutesPanel();
  if (flying) { mapView.setRouteMode(false); mapView.setCarrierMode(false); showWptInspector(null); }
  // Route + carrier planning is pre-flight only; target designation stays usable
  // in flight (it's just a HUD flag, no world edits).
  const rt = document.getElementById("map-route"), rc = document.getElementById("map-route-clear"), mcr = document.getElementById("map-carrier");
  for (const el of [rt, rc, mcr]) if (el) el.style.display = flying ? "none" : "";
  syncRouteBtn();
  mapView.open();
}
{
  const mb = document.getElementById("btn-map");
  if (mb) mb.addEventListener("click", () => openMap());
  const mc = document.getElementById("map-close");
  if (mc) mc.addEventListener("click", () => mapView.close());
  const ml = document.getElementById("map-labels");
  if (ml) {
    ml.classList.toggle("on", mapView.labelsOn);
    ml.addEventListener("click", () => { mapView.setLabels(!mapView.labelsOn); ml.classList.toggle("on", mapView.labelsOn); });
  }
  const mr = document.getElementById("map-route");
  if (mr) mr.addEventListener("click", () => { mapView.setRouteMode(!mapView.routeMode); syncRouteBtn(); if (!mapView.routeMode) showWptInspector(null); });
  const mrc = document.getElementById("map-route-clear");
  if (mrc) mrc.addEventListener("click", () => { routeClear(); showWptInspector(null); mapView.draw(); });
  const mcr = document.getElementById("map-carrier");
  if (mcr) mcr.addEventListener("click", () => { mapView.setCarrierMode(!mapView.carrierMode); syncRouteBtn(); if (mapView.carrierMode) showWptInspector(null); });
  const mt = document.getElementById("map-target");
  if (mt) mt.addEventListener("click", () => { mapView.setTargetMode(!mapView.targetMode); syncRouteBtn(); if (mapView.targetMode) showWptInspector(null); });
  const mrt = document.getElementById("map-routes");
  if (mrt) mrt.addEventListener("click", () => toggleRoutesPanel());
  const rpClose = document.getElementById("rp-close");
  if (rpClose) rpClose.addEventListener("click", () => hideRoutesPanel());
  const rpNew = document.getElementById("rp-new");
  if (rpNew) rpNew.addEventListener("click", () => { addRoute(); renderRoutesPanel(); });
  const pfb = document.getElementById("pf-back");
  if (pfb) pfb.addEventListener("click", () => pfBack());
  const pfl = document.getElementById("pf-launch");
  if (pfl) pfl.addEventListener("click", () => pfLaunch());
  const ar = document.getElementById("auto-rearm");
  if (ar) { ar.checked = autoRearm; ar.addEventListener("change", () => setAutoRearm(ar.checked)); }
}

// Selected-waypoint inspector (type / altitude / snap / delete) on the map.
let wptSel = null;
function showWptInspector(i) {
  wptSel = (i == null || !route[i]) ? null : i;
  const panel = document.getElementById("wpt-inspector");
  if (!panel) return;
  if (wptSel == null) { panel.classList.add("hidden"); if (mapView) mapView.clearWptSel(); return; }
  const w = route[wptSel];
  document.getElementById("wi-num").textContent = String(wptSel + 1);
  const tb = document.getElementById("wi-types");
  tb.innerHTML = WPT_ORDER.map((t) => `<button data-t="${t}" class="${w.type === t ? "on" : ""}">${WPT_TYPES[t].label}</button>`).join("");
  tb.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { routeUpdate(wptSel, { type: b.dataset.t }); showWptInspector(wptSel); mapView.draw(); }));
  document.getElementById("wi-desc").textContent = wptType(w.type).desc;
  document.getElementById("wi-alt").textContent = Math.round(w.alt) + " m";
  document.getElementById("wi-snap").textContent = w.snap ? ("▸ " + w.snap) : "— not snapped —";
  mapView.setWptSel(wptSel);
  panel.classList.remove("hidden");
}
{
  const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  wire("wi-close", () => { showWptInspector(null); mapView.draw(); });
  wire("wi-alt-up", () => { if (wptSel != null) { routeUpdate(wptSel, { alt: route[wptSel].alt + 100 }); showWptInspector(wptSel); mapView.draw(); } });
  wire("wi-alt-dn", () => { if (wptSel != null) { routeUpdate(wptSel, { alt: Math.max(100, route[wptSel].alt - 100) }); showWptInspector(wptSel); mapView.draw(); } });
  wire("wi-snap-btn", () => { if (wptSel != null) { routeSnap(wptSel); showWptInspector(wptSel); mapView.draw(); } });
  wire("wi-del", () => { if (wptSel != null) { routeDeleteAt(wptSel); showWptInspector(null); mapView.draw(); } });
}

// Embedded accurate map for the Conquest planner: same renderer, with islands
// ringed by who holds them; clicking one picks it as your beachhead.
let cqSelectedNodeId = null, cqStartMarker = null;
const cqMap = new MapView(document.getElementById("cq-map"), {
  embedded: true,
  factionOf: factionIdByName,
  getFactions: () => factions,
  getSites: buildMapSites,
  getNodes: () => (conquestRun ? conquestRun.nodes : null),
  getSelected: () => cqSelectedNodeId,
  getStartMarker: () => cqStartMarker,
  onPick: (name) => ui.pickConquestIsland(name),
});

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
  else if (t === "fire" && m.kind === "flare" && m.p) {
    // Another pilot popped flares: show them and add decoys so OUR missiles
    // tracking that player can be lured off (the decoy runs on the shooter's side).
    const fp = _v.set(m.p[0], m.p[1], m.p[2]).clone();
    const away = (m.dir ? _v2.set(m.dir[0], m.dir[1], m.dir[2]) : _v2.set(0, 0, 1)).clone().multiplyScalar(120);
    for (let i = 0; i < 6; i++) fx.flare(fp, away);
    weapons.addFlares(fp);
  }
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
  // Pause (reset) and the vehicle bay (hangar) are remappable now — they're read
  // through input.getControls. Fullscreen / mute stay as fixed utility keys.
  if (e.code === "KeyF") toggleFullscreen();
  if (e.code === "KeyM") updateSoundButton(sound.toggleMute());
  if (e.code === "KeyO") { if (mapView.isOpen) mapView.close(); else openMap(); }
  if (e.code === "KeyP" && route.length) { routeOn = !routeOn; flashBanner(routeOn ? "ROUTE ON" : "ROUTE OFF", routeOn ? "Following the flight plan" : "Flight plan hidden", 1.6); }
  if (e.code === "KeyI" && flying && !paused) weapons.breakLock(); // break missile lock → next target
});

// Floating in-flight button to reopen the vehicle bay.
const hangarFab = document.getElementById("btn-hangar");
if (hangarFab) hangarFab.addEventListener("click", () => { if (flying && !hangarMode) enterHangar(true); });

// Ominous chiptune loops on the menu; it's silenced the moment you're flying.
function updateMenuMusic() {
  if (flying || inXR) sound.stopMenuMusic();
  else sound.startMenuMusic();
}

// Resume audio on the first user interaction (browser autoplay policy).
function unlockAudio() {
  sound.resume();
  updateMenuMusic(); // kick off menu music once we're allowed to make sound
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Soft chiptune blip on any menu/overlay button press.
document.addEventListener("pointerdown", (e) => {
  const t = e.target;
  if (t && t.closest && t.closest(".overlay") && t.closest("button")) sound.uiClick();
}, true);

// Mute toggle button on the menu.
const soundBtn = document.getElementById("btn-sound");
function updateSoundButton(muted) {
  if (soundBtn) { soundBtn.textContent = muted ? "🔇" : "🔊"; soundBtn.title = muted ? "Sound off" : "Sound on"; }
}
if (soundBtn) {
  updateSoundButton(sound.muted);
  soundBtn.addEventListener("click", () => { sound.resume(); updateSoundButton(sound.toggleMute()); });
}

// --- Radio comms: terse military callouts (text + chiptune "radio voice") ----
let commsOn = true;
try { commsOn = localStorage.getItem("rf.comms") !== "0"; } catch (_) { /* ignore */ }
function setComms(v) { commsOn = !!v; try { localStorage.setItem("rf.comms", commsOn ? "1" : "0"); } catch (_) { /* ignore */ } }
const commsEl = document.getElementById("comms");
let _commsAt = 0, _commsHideT = null;
const _commsLast = {};
// key gates repeats of the same call; cool = seconds before that key can repeat.
function comms(text, key, cool = 0) {
  if (!commsOn || !flying) return;
  const now = performance.now() / 1000;
  if (now - _commsAt < 0.45) return;                       // never stack transmissions
  if (key && cool && now - (_commsLast[key] || 0) < cool) return;
  if (key) _commsLast[key] = now;
  _commsAt = now;
  const syl = (text.match(/[aeiouy]+/gi) || []).length + 1; // rough syllable count → blip count
  sound.radio(Math.max(2, syl));
  if (commsEl) {
    commsEl.textContent = "▸ " + text;
    commsEl.classList.remove("hidden");
    void commsEl.offsetWidth;                              // restart the fade transition
    commsEl.classList.add("show");
    if (_commsHideT) clearTimeout(_commsHideT);
    _commsHideT = setTimeout(() => commsEl.classList.remove("show"), 2400);
  }
}
const commsChk = document.getElementById("comms-enable");
if (commsChk) { commsChk.checked = commsOn; commsChk.addEventListener("change", () => setComms(commsChk.checked)); }

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
  bombSightOn = false; // bomb sight is bomber-only; reset it on a new airframe (camera choice is kept)
  vtolMode = false; // start with nozzles aft
  touch.setVtol(false);
  if (mesh) scene.remove(mesh);
  mesh = buildAircraftMesh(type, null, liveryId, currentMarkings());
  scene.add(mesh);
}

// Rebuild the current aircraft in place after a paint/markings change — keeps
// position & orientation and re-frames it in the showroom when the bay is open.
function rebuildPlayerMesh() {
  if (!mesh) return;
  const keepRot = mesh.quaternion.clone();
  scene.remove(mesh);
  mesh = buildAircraftMesh(jetType, null, liveryId, currentMarkings());
  mesh.position.copy(state.position);
  mesh.quaternion.copy(keepRot);
  scene.add(mesh);
  if (hangarMode) measureHangarVehicle();
}
function setLivery(id) {
  liveryId = id;
  try { localStorage.setItem("rf.livery", id); } catch (_) { /* ignore */ }
  rebuildPlayerMesh();
}
function setInsignia(id) {
  insigniaId = id;
  try { localStorage.setItem("rf.insignia", id); } catch (_) { /* ignore */ }
  rebuildPlayerMesh();
}
function setTailNumber(n) {
  tailNumber = n;
  try { localStorage.setItem("rf.tailnum", String(n)); } catch (_) { /* ignore */ }
  rebuildPlayerMesh();
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

  // ---- Airfield lighting: floodlight masts, apron edge lights, runway lights.
  //      All emissive (no real lights) so they bloom warm at night, cheaply. ----
  const lampGeo = new THREE.SphereGeometry(0.9, 6, 5);
  const amber = new THREE.MeshStandardMaterial({ color: 0xffd79a, emissive: 0xffbf66, emissiveIntensity: 3.6, roughness: 0.4 });
  const whiteL = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe8c0, emissiveIntensity: 4.0, roughness: 0.4 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3236, flatShading: true, roughness: 0.8 });
  const lights = new THREE.Group();
  // Shared additive "light pool" disc cast on the ground (cloned per lamp).
  const poolGeo = new THREE.PlaneGeometry(2, 2); poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), color: 0xffdda0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pool = (x, z, gy, r) => { const m = new THREE.Mesh(poolGeo, poolMat); m.scale.set(r, r, r); m.position.set(x, gy + 0.5, z); m.renderOrder = 1; lights.add(m); };
  // Floodlight masts at the apron corners (pole + cross-bar + lamp heads + big pool).
  for (const [fx, fz] of [[bx - 80, bz - 160], [bx + 80, bz - 160], [bx - 80, bz + 160], [bx + 80, bz + 160]]) {
    const fgy = terrainHeight(fx, fz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 30, 6), poleMat); pole.position.set(fx, fgy + 15, fz); lights.add(pole);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 2), poleMat); bar.position.set(fx, fgy + 30, fz); lights.add(bar);
    for (const ox of [-4, 0, 4]) { const head = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2.4), whiteL); head.position.set(fx + ox, fgy + 29, fz + 1.2); lights.add(head); }
    pool(fx, bz, terrainHeight(fx, bz), 82); // washes the apron
  }
  // Apron edge lights down the two long kerbs.
  for (let zz = bz - 160; zz <= bz + 160; zz += 28) for (const xx of [bx - 85, bx + 85]) {
    const gy = terrainHeight(xx, zz); const d = new THREE.Mesh(lampGeo, amber); d.position.set(xx, gy + 1.2, zz); lights.add(d); pool(xx, zz, gy, 16);
  }
  // Runway edge lights + coloured thresholds (strip is 80 wide, 1200 long at the island origin).
  for (let zz = -560; zz <= 560; zz += 40) for (const xx of [-42, 42]) {
    const gy = terrainHeight(xx, zz); const d = new THREE.Mesh(lampGeo, whiteL); d.position.set(xx, gy + 0.8, zz); lights.add(d); pool(xx, zz, gy, 15);
  }
  for (const zz of [-600, 600]) for (let xx = -40; xx <= 40; xx += 10) {
    const d = new THREE.Mesh(lampGeo, amber); d.position.set(xx, terrainHeight(xx, zz) + 0.8, zz); lights.add(d);
  }
  scene.add(lights);
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
// Drop the player onto a conquest launch point (a runway or a carrier deck),
// in world coordinates straight from getIslandSpawns().
function placeAtSpawn(sp) {
  if (sp.kind === "carrier") {
    const deckY = SEA_LEVEL + 24;
    const halfL = sp.halfL || 330;
    state.position.set(sp.x, deckY + 1.5, sp.z + halfL - 30);
    state.velocity.set(0, 0, -60); // catapult kick
    input.kbThrottle = 0.7;
  } else { // runway / airfield
    state.position.set(sp.x, terrainHeight(sp.x, sp.z) + 1.5, sp.z);
    state.velocity.set(0, 0, 0);
    input.kbThrottle = 0;
  }
  state.quaternion.identity();
  state.onGround = true;
}

function placePlayer() {
  state = createState();
  flybyActive = false; flybyAnchor = null; // cancel any flyby on (re)spawn/teleport
  const cqSpawn = gameMode === "conquest" ? conquestSpawn : null;
  const launch = cqSpawn || (gameMode !== "conquest" ? pendingSpawn : null);
  if (launch && launch.kind === "air") {
    // Free-flight air start: fly in over the chosen point.
    state.position.set(launch.x, AIR_START_ALT, launch.z);
    state.velocity.set(0, 0, -180);
    state.quaternion.identity();
    input.kbThrottle = 0.7;
  } else if (launch) {
    placeAtSpawn(launch);
  } else if (startPos === "air" && spawnOverride) {
    // Campaign mission on a far island: drop in to its south, already flying in.
    state.position.set(spawnOverride.x, 1200, spawnOverride.z + 7000);
    state.velocity.set(0, 0, -180);
    input.kbThrottle = 0.7;
  } else if (startPos === "runway") {
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
  weapons.reset(def.loadout); // per-aircraft loadout (missiles / rockets / bombs)
  enemyOrdnance.reset();      // a fresh aircraft shouldn't inherit incoming fire
  camShake = 0;
  player.health = 100;
  crashHandled = false; respawnTimer = 0;
  // Gear down for ground/carrier starts, up for air starts; flaps up. Snap the
  // animation so it doesn't visibly deploy on spawn. Conquest always launches
  // from a runway or carrier, so it's a ground start.
  const groundStart = launch ? (launch.kind !== "air") : (startPos !== "air");
  gearDown = groundStart;
  flapsDown = false;
  gearAnim = gearDown ? 1 : 0;
  brakeActive = false; brakeAnim = 0;
  vtolMode = false;
  touch.setGearFlaps(gearDown, flapsDown);
  touch.setVtol(false);
  ui.hideBanner();
  // Require a deliberate throttle gesture before the sim runs.
  armActive = true;
  armUp = !groundStart;
  armInit = false;
  armHint = "";
}

// Reset the whole world for a fresh game (enemies, ground targets, rings, FX,
// wreckage), then place the player. Used when launching from the main menu.
function resetFlight() {
  ringsHit = 0;
  routeIdx = 0; // restart the flight plan from the first waypoint
  supply.consume(); supplyCd = 0; canReload = true; // fresh resupply state per sortie
  world.rings.forEach((r) => { r.visible = true; r.userData.hit = false; });
  const strike = gameMode === "mission" || gameMode === "campaign" || gameMode === "conquest";
  enemies.setMode(gameMode);
  ground.setActive(strike, world.carriers.enemy, getCarriers().find((c) => c.team === "enemy"));
  livesLeft = livesForMode();
  missionDone = false;
  spawnOverride = null;
  // Strike: build objectives from the spawned targets (only objective-relevant
  // targets get HUD-marked; tanks/bunkers stay ambient).
  if (gameMode === "mission") {
    missions.load(pendingMissionDef || defaultStrikeMission(ground), ground);
  } else if (gameMode === "campaign" && currentMission) {
    missions.load({ objectives: currentMission.objectives }, ground);
    const isl = (world.islands || []).find((i) => i.name === currentMission.island);
    if (isl) spawnOverride = { x: isl.center.x, z: isl.center.z };
    const d = currentMission.defense;
    if (d && d.fighters > 0) enemies.spawnDefenders(d.fighters, d.diff || 1, isl ? { x: isl.center.x, z: isl.center.z } : null);
  } else if (gameMode === "conquest" && conquestRun) {
    // Every island's strike targets are spawned; tag them to islands so we know
    // when one is cleared, and neutralise anything on islands you already hold.
    // Defenders aren't spawned yet — they scramble per island on approach.
    conquestRun.bindTargets(ground.targets);
    missions.active = false; missions.status = "idle";
  }
  pendingMissionDef = null;
  enemyOrdnance.reset();
  awareness.reset();
  factions = new Factions(getFactionConfig()); // pick up any live edits to allegiances
  seedIslandFactions(); // reset island allegiances to the world's starting state
  // In Conquest, islands you already hold fly your colours (drives the map +
  // keeps captured islands neutralised on a resumed campaign).
  if (gameMode === "conquest" && conquestRun) {
    for (const n of conquestRun.nodes) if (n.owner === "player") setIslandFaction(n.name, factions.playerFaction);
  }
  assignFactions(); // hand every defence its island's shared awareness state
  threatState = null;
  prevDestroyed = 0; prevKills = 0; wasOnGround = true;
  camShake = 0;
  fx.reset();
  wrecks.reset();
  placePlayer();
}

// Hand each ground defence + fighter the Faction of its nearest island, so a
// whole island shares one awareness/alert state. Strike modes only — dogfight
// and free flight leave enemies unmanaged (they behave as always-aware).
function assignFactions() {
  if (!(gameMode === "mission" || gameMode === "campaign" || gameMode === "conquest")) return;
  const islands = world.islands || [];
  if (!islands.length) return;
  const nearest = (x, z) => {
    let best = null, bd = Infinity;
    for (const is of islands) { const dx = x - is.center.x, dz = z - is.center.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = is; } }
    return best;
  };
  // Stance toward the player picks how an island's defences behave: hostile
  // islands hunt you, neutrals only fight back once provoked, friendlies hold.
  const modeFor = (s) => (s === "enemy" ? "hunt" : s === "neutral" ? "defend" : "hold");
  // Skip anything already dead/neutralised (e.g. a captured island's defences in
  // Conquest) so we don't spin up a phantom faction for friendly ground.
  const tag = (obj) => {
    if (!obj.alive) return;
    const pos = obj.position; const is = nearest(pos.x, pos.z);
    if (is) { const fid = factionOf(is); obj.factionId = fid; obj.faction = awareness.faction(is.name, is.center, modeFor(factions.vsPlayer(fid))); }
  };
  for (const t of ground.targets) tag(t);
  for (const e of enemies.targets) tag(e);
}

// The player just attacked something belonging to `factionId`. If that faction
// wasn't already hostile to us, it is now: flip its regard of the player to
// enemy (so the HUD turns it red and it stays hostile), and upgrade its islands
// from passive defence to active hunting with an immediate fix on us.
function provokeByPlayer(factionId) {
  if (!factionId) return;
  if (!factions.provoke(factionId, factions.playerFaction)) return; // already at war
  for (const is of (world.islands || [])) {
    if (factionOf(is) !== factionId) continue;
    const f = awareness.factions.get(is.name);
    if (f) { f.mode = "hunt"; f.spot(state.position); }
  }
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
  sound.stopMenuMusic(); // no menu music in flight
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
  hangarAngle = 0; hangarSpin = 0;
  placePlayer();                 // soft: park a fresh vehicle, world untouched
  gearDown = true; gearAnim = 1; flapsDown = false; // wheels down for the showroom
  measureHangarVehicle();        // frame the current vehicle in the showroom
  armActive = false;             // no throttle-gate prompt while choosing
  const fab = document.getElementById("btn-hangar");
  if (fab) fab.classList.add("hidden");
  touch.setVisible(false);
  ui.showHangar(jetType, !!canStay);
}
// Swap the previewed (rotating) vehicle without leaving the bay.
function previewVehicle(type) {
  setAircraft(type);
  measureHangarVehicle();
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
  sound.stopEngine(); sound.stopSeek(); sound.setBoost(0);
  if (net.status !== "offline") { net.disconnect(); clearRemotePlayers(); }
  ui.showMenu();
  sound.startMenuMusic(); // back to the brooding menu loop
}

// --- Camera positioning per mode ---
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector4(); // clip-space projection (keeps w for stable HUD edge markers)
const _lookE = new THREE.Euler(0, 0, 0, "YXZ");
const freeLook = { yaw: 0, pitch: 0 };  // smoothed POV-hat look offset
const lookInput = { x: 0, y: 0 };       // raw hat input this frame

function updateCamera(dt) {
  // Ease the free-look toward the hat input (orbit the view to check your six).
  freeLook.yaw += (lookInput.x * 2.6 - freeLook.yaw) * Math.min(1, dt * 9);
  freeLook.pitch += (lookInput.y * 0.7 - freeLook.pitch) * Math.min(1, dt * 9);
  _lookE.set(freeLook.pitch, freeLook.yaw, 0, "YXZ");
  const mode = bombSightActive() ? "Bomb Sight" : currentCam();
  const pos = state.position;
  const q = state.quaternion;
  bombMarker.visible = false; // only shown in Bomb Sight (set below)

  // Vehicle bay showroom: a centred 3/4 view auto-framed to the vehicle's size,
  // which rotates in place (the spin is applied to the mesh in the sync block).
  // The model is centred head-on between the flanking info / armament panels.
  if (hangarMode) {
    hangarSpin += dt * 0.5; // medium rotation
    const r = hangarRadius;
    camera.position.set(pos.x + r * 0.45, pos.y + r * 0.95, pos.z - r * 2.7);
    camera.up.set(0, 1, 0);
    camera.lookAt(pos.x, pos.y + r * 0.08, pos.z);
    camera.fov += (42 - camera.fov) * Math.min(1, dt * 3);
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
    // Slow dolly-back: distance + height grow as the death-cam plays out.
    const elapsed = Math.max(0, CRASH_CAM_TIME - respawnTimer);
    const dist = 70 + elapsed * 40;
    const high = 32 + elapsed * 18;
    const behind = _v.copy(pos).addScaledVector(_v2, dist);
    behind.y = Math.max(pos.y, gy0) + high;
    camPos.lerp(behind, Math.min(1, dt * 1.6)); // ease toward the receding target
    if (camPos.lengthSq() === 0) camPos.copy(behind);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.fov += (60 - camera.fov) * Math.min(1, dt * 2);
    camera.updateProjectionMatrix();
    camera.lookAt(pos.x, (pos.y + gy0) * 0.5 + 6, pos.z);
    return;
  }

  // Speed-driven FOV kick for a sense of velocity (afterburner punches it wider).
  const targetFov = 70 + THREE.MathUtils.clamp((state.velocity.length() - 140) * 0.06, 0, 18) + boostFx * BOOST_FOV;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();

  // Flyby (one-shot): a fixed point far ahead on the path; you streak past it and
  // it hands control back to your normal view. Overrides every other mode.
  if (flybyActive) {
    flybyT += dt;
    camera.position.copy(flybyAnchor); // world-locked
    camera.up.set(0, 1, 0);
    camTarget.lerp(pos, 1 - Math.pow(0.0009, dt));
    camera.lookAt(camTarget);
    if (_v.copy(pos).sub(flybyAnchor).dot(_flyFwd) > 30 || flybyT > 6) flybyActive = false; // passed it / timed out
    return;
  }

  // Bombardier sight: the jet keeps flying while you look down at the ground and
  // a reticle marks where a bomb dropped now would hit. Steer to walk it onto
  // the target, then drop with N / the BOMB button.
  if (mode === "Bomb Sight") {
    const hit = weapons.predictBomb(pos, state.velocity, _bombHit);
    if (hit) { bombMarker.position.copy(hit); bombMarker.position.y += 1.0; bombMarker.visible = true; }
    // High and a little behind, angled down so the jet sits up-frame and the
    // impact zone is below it. Look between the jet and the predicted impact.
    _v2.set(0, 0, -1).applyQuaternion(q); _v2.y = 0;
    const fl = Math.hypot(_v2.x, _v2.z) || 1; _v2.x /= fl; _v2.z /= fl; // horizontal heading
    const behind = _v.copy(pos).addScaledVector(_v2, -26); behind.y = pos.y + 70;
    const lerp = 1 - Math.pow(0.0015, dt);
    camPos.lerp(behind, lerp);
    if (camPos.lengthSq() === 0) camPos.copy(behind);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    if (hit) camTarget.lerp(_v3.set((pos.x + hit.x) / 2, (pos.y + hit.y) / 2 - 10, (pos.z + hit.z) / 2), 0.25);
    else camTarget.copy(pos).addScaledVector(_v2, 200).setY(pos.y - 120);
    camera.lookAt(camTarget);
    return;
  }

  if (mode === "Cockpit") {
    const eye = _v.set(0, 0.5, -1.5).applyQuaternion(q).add(pos);
    camera.position.copy(eye);
    // Hat turns your head: rotate the look direction by the free-look offset.
    const look = _v2.set(0, 0.3, -20).applyEuler(_lookE).applyQuaternion(q).add(pos);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    camera.lookAt(look);
    return;
  }

  // Rear View: a little above and in front, looking back down over the tail —
  // so you can watch your bombs / rockets land behind you after a pass.
  if (mode === "Rear View") {
    // Rigid (no smoothing) so a fast jet doesn't make it shudder: park the
    // camera a little above and ahead, looking back and down over the tail.
    _v2.set(0, 0, -1).applyQuaternion(q); // jet forward
    camPos.copy(pos).addScaledVector(_v2, 16); camPos.y += 7;
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camTarget.copy(pos).addScaledVector(_v2, -55); camTarget.y -= 26;
    camera.lookAt(camTarget);
    return;
  }

  // Chase / Far Chase. Both follow with a little lag (they're NOT glued to the
  // jet) so you have to catch up coming out of turns. Far Chase sits back more.
  const isFar = mode === "Far Chase";
  const dist = isFar ? 24 : 4.5;   // close chase pulled in to half distance
  const height = isFar ? 8 : 1.6;
  // Free-look orbits the camera around the jet (so you can look to the sides /
  // behind). With the hat centred this is exactly the normal chase view.
  const behind = _v.set(0, height, dist).applyEuler(_lookE).applyQuaternion(q).add(pos);
  const lerp = 1 - Math.pow(isFar ? 0.0008 : 0.0019, dt); // close chase lags a touch → you catch up on turns
  camPos.lerp(behind, lerp);
  if (camPos.lengthSq() === 0) camPos.copy(behind);
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  // Look ahead normally; pan toward the jet itself as you swing the view around.
  const la = Math.min(1, (Math.abs(freeLook.yaw) + Math.abs(freeLook.pitch)) / 1.2);
  camTarget.copy(pos).addScaledVector(_v2.set(0, 0, -1).applyQuaternion(q), 30 * (1 - la));
  camTarget.y += 4 * (1 - la);
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
  c.textAlign = "right";
  const ow = weapons.missileCount ? "MSL " + weapons.missileCount : weapons.rocketCount ? "RKT " + weapons.rocketCount : weapons.bombCount ? "BMB " + weapons.bombCount : "GUN";
  c.fillStyle = green;
  c.fillText(ow, 494, 210);

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
      sound.ring();
    }
  }
}

// --- Fixed-timestep loop ---
const PHYS_DT = 1 / 120;
let acc = 0;
let last = performance.now();

// Damage smoke / fire: any alive thing under ~55% health trails smoke (a rising
// dynamic source fed to the Smokestacks system); below ~30% it also burns with
// flame licks. `_dmgObj` wraps the player (whose position is a tail offset).
const _dmgTmp = new THREE.Vector3();
const _dmgWrap = { position: null, alive: true, health: 0, maxHealth: 100 };
function _dmgObj(pos, health, maxHealth) { _dmgWrap.position = pos; _dmgWrap.health = health; _dmgWrap.maxHealth = maxHealth; return _dmgWrap; }
function damageFx(obj, dyn) {
  if (!obj || obj.alive === false || obj.maxHealth == null || obj.maxHealth <= 1 || !obj.position) return;
  const frac = obj.health / obj.maxHealth;
  if (frac >= 0.55) return;
  const sev = Math.min(1, (0.55 - frac) / 0.55); // 0..1, how badly hurt
  const p = obj.position;
  dyn.push({
    x: p.x, y: p.y + 1.5, z: p.z,
    size: 2.5 + sev * 6, rate: 5 + sev * 12,
    color: frac < 0.28 ? 0x161616 : 0x4a4a4a, // darker the worse it gets
    rise: 16, drift: 6, life: 1.5, grow: 3.4, wind: 4,
  });
  if (frac < 0.3 && Math.random() < 0.5) fx.ember(_dmgTmp.copy(p).setY(p.y + 1), 1 + sev); // on fire
}

function frame(now) {
  routeBeam.group.visible = false; // shown only while a route is being flown
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab-out
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) ui.hideBanner(); }
  const simDt = paused ? 0 : dt; // freeze the world while the pause menu is open

  // World editor takes over rendering with its top-down camera. The ocean still
  // follows so coasts read right; clouds are hidden (no geometry over the map).
  if (editor.active) { updateSky(editor.cam, false); weather.update(dt, _skyPos); editor.render(); return; }

  const controls = inXR ? getXRControls(dt) : input.getControls(dt);
  // POV-hat free-look (only while actively flying, not in the bay / paused).
  const lk = (flying && !hangarMode && !paused && controls.look) ? controls.look : null;
  lookInput.x = lk ? lk.x : 0; lookInput.y = lk ? lk.y : 0;

  // Live monitor for the settings panel
  ui.updateMonitors();

  // Hide on-screen touch controls whenever a gamepad (Steam Deck / Xbox) is live.
  if (flying) {
    const pad = input.hasGamepad();
    if (pad !== lastPad) { lastPad = pad; touch.setVisible(!pad); }
  }

  // Vehicle bay / pause from the joystick (Back/Select & Start).
  if (flying && !inXR && controls.hangarPressed) { hangarMode ? exitHangar() : enterHangar(true); }
  if (controls.pausePressed) {
    if (mapView.isOpen) {
      const rp = document.getElementById("routes-panel");
      if (rp && !rp.classList.contains("hidden")) { hideRoutesPanel(); } // first Esc closes the plans panel
      else if (mapView.carrierMode) { mapView.setCarrierMode(false); syncRouteBtn(); } // first Esc leaves carrier-plant mode
      else if (mapView.targetMode) { mapView.setTargetMode(false); syncRouteBtn(); } // first Esc leaves target-pick mode
      else if (mapView.routeMode) { mapView.setRouteMode(false); syncRouteBtn(); showWptInspector(null); } // first Esc leaves route mode
      else mapView.close();
    } else if (flying) openPause();
  }

  // Throttle-arming gate: hold the sim until the player engages the throttle.
  if (flying && !hangarMode && !paused && !state.crashed && armActive) updateArming(controls);

  boostActive = false; // set true below only while actively boosting this frame
  if (flying && !hangarMode && !paused && !state.crashed && !armActive) {
    if (controls.viewPressed) setCamIndex(camIndex + 1);
    if (controls.bombsightPressed && def.loadout && def.loadout.bombs > 0) bombSightOn = !bombSightOn; // bomber-only sight toggle
    if (controls.flybyPressed) triggerFlyby();            // one-shot cinematic flyby
    if (controls.radarPressed) setRadarOff(!radarOff);    // pure-flight: hide target/enemy markers + radar
    if (controls.hudPressed) setHudOff(!hudOff);          // blank the whole HUD
    if (controls.approachPressed) approachOn = approach.toggle(state); // landing-approach guidance

    // Gear + flaps are manual now (G / V keys, or on-screen GEAR / FLAPS).
    if (controls.gearPressed) { gearDown = !gearDown; sound.gear(gearDown); comms(gearDown ? "Gear down" : "Gear up", "gear", 0.8); }
    if (controls.flapsPressed) { flapsDown = !flapsDown; sound.flaps(flapsDown); }
    if (controls.gearPressed || controls.flapsPressed) touch.setGearFlaps(gearDown, flapsDown);
    controls.gear = gearDown;
    controls.flaps = flapsDown;
    // Harrier: T / D-pad-down / VTOL button vectors the nozzles down for hover.
    if (def.vtol && controls.vtolPressed) { vtolMode = !vtolMode; touch.setVtol(vtolMode); sound.vtol(vtolMode); }
    controls.vtol = def.vtol ? vtolMode : false;
    if (controls.brake && !brakeActive) sound.brake(); // whoosh as the speedbrake pops
    brakeActive = !!controls.brake; // airbrake (air) / wheel brake (ground)

    // Afterburner: only on turbo jets, only at the firewall (full throttle).
    // controls.boost arrives as a held boolean; convert it to the thrust
    // multiplier the physics reads (1 = off, BOOST_THRUST = lit).
    const boostWas = boostActive;
    boostActive = !!controls.boost && !!def.turbo && controls.throttle >= 0.98;
    controls.boost = boostActive ? BOOST_THRUST : 1;
    if (boostActive && !boostWas) comms("Burner", "boost", 2);
    if (boostActive && !state.onGround) addShake(dt * 9); // high-speed buffet while lit

    acc += dt;
    let steps = 0;
    while (acc >= PHYS_DT && steps < 8) {
      const gh = groundHeightAt(state.position.x, state.position.z);
      step(state, def, controls, PHYS_DT, gh);
      acc -= PHYS_DT;
      steps++;
    }
    checkRings();

    // Crash if we fly into a building — or into a ship / train / the zeppelin —
    // or ram a ground emplacement or an enemy jet (which then takes the hit).
    if (!state.crashed) {
      const px = state.position.x, py = state.position.y, pz = state.position.z;
      for (const b of world.colliders) {
        if (py < b.top + 2 && Math.abs(px - b.x) < b.hx + 6 && Math.abs(pz - b.z) < b.hz + 6) {
          state.crashed = true;
          break;
        }
      }
      if (!state.crashed && traffic.collides(state.position)) state.crashed = true;
      // Ground targets (skip the landable carrier + the huge power plant footprint).
      if (!state.crashed) for (const t of ground.targets) {
        if (!t.alive || t.info || t.type === "powerplant") continue;
        const r = Math.min(t.radius || 24, 26) + 4;
        if (Math.abs(px - t.position.x) < r && Math.abs(pz - t.position.z) < r && Math.abs(py - t.position.y) < 40) { state.crashed = true; break; }
      }
      // Enemy jets — a mid-air collision downs you both.
      if (!state.crashed) for (const e of enemies.targets) {
        if (e.alive && state.position.distanceTo(e.position) < (e.radius || 30) + 4) { state.crashed = true; break; }
      }
    }

    const isMission = gameMode === "mission" || gameMode === "campaign" || gameMode === "conquest"; // strike modes
    // Mode targets + the always-on traffic (train/ships/zeppelin) the player can
    // also engage. weapons.fire's first valid target in the list wins, so put
    // the mode targets first and append traffic.
    const baseTargets = gameMode === "ffa" ? netTargets
      : (gameMode === "campaign" || gameMode === "conquest") ? ground.targets.concat(enemies.targets) // strike targets + defenders
      : isMission ? ground.targets
      : enemies.targets;
    const activeTargets = baseTargets.concat(traffic.targets);
    if (supply.active) activeTargets.push(supply.active); // gun/missile-lockable resupply
    // No weapons while the afterburner is lit — it's pure high-speed travel.
    if (!boostActive) {
      if (controls.fire && weapons.fire(state.position, state.quaternion, activeTargets)) sound.gun();
      if (controls.missilePressed && weapons.fireMissile(state.position, state.quaternion, state.velocity)) { sound.missile(); comms("Fox two", "msl", 0.7); }
      if (controls.rocketPressed && weapons.fireRocket(state.position, state.quaternion, state.velocity)) { sound.missile(); comms("Rifle", "rkt", 0.7); }
      if (controls.bombPressed && weapons.dropBomb(state.position, state.quaternion, state.velocity)) { sound.bomb(); comms("Bombs away", "bomb", 0.9); }
    }
    weapons.update(dt, state.position, state.quaternion, activeTargets);
    updateResupply(dt);
    enemies.update(dt, player);
    if (enemies.waveMsg) { flashBanner(enemies.waveMsg, enemies.wave === 1 ? "Bandits inbound — good hunting" : "Here they come again", 2.6); comms("Bandits, bandits", "wave", 3); enemies.waveMsg = null; }
    traffic.update(dt, player);
    if (isMission) ground.update(dt, player);
    enemyOrdnance.update(dt, player); // fly/guide enemy missiles & rockets vs. the player

    // Comms callouts driven by tallies + airborne state.
    if (gameMode !== "ffa") {
      const gd = isMission ? ground.destroyed : 0;
      if (gd > prevDestroyed) comms("Target down", "kill", 1.2);
      prevDestroyed = gd;
      if (enemies.kills > prevKills) comms("Splash one", "kill", 1.2);
      prevKills = enemies.kills;
    }
    const og = state.onGround;
    if (!og && wasOnGround && state.telemetry.speed > 70) comms("Airborne", "to", 4);
    else if (og && !wasOnGround && state.telemetry.speed < 90) comms("On the deck", "land", 4);
    wasOnGround = og;

    // Enemy awareness (strike modes): each island detects you from your altitude,
    // proximity and — much faster — your own gunfire/hits, and shares the alert
    // across all its defences. Surface the transitions so you can read the state.
    if (isMission) {
      const firing = !!(controls.fire || controls.missilePressed || controls.rocketPressed || controls.bombPressed);
      awareness.update(dt, player, { firing });
      const near = awareness.nearest(state.position);
      threatState = near && near.alerted ? near.state : null;
      for (const f of awareness.factions.values()) {
        const ev = f.consumeEvent();
        if (ev && f === near) {
          if (ev === "spotted") { flashBanner("DETECTED", "Defenses are hot — they have your position", 2.8); comms("We're lit up", "det", 4); }
          else if (ev === "evaded") { flashBanner("CONTACT LOST", "They're hunting you — stay dark and break clean", 2.8); comms("We're clear", "det", 4); }
          else if (ev === "clear") flashBanner("STOOD DOWN", "You're a ghost again — clean approach", 2.6);
        }
      }
    }
    fx.update(dt);
    sound.updateEngine(state.telemetry.throttle, state.telemetry.speed);

    // Eject countermeasure flares.
    if (controls.flarePressed) {
      _v.set(0, 0, 1).applyQuaternion(state.quaternion);
      const away = _v.clone().multiplyScalar(Math.max(50, state.velocity.length()));
      const tail = state.position.clone().addScaledVector(_v, 6);
      for (let i = 0; i < 6; i++) fx.flare(tail, away);
      sound.flare();
      comms("Flares, flares", "flr", 1.2);
      enemyOrdnance.addFlares(state.position); // decoy incoming enemy seekers
      // In multiplayer, tell other pilots so their missiles tracking us can be
      // lured off (decoy logic runs on the shooter's machine).
      if (gameMode === "ffa" && net.connected) net.sendFire("flare", state.position, _v);
    }

    if (isMission) missions.update(dt, player, state);
    if (gameMode === "conquest") updateConquest();

    // Lock audio: a growl that ramps while a target sits in the box, then a
    // confirmation chirp the moment it goes solid.
    if (weapons.lock && !weapons.locked) { sound.startSeek(); sound.updateSeek(weapons.lockProgress); }
    else sound.stopSeek();
    if (weapons.locked && !lastLocked) sound.lock();
    lastLocked = weapons.locked;

    if (state.crashed) handleCrash("AIRCRAFT DOWN");
  } else if (flying && state.crashed && !paused) {
    // The world carries on while the death-cam plays out — the battle doesn't
    // freeze just because your jet went down.
    sound.stopSeek();
    const cm = gameMode === "mission" || gameMode === "campaign" || gameMode === "conquest";
    const tlist = (gameMode === "ffa" ? netTargets
      : cm ? ground.targets.concat(enemies.targets) : enemies.targets).concat(traffic.targets);
    weapons.update(dt, state.position, state.quaternion, tlist); // in-flight ordnance keeps flying
    enemies.update(dt, player);
    traffic.update(dt, player);
    if (cm) ground.update(dt, player);
    enemyOrdnance.update(dt, player);
    if (cm) awareness.update(dt, player, { firing: false });
    fx.update(dt);
    if (respawnTimer > 0) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        if (livesLeft !== Infinity && livesLeft > 0) livesLeft--;
        if (livesLeft > 0) {
          if (inXR) placePlayer();
          else if (gameMode === "conquest") openConquestRespawn(); // pick a captured runway/carrier
          else enterHangar(false);
        }
        else { outOfLives(); }
      }
    }
  }

  // Sync mesh to physics state
  if (mesh) {
    if (hangarMode) {
      // Showroom: park the model at the spawn pivot and spin it in place.
      mesh.position.copy(state.position);
      mesh.rotation.set(0, hangarSpin, 0);
    } else {
      mesh.position.copy(state.position);
      mesh.quaternion.copy(state.quaternion);
    }
    mesh.visible = hangarMode ? true : (!state.crashed && (inXR ? false : activeCamName() !== "Cockpit")); // gone on crash; hidden in VR cockpit
    const flames = mesh.userData.flames;
    if (flames) {
      const t = state.telemetry.throttle;
      const op = t > 0.6 ? (t - 0.6) / 0.4 * 0.8 : 0;
      for (const fl of flames) {
        fl.material.opacity = op;
        fl.scale.setScalar((fl.userData.base || 1) * (0.6 + t * 0.8));
      }
    }
    // Afterburner cones: flare out + flicker, scaling longer aft, while lit.
    const bf = mesh.userData.boostFlames;
    if (bf && bf.length) {
      const fk = 0.85 + Math.random() * 0.3; // flame flicker
      for (let i = 0; i < bf.length; i++) {
        const fl = bf[i], b = fl.userData.base || 1;
        fl.material.opacity = boostFx * (i % 2 ? 0.9 : 0.6) * fk;
        // Wider lateral flare + a longer trail aft as it builds.
        fl.scale.set(b * (0.7 + boostFx * 0.9) * fk, b * (0.7 + boostFx * 0.9) * fk, b * (0.7 + boostFx * 1.5));
      }
    }
    // Gear extends/retracts smoothly (legs telescope out of the belly); flaps
    // swing down. Both ease toward the manual gear/flaps state.
    gearAnim += ((gearDown ? 1 : 0) - gearAnim) * Math.min(1, dt * 3.5);
    if (mesh.userData.gear) {
      const gr = mesh.userData.gear, bs = gr.userData.base || 1;
      gr.visible = gearAnim > 0.02;
      gr.scale.set(bs, Math.max(0.0001, bs * gearAnim), bs); // keep the base size while it deploys
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
  // Apply + decay camera shake (skip VR — jolting the headset is nauseating).
  if (camShake > 0.001 && !inXR) {
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
    camera.position.z += (Math.random() - 0.5) * camShake;
    camShake *= Math.pow(0.0009, dt); // fast decay (~halves every ~0.1s)
  } else camShake = 0;
  // Afterburner visuals: ease the amount, warp the world (post-FX), streak the
  // air past the camera. boostFx decays whenever the burner isn't lit.
  boostFx += ((boostActive ? 1 : 0) - boostFx) * Math.min(1, dt * 5);
  if (boostFx < 0.002) boostFx = boostActive ? boostFx : 0;
  post.setSpeed(boostFx);
  sound.setBoost(flying && !paused ? boostFx : 0); // staticy afterburner roar
  updateSpeedLines(dt, boostFx);
  updateSky(camera, true); // ocean + clouds follow the active camera
  weather.update(simDt, _skyPos); // stars/rain follow the camera; storm lightning
  if (post.enabled) post.setBloomScale(THREE.MathUtils.lerp(1.0, 0.5, weather.daylight || 0)); // tame daytime bloom
  ground.night = weatherMode === "night" || weatherMode === "storm" || (weather.autoCycle && (weather.daylight || 0) < 0.25); // gate searchlights to darkness (incl. the cycle's night)
  if (world.spinners) for (const s of world.spinners) s.obj.rotation.y += dt * s.speed; // lighthouse beacons sweep
  // Smoke plumes: scenery sources + any still-alive power-plant strike targets.
  const dyn = smoke.dynamic; dyn.length = 0;
  for (const t of ground.targets) if (t.alive && t.smokeStacks) for (const s of t.smokeStacks) dyn.push(s);
  // Damage smoke + fire: anything alive and hurt trails smoke (and burns badly).
  if (flying && !paused && !hangarMode) {
    if (!state.crashed && player.health < 55) {
      _v.set(0, 0, 1).applyQuaternion(state.quaternion).multiplyScalar(4).add(state.position);
      damageFx(_dmgObj(_v, player.health, 100), dyn);
    }
    for (const e of enemies.targets) damageFx(e, dyn);
    for (const t of ground.targets) damageFx(t, dyn);
    for (const t of traffic.targets) damageFx(t, dyn);
    if (gameMode === "ffa") for (const [id, mesh] of netMeshes) { // hurt opponents smoke too
      const pl = net.players.get(id);
      if (pl && pl.alive !== false && pl.health < 55) damageFx(_dmgObj(mesh.position, pl.health, 100), dyn);
    }
  }
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
  if (flying && !hangarMode && !hudOff) {
    // Shared world→screen projection for HUD markers (objectives, approach, …).
    // Project a world point to the HUD. Works in CLIP space (keeps w) so the
    // off-screen edge direction stays stable even as a target crosses the camera
    // plane — `dirx/diry` are the clip x/y, sign-flipped when behind, and never
    // blow up the way perspective-divided NDC does.
    const projectHud = (vec) => {
      _v4.set(vec.x, vec.y, vec.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      const w = _v4.w;
      const inv = 1 / (Math.abs(w) < 1e-6 ? (w < 0 ? -1e-6 : 1e-6) : w);
      const ndcx = _v4.x * inv, ndcy = _v4.y * inv;
      const s = w < 0 ? -1 : 1; // behind the camera: flip so the arrow points the right way
      return {
        x: (ndcx * 0.5 + 0.5) * hud.w, y: (-ndcy * 0.5 + 0.5) * hud.h,
        dirx: _v4.x * s, diry: _v4.y * s,
        behind: w < 0,
        // On-screen test ignores depth: a nav marker for an island past the camera
        // far plane is still "ahead and in frame" and should pin to it, not the edge.
        onscreen: w > 0 && Math.abs(ndcx) <= 1 && Math.abs(ndcy) <= 1,
      };
    };
    // Project the locked target to screen space for the lock box.
    let lock = null;
    if (weapons.lock && weapons.lock.alive) {
      const pr = projectHud(weapons.lock.position);
      if (!pr.behind) {
        lock = {
          x: pr.x, y: pr.y,
          dist: state.position.distanceTo(weapons.lock.position),
          progress: weapons.lockProgress,
          locked: weapons.locked,
        };
      }
    }
    // Objective checklist (the in-world targets are drawn as the yellow objective
    // contacts below — no separate nearest-objective marker, to avoid double-yellow).
    let objectives = null;
    const isMissionHud = gameMode === "mission" || gameMode === "campaign" || gameMode === "conquest";
    if (isMissionHud) objectives = missions.hudData(projectHud, state.position).objectives;
    // Nav markers to other islands (so the open ocean isn't a void).
    let islandMarkers = null;
    if (world.islands && world.islands.length > 1) {
      islandMarkers = [];
      for (const isl of world.islands) {
        const dx = state.position.x - isl.center.x, dz = state.position.z - isl.center.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9000) continue; // don't mark the island you're over
        const pr = projectHud(_v.set(isl.center.x, SEA_LEVEL + 1500, isl.center.z));
        const fid = factionOf(isl);
        const fdef = factions.get(fid);
        islandMarkers.push({ name: isl.name, faction: fid, stance: factions.vsPlayer(fid), emblem: fdef && fdef.emblem, factionColor: fdef ? fdef.color : 0xcbd5e0, dist, isTarget: isl.name === targetIslandName, ...pr });
      }
    }
    // Air contacts: mark every aircraft (enemy jets, drones, other players) on
    // the HUD and a radar scope — easy to find/track/target, esp. in MP.
    let netStatus = null, objCount = 0;
    const contacts = [];
    const radar = { range: 6000, blips: [] };
    _v.set(0, 0, -1).applyQuaternion(state.quaternion);
    const _fl = Math.hypot(_v.x, _v.z) || 1;
    const fwdX = _v.x / _fl, fwdZ = _v.z / _fl, rgtX = -fwdZ, rgtZ = fwdX; // heading basis (XZ)
    const addContact = (pos, opts) => {
      const dx = pos.x - state.position.x, dz = pos.z - state.position.z;
      const dist = Math.hypot(dx, dz);
      _v.copy(pos); _v.y += 12;
      const pr = projectHud(_v);
      contacts.push({ color: opts.color, kind: opts.kind || "air", name: opts.name, health: opts.health, dist, ...pr });
      radar.blips.push({
        nx: THREE.MathUtils.clamp((dx * rgtX + dz * rgtZ) / radar.range, -1, 1),
        ny: THREE.MathUtils.clamp((dx * fwdX + dz * fwdZ) / radar.range, -1, 1),
        far: dist > radar.range, color: opts.color, kind: opts.kind || "air",
      });
    };
    // Per-type marker colours: neutral traffic = amber, enemy air = red, enemy
    // ground = orange, friendly = green, MP = each player's hue.
    for (const t of traffic.targets) if (t.alive && t.lockable !== false) addContact(t.position, { color: "#ffc23c", kind: "traffic" });
    if (gameMode === "dogfight" || gameMode === "practice") {
      for (const t of enemies.targets) if (t.alive) addContact(t.position, { color: "#ff5b5b", kind: "air" });
    } else if (gameMode === "ffa") {
      netStatus = net.status === "online" ? `LAN  ·  ${net.count() + 1} pilots` :
        net.status === "connecting" ? "Connecting…" :
        net.status === "error" ? "No server (run the LAN server)" : "Offline";
      for (const [id, m] of netMeshes) {
        const p = net.players.get(id);
        if (!p || p.alive === false) continue;
        addContact(m.position, { color: "#" + playerColor(id).toString(16).padStart(6, "0"), kind: "air", name: p.name, health: p.health });
      }
    } else if (isMissionHud) {
      // Strike modes: enemy fighters (red diamonds) + the must-destroy targets
      // (yellow target boxes). In Conquest only the island you're assaulting is
      // marked, so it's clear what to hit to capture it. Ambient AA/searchlights
      // stay off the scope to avoid clutter.
      for (const e of enemies.targets) if (e.alive) addContact(e.position, { color: "#ff5b5b", kind: "air" });
      const activeId = (gameMode === "conquest" && conquestRun) ? conquestRun.activeId : null;
      for (const t of ground.targets) {
        if (!t.alive || t.ambient) continue;            // essential (objective) targets only
        if (gameMode === "conquest" && t._node !== activeId) continue; // just the island under assault
        addContact(t.position, { color: "#ffe14a", kind: "objective", name: t.info ? "CARRIER" : (OBJ_LABEL[t.type] || "TGT") });
        objCount++;
      }
    }
    // Highlight the nearest objective as the current focus (pulses + the only one
    // with an off-screen arrow).
    let focusObj = null;
    for (const c of contacts) if (c.kind === "objective" && (!focusObj || c.dist < focusObj.dist)) focusObj = c;
    if (focusObj) focusObj.focus = true;
    // Landing-approach guidance (gates/ILS/cues). Survives "pure flight" since
    // it's a navigation aid you deliberately turn on; hidden only when the whole
    // HUD is off (this block already gates on !hudOff).
    let approachHud = null;
    if (approachOn) {
      approachHud = approach.update(state, {
        gearDown, flapsDown, speedKts: state.telemetry.speed * 1.94384, project: projectHud,
      });
    }

    // Flight-plan route: project each waypoint, auto-advance as you reach them.
    let supplyHud = null;
    if (supply.active) { const pr = projectHud(supply.active.position); supplyHud = { ...pr, dist: state.position.distanceTo(supply.active.position) }; }
    let routeHud = null;
    if (route.length && routeOn) {
      while (routeIdx < route.length) {
        const w = route[routeIdx];
        if (Math.hypot(state.position.x - w.x, state.position.z - w.z) < ROUTE_REACH) routeIdx++; else break;
      }
      const wps = route.map((w, i) => ({ idx: i + 1, done: i < routeIdx, next: i === routeIdx, type: w.type, ...projectHud(_v.set(w.x, w.alt, w.z)) }));
      let next = null;
      if (routeIdx < route.length) {
        const w = route[routeIdx], ty = wptType(w.type);
        next = { idx: routeIdx + 1, dist: Math.hypot(state.position.x - w.x, state.position.z - w.z), type: w.type, label: ty.label, attack: w.type === "attack", snap: w.snap, alt: Math.round(w.alt) };
        // Drive the world beam to the active waypoint.
        const gy = Math.max(terrainHeight(w.x, w.z), SEA_LEVEL);
        routeBeam.group.position.set(w.x, gy, w.z);
        routeBeam.beamMat.color.setHex(ty.color); routeBeam.ringMat.color.setHex(ty.color);
        routeBeam.ring.rotation.z += simDt * 1.2;
        routeBeam.group.visible = true;
      }
      routeHud = { wps, next, total: route.length, remaining: Math.max(0, route.length - routeIdx) };
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
      camName: activeCamName(),
      mode: gameMode,
      onGround: state.onGround,
      checkpoints: world.rings.length,
      ringsHit,
      kills: gameMode === "ffa" ? null : (isMissionHud ? ground.destroyed : enemies.kills),
      bandits: gameMode === "ffa" ? null : (isMissionHud ? ground.remaining : enemies.alive()),
      total: isMissionHud ? ground.total : null,
      wave: gameMode === "dogfight" ? enemies.wave : null,
      health: player.health,
      lives: livesLeft === Infinity ? null : livesLeft,
      ord: { missiles: weapons.missileCount, rockets: weapons.rocketCount, bombs: weapons.bombCount },
      gear: def.rotor ? null : gearDown, // helis have skids — no gear/flaps readouts
      flaps: def.rotor ? null : flapsDown,
      brake: brakeActive,
      boost: boostActive,
      vtol: def.vtol ? vtolMode : null,
      gearWarn: !def.rotor && !gearDown && !state.onGround && state.telemetry.altitude < 350 && state.telemetry.speed < 140 && state.telemetry.vspeed < 0,
      // "Pure flight" hides every target/enemy indicator (lock, objective,
      // contacts, radar); nav island markers + instruments stay.
      lock: radarOff ? null : lock,
      objectives: radarOff ? null : objectives,
      objectivesLeft: radarOff ? 0 : objCount,
      threat: radarOff ? null : threatState, // "tracking" | "hunting" | null

      islandMarkers,
      netStatus,
      contacts: radarOff ? null : contacts,
      radar: radarOff ? null : radar,
      approach: approachHud,
      route: radarOff ? null : routeHud,
      supply: supplyHud,
    });
  } else {
    hud.ctx.clearRect(0, 0, hud.w, hud.h);
  }

  if (mapView.isOpen) mapView.draw(); // live tactical map redraw (player marker tracks)
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
  // Play the full cinematic boot once; after that, fast-fade so reloads don't tax you.
  let seen = false;
  try { seen = !!localStorage.getItem("rf.booted"); } catch (_) {}
  try { localStorage.setItem("rf.booted", "1"); } catch (_) {}
  const dur = seen ? 500 : 2200;
  const hold = seen ? 60 : 280;
  const t0 = performance.now();
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
      }, hold);
    }
  })(t0);
})();
