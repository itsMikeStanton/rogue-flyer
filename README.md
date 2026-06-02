# Rogue Flyer

An arcade jet flight game for the browser. Built with **Three.js** and the
**Gamepad API** so it works with a "fancy" HOTAS (separate throttle, rudder,
hat switch, buttons) — and falls back to keyboard if you don't have one.

- **Realistic-ish jets, arcade graphics.** Three flyable aircraft, each with a
  distinct low-poly model and feel — sleek single-tail F-16, twin-tail F/A-18,
  straight-wing twin-pod A-10. Arcade-plus flight model (lift curve, stall,
  airspeed-dependent control authority, induced drag, thrust-to-weight that lets
  you climb vertically) with input smoothing and auto-leveling so it's easy to
  fly on touch/keyboard. Low-poly world with rolling terrain, a carved winding
  river, drifting clouds, forests, and towns.
- **Full joystick support.** Throttle on its own axis, remappable bindings with
  a live axis/button monitor, saved to `localStorage`.
- **HUD** with airspeed/altitude tapes, heading strip, throttle bar, Mach, G,
  AoA, vertical speed, and a stall warning.
- **Game modes** (pick at the start screen):
  - **Dogfight** — enemy AI jets pursue and shoot at you; fight back with the
    cannon and lock-on homing missiles. Hull health; get shot down and respawn.
  - **Strike Mission** — destroy every ground target (fuel tanks, radars,
    bunkers, SAM sites) **and the enemy carrier** with guns + missiles; an
    on-screen marker points to the nearest one. Clear them all to win.
  - **Target Practice** — gun down drifting drones, nobody shoots back.
  - **Free Flight** — just fly and chase the rings.
- **Weapons.** Forward-firing tracer cannon (FIRE / Space / joystick button) and
  **lock-on homing missiles** (MSL / B / joystick button) — point at a bandit in
  the forward cone to lock (HUD lock box), then launch. HUD shows KILLS,
  remaining BANDITS, hull health, missile count, and a lock indicator.
- **Sound** (synthesized, no asset files): jet-engine drone that tracks throttle
  + airspeed, cannon, missile whoosh, explosions, lock tone, hull-hit thud.
  Explosions and enemy gunfire are **3D-spatialized** — they pan and fade with
  distance (listener locked to the camera). Mute with the menu button or **M**.
- **Island map + carriers**: the land is an island ringed by open ocean (fly
  into the sea and you ditch). Two aircraft carriers sit offshore — ours and the
  enemy's, on opposite sides of the island.
- **Start options** (menu dropdown): in the air, on the **runway** (spool up,
  roll out, rotate at ~132 kts with nosewheel steering), or on **our carrier**
  (catapult shot off the deck).
- **Ring checkpoints** to chase around the map.

## Run it

It's zero-build (ES modules + Three.js from a CDN), but browsers block module
loading over `file://`, so serve the folder over HTTP:

```bash
# any one of these from the project root
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

> The CDN import means your browser needs internet access the first time.

## Controls

### Joystick (HOTAS)
Plug it in **before** loading, or press a button so the browser registers it.
Defaults: stick = roll/pitch, twist = yaw, axis 3 = throttle. Use
**Controls / Joystick Setup** to remap any axis (with invert) — the live
monitor shows which axis moves so you can find your throttle.

### Touch (phones / tablets)
On-screen controls appear automatically on touch devices: a virtual **stick**
(roll/pitch) bottom-left, a sticky **throttle lever** bottom-right, **rudder**
buttons, and **CAM / RESET / FIRE** buttons. Multi-touch, so you can hold
throttle while working the stick. Best in landscape.

- **Touch controls mode** (Controls panel): *Auto-detect* / *Always on* / *Off*
  — handy for touchscreen laptops that should fly with the keyboard.
- **Tilt steering** (Controls panel): bank and pitch by physically tilting the
  device instead of using the stick. Enable it (grants motion access on iOS),
  hold the device how you want to fly, then **Recenter**. Invert pitch/roll to
  taste. An in-flight **⊕ CENTER** button re-zeroes the neutral point.
- **Fullscreen**: a **⛶ Fullscreen** button on the menu (and the **F** key);
  touch devices also go fullscreen automatically when you tap **FLY**.

### Keyboard
| Key | Action |
|-----|--------|
| `W` / `S` | pitch nose down / up |
| `A` / `D` | roll left / right |
| `Q` / `E` | yaw (rudder) |
| `Shift` / `Ctrl` | throttle up / down |
| `Space` | fire cannon |
| `B` | launch missile (needs a lock) |
| `C` | cycle camera (Chase / Far / Cockpit) |
| `R` | reset / respawn |
| `F` | fullscreen |
| `Esc` | menu |

## Project layout

```
index.html        markup + import map
src/style.css     menu / HUD-overlay styling
src/main.js       renderer, game loop (fixed-timestep physics), camera
src/flight.js     arcade-plus flight dynamics
src/aircraft.js   jet definitions + low-poly mesh builder
src/world.js      terrain, river, clouds, trees, towns, rings, lighting
src/input.js      Gamepad API + keyboard + touch, remappable bindings
src/touch.js      on-screen touch controls (stick / throttle / rudder), mode toggle
src/tilt.js       tilt-to-steer via device orientation sensors
src/weapons.js    player cannon + lock-on homing missiles
src/enemies.js    enemy AI fighters + passive drones (combat targets)
src/ground.js     strike-mission ground targets (destructible structures)
src/fx.js         shared explosion effects pool
src/audio.js      Web Audio synthesized engine + weapon sound
src/hud.js        canvas-2D HUD
src/ui.js         menu, jet select, joystick remap panel
```

## Next ideas
Weapons & targets, enemy AI, sound (engine pitch with throttle, sonic boom),
landing-gear & proper takeoff/landing, more aircraft, terrain streaming for a
bigger map.
