import "dotenv/config";
import http from "http";
import https from "https";
import selfsigned from "selfsigned";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { attachSttRelay } from "./sttRelay.js";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const pool = createPool();
const app = createApp(pool);

// Runs on every boot, not just once -- idempotent (see runMigrations), and
// the only practical option on Render's free tier, which doesn't support
// Shell or One-Off Jobs (both paid-tier-only) to run this separately.
// Deliberately non-fatal: the STT relay (this server's actual primary
// function) has no Postgres dependency at all, same reasoning as db.ts's
// own graceful-degradation comment -- a DB that's unconfigured or
// unreachable shouldn't take down live cueing over a feature (anonymous
// metrics) that's off by default for most sessions anyway.
try {
  await runMigrations(pool);
} catch (err) {
  console.error("Migrations failed to run -- continuing without them:", err);
}

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
