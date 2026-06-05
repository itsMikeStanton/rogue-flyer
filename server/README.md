# Rogue Flyer — LAN multiplayer

A tiny server that hosts the game **and** a WebSocket relay on one port, so
LAN play works with no HTTPS/cert/mixed-content hassle.

## Run it

```bash
cd server
npm install     # once — pulls in `ws`
npm start       # serves on port 8080 (set PORT=xxxx to change)
```

It prints a `http://<your-ip>:8080` URL. Everyone on the same Wi-Fi opens that
URL, picks **Multiplayer FFA** from the mode list, and flies. You'll see each
other and (once enabled) shoot each other.

Notes:
- Play via the **server's** URL, not the GitHub Pages site — an HTTPS page can't
  reach a `ws://` LAN server (browser mixed-content rule). The server serves the
  same game over HTTP so the WebSocket is same-origin and just works.
- It's a relay only (no anti-cheat); intended for friendly LAN games.
