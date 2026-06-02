# Rogue Flyer

An arcade jet flight game for the browser. Built with **Three.js** and the
**Gamepad API** so it works with a "fancy" HOTAS (separate throttle, rudder,
hat switch, buttons) — and falls back to keyboard if you don't have one.

- **Realistic-ish jets, arcade graphics.** Three flyable aircraft with distinct
  feel (agile F-16, all-round F/A-18, heavy A-10), an arcade-plus flight model
  (lift curve, stall, airspeed-dependent control authority, induced drag,
  thrust-to-weight that lets you climb vertically), and chunky low-poly terrain.
- **Full joystick support.** Throttle on its own axis, remappable bindings with
  a live axis/button monitor, saved to `localStorage`.
- **HUD** with airspeed/altitude tapes, heading strip, throttle bar, Mach, G,
  AoA, vertical speed, and a stall warning.
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

### Keyboard
| Key | Action |
|-----|--------|
| `W` / `S` | pitch nose down / up |
| `A` / `D` | roll left / right |
| `Q` / `E` | yaw (rudder) |
| `Shift` / `Ctrl` | throttle up / down |
| `C` | cycle camera (Chase / Far / Cockpit) |
| `R` | reset / respawn |
| `Esc` | menu |

## Project layout

```
index.html        markup + import map
src/style.css     menu / HUD-overlay styling
src/main.js       renderer, game loop (fixed-timestep physics), camera
src/flight.js     arcade-plus flight dynamics
src/aircraft.js   jet definitions + low-poly mesh builder
src/world.js      terrain, sky, lighting, landmarks, ring checkpoints
src/input.js      Gamepad API + keyboard, remappable bindings
src/hud.js        canvas-2D HUD
src/ui.js         menu, jet select, joystick remap panel
```

## Next ideas
Weapons & targets, enemy AI, sound (engine pitch with throttle, sonic boom),
landing-gear & proper takeoff/landing, more aircraft, terrain streaming for a
bigger map.
