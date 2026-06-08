# Rogue Flyer — Sound Effects Reference

Every sound in the game, what triggers it, and the file it maps to. Audio lives
in `src/audio.js` (`SoundEngine`); drop real files in `/sounds` and list them in
the `SOUNDS` manifest. Any missing file uses the built-in synthesized fallback.

Each manifest entry is an **array of variation files** (a random one plays each
time). One-shots also get a small random pitch + volume jitter per play, so even
a single file won't sound identical on repeats. mp3 **or** wav both work.

## One-shot effects

| Effect | File key | Triggered by | Positional | Notes |
|--------|----------|--------------|:----------:|-------|
| Cannon fire | `gun` | Space / fire button (rapid) | no | heard a lot → add variations |
| Explosion | `explosion` | every blast: kills, bombs, craters, flak hits (`fx.onAdd`) | **yes** | heard a lot → add variations; pitches down as size grows |
| Missile / rocket launch | `missile` | B (missile), R (rockets) | no | |
| Bomb release | `bomb` | N (drop bomb) | no | falls back to `missile`, then synth |
| Enemy gun / flak | `flak` | enemy fighters + ship/zeppelin/carrier flak | **yes** | rate-limited so a swarm can't flood |
| Missile lock | `lock` | a target goes solid-locked | no | short chirp |
| Hull hit | `hit` | you take damage | no | |
| Crash | `crash` | your aircraft goes down | **yes** | crash blast is silenced so it isn't doubled |
| Checkpoint pass | `ring` | flying through a ring | no | |
| Flares | `flare` | X / flare button | no | |

## Continuous / looping

| Effect | File key | Triggered by | Notes |
|--------|----------|--------------|-------|
| Engine (idle/cruise) | `engine` | runs while flying | **must be a seamless loop**; pitch + volume track throttle/speed |
| Engine high-power layer | `engineHigh` | optional | **seamless loop**; crossfades in past ~45% throttle for a "spool-up" |
| Lock seeker growl | *(synth only)* | while a target is in the lock box | live parametric tone (pitch/pulse rise with lock) — kept synthesized |

## Notes

- **Positional** sounds play through a 3D panner (distance falloff + stereo
  pan) — give them mono files for the cleanest spatialization.
- To add variations, list more files in the array, e.g.
  `gun: ["sounds/gun_a.wav", "sounds/gun_b.wav", "sounds/gun_c.wav"]`.
- To switch any sound to wav, just change its extension in the manifest.
- The seeker growl is the one effect that stays synthesized (it's a continuously
  modulated tone rather than a clip); everything else accepts a sample.
