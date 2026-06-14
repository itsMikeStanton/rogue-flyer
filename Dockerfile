# Rogue Flyer — single-image deploy.
# The Node server (server/server.js) serves the static game from the repo root
# AND runs the WebSocket relay on the same port, so one container is the whole
# thing: open the URL, pick Multiplayer FFA, fly.
FROM node:20-slim

WORKDIR /app

# Install only the server's production deps (ws) first for layer caching.
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Then the game itself (client + vendored three.js + sounds + server code).
COPY . .

# Fly/most PaaS inject $PORT; default to 8080 in-container. The server already
# honours process.env.PORT and binds 0.0.0.0, so this is all it needs.
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "server.js"]
