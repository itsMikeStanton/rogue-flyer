# Rogue Flyer — circle-back TODO

Running list of things we've deferred / want to revisit. Newest themes at top of
each section. Tuning knobs note the file/number so they're quick to change.

## Multiplayer (FFA)
- [x] **Rooms / private games** — server scopes the relay by room code (A–Z0–9,
      max 6). Empty = shared PUBLIC lobby; a code = private game. `?room=CODE`
      link is the shareable invite; menu Room field; HUD shows the room.
- [x] **Vehicle-bay room roster** — the bay (post-connect, pre-takeoff) shows
      the room, who's here live (join/leave), and a copy-invite link. Acts as the
      lobby without a flow change.
- [x] **Full lobby ready-up** — server tracks ready/inGame per pilot; when every
      waiting pilot in a room is ready they launch together (synced countdown);
      solo readies up and goes. Bay shows READY UP + ✓/○ ticks + X/Y ready, with
      a "Launch now" bypass. (`checkLaunch` in server.js; bay roster in main.js.)
- [x] **Ready-up polish** — host (longest-waiting pilot) can force-start the room
      regardless of who's ready; an un-ready idle pilot is flagged `afk` after 45s
      (excluded from the launch gate, so they no longer block the group) and
      kicked after 150s if a shared room is waiting on them. (`server.js`
      checkLaunch/forceStart/idle-sweep; bay roster + Force-start button.)
- [x] **Copy-invite button** — menu "Invite" mints a private code if blank and
      copies the `?room=CODE` link; bay has a copy-link too. (QR still optional.)
- [x] **Kill feed** — on-screen "A splashed B" log (fades after 6s, last 5).
- [x] **Scoreboard** — kills/deaths per pilot, Tab-held overlay (FFA), live via
      the server `score` broadcast.
- [x] **Team colors / teams** — optional team battle: menu "Team battle" toggle
      (the room's first joiner sets the mode; later joiners inherit + balance onto
      RED/BLUE). Colored jets + radar markers, team-grouped scoreboard with team
      totals, team-tinted kill feed, no friendly fire (enforced server-side), team
      tag in the bay roster. (`server.js` placeOnTeam/friendly-fire; client net/main.)
- [x] **Vendor three.js locally** — engine + the 5 postprocessing addons live in
      `vendor/three`; importmap points local. No CDN, runs offline / on an
      isolated LAN.
- [x] **Ground-spawn scatter** — FFA runway/carrier starts now stagger pilots into
      lanes/rows (by net id) so they don't spawn stacked on the same spot.

## Deploy / hosting / money
- [x] **Single-container deploy** — Dockerfile + fly.toml + DEPLOY.md. Node
      server (static host + WS relay on one port) ships as one image; client
      auto-upgrades to wss:// behind TLS. (Image build untested in sandbox — no
      docker daemon; `fly deploy` builds remotely.)
- [x] **Server-authoritative combat (#3 Tier 1)** — server owns HP/death +
      validates damage (clamp/range/rate), anti-teleport, msg-rate cap. No more
      godmode/one-shot/kill-spoof. (`server/server.js`; `docs/NETCODE_…`.)
- [x] **Persistence — testable slice (#4)** — stable guest token (`rf.uid`) sent
      on join + local lifetime K/D (`rf.stats`) on the FFA menu + scoreboard.
- [ ] **Accounts backend (#4)** — Discord OAuth + Postgres + WS token handshake +
      stat-flush. **GATE behind a retention signal — don't build until the free
      build shows people come back.** Discord-FIRST, not Discord-only (opt-in
      "claim your guest profile"; keep a non-Discord path on the roadmap). Free,
      no-account play stays the product. BLOCKED on credentials anyway: Discord
      app, `DATABASE_URL`, `SESSION_SECRET` (see `docs/NETCODE_AND_ACCOUNTS_PLAN.md`).
- [ ] **Monetization** — **never gates access** (free = full sandbox forever).
      Sells persistence/vanity/hosting only: private-room hosting first (rooms
      exist), then cosmetics (callsign/livery/trail colors). Same retention gate.

## Scale & feel
- [ ] **Terminal velocity / top-speed cap** — there's effectively no drag ceiling
      right now; tied to the speed↔felt-scale relationship. (`flight.js`)
- [ ] **Jets/ships sit at ~1× real** while the world reads at ~2.5× "felt" scale,
      so they can feel small. Bumping the player jet is risky (camera distance,
      collision/hit radii, MP netTarget size, hangar framing) — wants its own
      careful pass.
- [ ] Decide whether to lengthen fighters ~1.4× (they're ~0.5–0.6× real length,
      stubby) — judgment call, eyeball first.
- [ ] Carrier is 2× too long for its beam (660×80 vs real ~333×77). Keep as a
      "super-carrier" or halve `halfL` (`worldConfig.js`).

## UI / HUD / planner
- [ ] **Top-band HUD clipping** — the jet-name / top-left readouts get cut off by
      a letterbox/safe-area band (that's why the clock was moved down). Look at a
      proper safe-area inset.
- [ ] **LAUNCH-now vs PLAN start** are two different "start" notions: menu LAUNCH
      uses the quick start dropdown (home air/runway/carrier); PLAN remembers the
      last *planned* start (any airfield). Optionally unify so LAUNCH-now reuses
      the last planned start.
- [ ] Fold the **per-waypoint inspector** (type/alt/snap/delete) into the PLANS
      panel so it's the single surface for everything route-related.
- [ ] Conquest **launch-from-carrier as a true island-independent beachhead**
      (start at sea, seize your first island by flying to it) instead of granting
      the nearest island. Currently grants nearest island.
- [ ] Pre-existing config quirk: islands with `spawn.x/z` ≠ 0 (e.g. **Aerival** at
      6400,5200) have their launch *coordinate* off the visual runway (runway +
      flatten are at local 0,0). Reconcile if we ever launch from such islands.

## World / biome
- [ ] **Subtle volcanic-proximity ash gradient** — a faint ash tint on the
      volcano-facing shore of the nearest island(s). Keep dialed way down.
- [ ] Biome thresholds to eyeball/tune: snow start (580 m) & rock band, treeline
      (~600 m), palm band (<30 m), spruce band (>430 m) — all in `world.js`.
- [ ] **Coral Halo coastal density** may read sparse (small cottages at town
      spacing). Tighten spacing or coastal footprint if so.
- [ ] Settlement hierarchy: with the bigger base height, **villages can read as
      small towns**. Dial per-settlement `maxHeight` if it blurs village→city.
- [ ] More **civic landmarks per culture** (temples/pagodas, etc.) — only stadium
      + cathedral so far.

## Volcano & eruption (The Pyre)
- [ ] **Wire ambient interval / lethality** to taste once flown: ambient timer
      `180 + rand·300` s, bomb-trigger radius 1 km, ash zone 7 km, rumble 24 km,
      lava-bomb damage (36 direct / 24 splash). (`main.js` eruption block)
- [ ] **Lava flows**: currently straight radial channels — consider routing them
      down real gullies and/or a scrolling/animated glow.
- [ ] **Lightning bolts** render ~1 px (the flash carries them) — swap to
      tube-geometry bolts if we want them chunkier.
- [ ] **Scripted / conquest eruption uses** — a campaign set-piece, or an
      eruption that threatens the nearest island (ashfall over a base).
- [ ] Pyre visual tuning: plume scale (size 120 base, ×2.2 erupt), glow-halo size
      (~1.7–2.6 km), fountain density/height, day-time glow punch.

## Performance
- [x] **Island LOD** — far islands (past ~outer+22 km, fully fogged) drop
      entirely; each island's interiors (buildings/infra/forests/props) hide past
      ~outer+8 km. (`cullIslands` in main.js; `detail` group in `buildIsland`.)
- [x] **Pool eruption lava bombs + spray** — reusable mesh pools, no GC churn.
- [ ] **Instance the per-island structure singletons** (turbines ~6 meshes each,
      cranes, tanks, cathedral/stadium, hangars, power-plant parts) — *lower
      value now* that LOD hides far islands and you're only near 1–2 at a time;
      do it only if a near-island still dips FPS.
- [ ] **Distance-cull traffic** (ships/zeppelin/trains) when far — modest count,
      but they update + draw across the whole map today.
- [ ] **Pool fx explosions / lightning bolts** if eruption GC still spikes.
- [ ] Consider terrain LOD (360² segments per island) if terrain draw is heavy.

## Infrastructure (eyeball after flying)
- [ ] **Ports** are coastline-found from a seeded heading + low-beach gate, so
      some islands get one and some don't. Guarantee one per island if wanted; the
      220 m straight quay may dip toward water on a curving shore.
- [ ] **Dam/reservoir** — flat lake disc on gentle terrain can show ragged edges;
      gated to the flattest spot but worth a look.
- [ ] **Cargo ships have nowhere to dock** — wire the lanes to head for / berth at
      the new ports.
- [ ] Perf: lots of new per-island geometry (mostly instanced, but cranes / tanks
      / cathedral / turbines / hangars are individual meshes). Instance the
      repeaters if FPS dips on weaker devices.

## Day/night
- [ ] **Rain spells + sun azimuth are still per-session random** (time-of-day is
      deterministic). Bucket rain off the wall clock if we want the whole sky
      reproducible on refresh.
- [x] **Graphics settings menu** — the old 4 "looks" (off/cinematic/vivid/retro)
      are now preset TEMPLATES; picking one fills 15 per-effect sliders (exposure,
      bloom strength/size/threshold, daytime-bloom cut, chromatic aberration, RGB
      shift, lens/UV bend, vignette, grain, scanlines, warm/cool, teal-orange,
      contrast, saturation). Nudging any slider forks a saved "Custom" profile.
      Exposure + bloom-threshold + daytime-bloom-cut directly tame the blown-out
      noon sky. (`postfx.js` flat settings model; `main.js` FX_FIELDS controller.)

## Done this session (for reference)
Carrier planting, target-island HUD, conquest planner on the big map, named
flight plans + PLANS panel, quick/free planner + air-start, deterministic
day/night + HUD clock, resupply at ≤2 ammo, throttle arming rework, MP weapon
visuals + callsign, settlement archetypes + per-island culture + primary
centers, infra (farms, airfields, wind, pylons, ports, solar, refineries,
stadium/cathedral, dam), altitude biome + treeline + palm/spruce, the central
volcano + full eruption event (fountain, bombs, flows, glow, lightning, ashfall,
rumble; key-9 / ambient / bomb triggers).
