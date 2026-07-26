import "dotenv/config";
import http from "http";
import https from "https";
import selfsigned from "selfsigned";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { attachSttRelay } from "./sttRelay.js";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const pool = createPool();
const app = createApp(pool);

// Mirrors webapp's HTTPS=true dev flag (vite.config.ts): the STT relay is a
// WebSocket connection from the app, and a page served over HTTPS (required
// for mic access on a LAN address -- see that file) cannot open a plain ws://
// connection to it (mixed content). Self-signed and regenerated each start;
// this is a dev/beta relay, not a cert anyone needs to persist.
async function createServer() {
  if (process.env.HTTPS !== "true") return http.createServer(app);
  const { private: key, cert } = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    keySize: 2048,
  });
  return https.createServer({ key, cert }, app);
}

const server = await createServer();
attachSttRelay(server);

server.listen(port, () => {
  const scheme = process.env.HTTPS === "true" ? "https" : "http";
  console.log(`FlowCue AI backend listening on ${scheme}://localhost:${port}`);
});
