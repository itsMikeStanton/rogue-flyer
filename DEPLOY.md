# Deploying Rogue Flyer

The whole game ships as **one container**: `server/server.js` serves the static
client from the repo root *and* runs the WebSocket multiplayer relay on the same
port. No build step, no CDN — three.js is vendored under `vendor/three/`, so it
runs with zero internet dependencies (works on an isolated LAN too).

## Run it locally
```
cd server && npm install && npm start
# open http://localhost:7359
```

## Deploy to Fly.io (recommended first home)
Cheap, global, scales down when idle, handles WebSockets and TLS for free.

```
# one-time
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth signup            # or: fly auth login
fly launch --no-deploy     # creates the app; pick a name + region (edits fly.toml)

# every release
fly deploy
```

That's it — Fly gives you `https://<app>.fly.dev`. The client auto-upgrades the
socket to `wss://` over HTTPS (see `src/net.js`), so multiplayer works with no
extra config.

### Notes
- **`min_machines_running = 1`** in `fly.toml` keeps one machine warm so a shared
  link is instant. Set it to `0` to scale fully to zero (cheaper, but the first
  player eats a cold start). For the "click and you're flying" pitch, keep it 1.
- **Region:** set `primary_region` to whoever's nearest your first players. Add
  more regions later (`fly regions add ...`) once there's a crowd; each region's
  relay is independent — players in a region see each other.
- **Cost:** a `shared-cpu-1x` / 256 MB machine is a few dollars a month. The relay
  is low-bandwidth (positions + fire events, not video), so it stays cheap well
  into the hundreds of concurrent players.

## Other hosts
Any platform that runs a Node container and supports WebSockets works (Render,
Railway, a plain VPS). They just need to honour `$PORT` — the server already
reads `process.env.PORT` and binds `0.0.0.0`.
