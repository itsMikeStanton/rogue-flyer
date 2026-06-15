# Plan: authoritative-enough netcode (#3) + accounts & persistence (#4)

Status: **#3 Tier 1 BUILT & tested. #4 still planned** (needs a Discord app + a
Postgres DB to wire — see "what I need from you" at the bottom). Do #3 before
persisting competitive stats in #4, so the numbers you save are trustworthy.

## #3 Tier 1 — shipped
Server now owns HP + death and validates damage (`server/server.js`):
- Per-client `hp`/`alive`; a `hit` is a REQUEST — clamped per weapon
  (`DMG_CAP`), range-gated (`MAX_RANGE`), and rate-capped (`RATE_DMG`).
- Environment damage goes through `env` (capped) → same authoritative HP path.
- Death + kill credit are server-authored; clients render `hp`/`kill`, can no
  longer godmode, one-shot, refuse death, or spoof kills. Anti-teleport + a
  message-rate cap included. Respawn re-baselines via `respawn`.
- Validated end-to-end: one-shot clamp, range reject, env death, respawn.

---

## Where we are today (the starting point)
`server/server.js` is a **dumb relay**. Each client runs its own sim and sends:
- `state` — its own position / quaternion / **health** / alive (self-reported).
- `fire` — visual-only weapon discharge (cosmetic).
- `hit` — `{target, dmg}`; the server relays it and the **victim applies the
  damage to itself**.
- `death` — victim authors its own death + names the last attacker (kills).

Nothing is validated. Everything a client asserts is trusted.

### Known exploits (all trivial today)
1. **Godmode** — ignore incoming `hit`s / never send `death` / report `health:100`.
2. **One-shot everyone** — send `{hit, target, dmg: 9999}` with no real aim.
3. **Teleport / speedhack** — `state` position can be anything, any rate.
4. **Kill spoofing** — victim authors kills, so a cheater simply never dies.
5. **Flood / DoS** — no message rate limit.

---

## #3 — Authoritative-enough netcode

Full server authority (server runs the whole sim) is a rewrite and overkill for
an arcade browser game. Target the **80/20: server owns health/death and
validates the rest; clients keep simulating for responsiveness.**

### Tier 1 — server owns HP + validates inputs  ← recommended scope
Additive layer on the existing relay; no client-prediction rewrite.

**Server gains authority over damage & death:**
- Per-client `hp` lives on the server. Clients **stop self-reporting health**.
- A `hit` is now a *request*. Server validates it, applies damage to the target's
  authoritative `hp`, decides death, and broadcasts `damage {target, hp, by}` and
  (on death) the existing `kill` + `score`. Kills are no longer victim-authored,
  so "never report my death" stops working.

**Validate the `hit` request before applying:**
- **Range**: shooter's last-known `state` position must be within that weapon's
  max range of the target (table per `kind`: gun / missile / rocket / bomb).
- **Damage cap**: `dmg` clamped to the weapon's max (table). No more 9999.
- **Fire-rate / rate-limit**: max hits per weapon per second per shooter.
- Reject (drop) anything implausible. This kills aim-by-fiat without the server
  having to actually simulate aiming.

**Movement sanity:**
- On each `state`, compare to the client's previous position/time. If the implied
  speed exceeds max (+ generous lag margin), **ignore/clamp** the update (soft —
  don't hard-correct, to avoid rubber-banding). Optionally flag repeat offenders.

**Hygiene:**
- Per-connection **message rate cap** (anti-flood).
- Server assigns identity (already true); names stay cosmetic + moderated (#5).

**Client changes:** stop sending `health` in `state`; stop applying remote `hit`
to own HP; apply server `damage`/`hp`; render server-driven death. Show immediate
local hit feedback and reconcile to the server number (hide the round-trip).

**Cost:** ~1–2 days. **Risk:** slight hit-registration latency (fine for arcade);
tune movement thresholds to avoid lag false-positives.

### Tier 2 — light authoritative projectiles (defer)
Server simulates the *few, slow* projectiles (missiles/bombs) authoritatively;
guns stay client-hit-validated (too many/fast to simulate cheaply). Only if fake
projectile-hit cheating survives Tier 1.

### Tier 3 — full authority / rollback (out of scope)
Only if the game becomes competitive enough to justify it.

---

## #4 — Accounts & persistence

Identity that survives a refresh; the foundation for cosmetics, paid private
rooms, stats, and friends. **Keep guest play frictionless** — accounts are opt-in.

### Auth: Discord OAuth2 (audience fit)
- **Guest by default**: device id in `localStorage` + chosen callsign. Zero
  friction for the public funnel (D1-retention test doesn't need accounts).
- **"Sign in with Discord"** (Authorization Code flow) for persistence/cosmetics:
  redirect → server exchanges code → fetch Discord id + username/avatar →
  upsert our user → issue **our own** session (httpOnly cookie or short JWT). Store
  the discord_id↔user mapping; don't retain Discord tokens.

### Data model (managed Postgres — start minimal)
- `users` (id, discord_id, display_name, avatar, created_at)
- `entitlements` (user_id, cosmetics owned, subscription_status, expires_at)
- `stats` (user_id, kills, deaths, games, playtime) — lifetime aggregate
- (later) `matches` for history. Don't over-model early.

### Server changes
- Add an **HTTP auth layer** to the existing Node server (currently static + ws):
  `/auth/discord/login`, `/auth/discord/callback`, `/auth/me`, `/auth/logout`.
  Keep it in-process with a `pg` client initially (matches the single-container
  deploy); split into a service only if needed.
- **WS handshake**: client sends its session token on `join`; server validates
  and binds the socket to a user id (or guest). Now scores can persist.
- **Persistence writes**: keep kills/deaths in memory during play; **flush to DB
  on disconnect / periodically** (never per-event) to keep it cheap.

### Client changes
- Menu "Sign in with Discord" + signed-in name/avatar; guest mode default.
- Send session token on connect; read `entitlements` to unlock cosmetics later.

### Infra
- Managed Postgres (Fly Postgres / Supabase / Neon).
- Secrets via Fly secrets: Discord client id/secret, DB url, session signing key.
- HTTPS already provided by Fly (OAuth redirect needs it).

**Cost:** ~2–4 days for auth + DB + wiring (more with a cosmetics UI).

---

## Dependency & sequencing
1. **#3 Tier 1** — server owns HP/death + validates hits/movement. Makes the game
   fair *and* makes scores trustworthy.
2. **#4** — accounts → persist the now-trustworthy stats → cosmetics → **paid
   private rooms** (the first revenue feature; rooms already exist).

Accounts *can* precede #3 if you only want identity + paid rooms (non-competitive)
and are willing to hold leaderboards until scores are trustworthy. But the clean
order is **#3 then #4**.

Gate both behind the browser playtest + a D1-retention read on the free public
build — if people don't come back, neither of these is the priority yet.
