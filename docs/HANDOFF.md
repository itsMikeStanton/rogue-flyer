# Session handoff — for the next session

Context dump of things discussed or shipped this session that are **not yet done**
or **need follow-up**, so the next session can pick up cleanly. Completed work is
in `TODO.md` (see the "Done" / checked items) and the relevant plan docs.

---

## 1. Visual QA backlog (shipped but NOT visually verified)

This session ran in an environment with **no WebGL / no browser**, so a lot of
graphics/HUD/model work was verified by logic, math, or server-side tests only —
never actually seen rendering. Someone should fly the build and eyeball these:

- **CRT lens warp** (`postfx.js`): Lottes tube curvature, fill-zoom that hides the
  black corners (overscan = `w²/(1+w²)`), and the afterburner bulge. Confirm it
  reads as a CRT and corners stay filled at max warp + boost.
- **HUD-on-the-tube** (`postfx.js` overlay quad + `main.js` `setHudPath`): HUD warps
  with the scene, insets so nothing is cropped (`HUD_INSET = 0.3`), survives the
  fullscreen-resize freeze (texture is rebuilt on copy resize), copy capped at
  3072px. Re-confirm: orientation upright, fullscreen toggle, FX-off path.
- **Death cam** (`main.js` `updateCamera`, `crashCamPrimed`): starts right next to
  the jet on the first crash frame, not from a stale chase point.
- **Close chase clamp** (`main.js`): never more than `3 * jetLength` behind.
- **Flaps** (`aircraft.js` `addGearFlaps`): now auto-seated on the detected wing
  (widest mesh) at its trailing edge + wing height; painted in the airframe
  livery. **Most important to check** — see §3.
- **Control-surface paint**: flaps, dorsal speedbrake, Harrier VTOL nozzle housings
  now use `makeMaterials(def).body` (livery/camo), gear stays dark metal.
- **Team battle** (`server.js` + client): colored jets/markers, team scoreboard,
  team-tinted kill feed, no friendly fire. Server logic was unit-tested; the
  *visual* side (colors, scoreboard layout, bay team tag) was not.
- **Graphics settings**: preset→custom slider menu + the live non-modal visuals
  panel (🎚 button in flight).

## 2. Dead code to remove (decals/insignia were ripped out)

Insignia/decals were removed because the projected-decal approach wasn't working.
The feature is OFF (not applied, UI hidden) but **leftovers remain** — clean these
when convenient:

- `src/markings.js` — now unused (nothing imports it). Delete or keep as reference.
- `vendor/three/addons/geometries/DecalGeometry.js` — vendored for the decal
  attempt; unused now. Keep only if decals get revisited (see §4).
- `src/main.js` — dead markings wiring: `insigniaId`, `tailNumber`,
  `currentMarkings`, `setInsignia`, `setTailNumber`, the `onPreviewInsignia` /
  `onPreviewNumber` / `insigniaId` / `tailNumber` UI callbacks, and the
  `rf.insignia` / `rf.tailnum` localStorage reads.
- `src/ui.js` — `buildMarkingsStrip()` / `refreshMarkings()` are now no-op stubs;
  remove their call sites too if fully deleting.
- `index.html` — `<div id="hangar-markings">` and the `.hb-markings` / `.hbm-*`
  CSS in `src/style.css`.

## 3. Flaps — verify the auto-seat, then fine-tune

`addGearFlaps` now picks the **widest mesh as the wing** and seats flaps on its
trailing edge. Check per airframe:

- Any plane where the **wrong mesh is picked** (flaps land on tail/fuselage). The
  **B-2** (flying wing — body *is* the wing) is the key sanity check.
- Retracted flaps now sit **flush in the wing** (may be near-invisible until they
  droop — press flaps/`V`). That's intended; confirm it's not too hidden.
- `flapX` / `flapW` / `flapC` are still per-airframe overridable in `def.landing`;
  `flapY` / `flapZ` are derived. The **F/A-18 has no `landing` spec** at all (uses
  F-16 defaults) — give it one if its gear/flaps look off.

## 4. Offered-but-not-built polish (pick up if wanted)

- **Optional CRT rounded-corner bezel**: the bezel mask is still in the grade
  shader but is a no-op under the fill-zoom. Could expose it as a "rounded corners"
  toggle (trade the full-frame fill for the classic black CRT corners).
- **Visuals panel reach from the menu**: the 🎚 live panel is flight-only by
  design; could also surface it on the main menu.
- **Draggable visuals panel** / remember position.
- **HUD bezel exemption**: if heavy warp ever clips a corner readout, exempt the
  HUD from the bezel/curvature at the extreme corners.
- **Decals, take 2** (if desired): `DecalGeometry` is vendored. The projection
  worked geometrically but placement/seam handling was fiddly; would need the
  target-mesh selection and per-airframe placement reworked.

## 5. Bigger planned work (already documented — pointers only)

- **Accounts (#4) + monetization** — fully specced in
  `docs/NETCODE_AND_ACCOUNTS_PLAN.md`. Load-bearing decisions recorded there and in
  `TODO.md`: free/no-account/no-pay play is the product; **gate accounts behind a
  retention signal (don't build yet)**; **Discord-first, not Discord-only**;
  **monetization never gates access** (private rooms → cosmetics). Blocked on creds
  (Discord app, `DATABASE_URL`, `SESSION_SECRET`) regardless.
- Open gameplay/world items remain in `TODO.md` (terminal-velocity cap, rain
  determinism, Pyre/volcano tuning, etc.).
