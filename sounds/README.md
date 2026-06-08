# Sound files

Drop your audio here (`.mp3` **or** `.wav`). They're loaded by `src/audio.js`
via the `SOUNDS` manifest. Any file that's missing falls back to the built-in
synthesized sound, so the game always has audio — add files incrementally.

## Default filenames (one each)

| File | Effect | Notes |
|------|--------|-------|
| `gun.mp3`        | Your cannon | heard a LOT — see variations below |
| `explosion.mp3`  | Any explosion | heard a LOT — variations recommended |
| `missile.mp3`    | Missile / rocket launch | |
| `bomb.mp3`       | Bomb release | falls back to `missile` then synth |
| `flak.mp3`       | Enemy cannon + ship/zeppelin flak | positional |
| `lock.mp3`       | Missile lock acquired | short chirp |
| `hit.mp3`        | You take damage | |
| `crash.mp3`      | Your aircraft goes down | |
| `ring.mp3`       | Checkpoint / ring pass | |
| `flare.mp3`      | Countermeasure flares | |
| `engine.mp3`     | **Looping** idle/cruise engine | must loop seamlessly |
| `engine_high.mp3`| *Optional* **looping** high-power layer | fades in past ~45% throttle |

## Variations (for repeated sounds)

In `src/audio.js`, each entry is an array — list as many files as you like and a
random one plays each time, e.g.:

```js
gun:       ["sounds/gun_a.wav", "sounds/gun_b.wav", "sounds/gun_c.wav"],
explosion: ["sounds/exp_a.mp3", "sounds/exp_b.mp3", "sounds/exp_c.mp3"],
```

On top of that, one-shots already get a small random pitch + volume jitter each
play, so even a single file won't sound mechanically identical on repeats.

## Engine ramp-up/down

Two supported setups (pick one):

1. **Single loop** (`engine.mp3`): its pitch rises with throttle/speed and its
   volume tracks throttle. Simplest — record a steady mid-RPM loop.
2. **Two layers** (`engine.mp3` + `engine_high.mp3`): a low/idle loop always
   running, plus a high-power/roar loop that **crossfades in** as you push the
   throttle past ~45% (and both pitch up a little). This gives the most
   convincing "spool up into thrust / wind down" without pitch-shifting one clip
   too far. Record both at the same loop length if you can.

Both engine files **must be seamless loops** (no clicks at the loop point).
