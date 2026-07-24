import express, { type Express } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { scriptsRouter } from "./routes/scripts.js";
import { sessionsRouter } from "./routes/sessions.js";
import { settingsRouter } from "./routes/settings.js";
import { DEV_USER_ID } from "./devUser.js";

export function createApp(pool: Pool): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // See devUser.ts -- no real auth yet, so every request is scoped to a
  // single placeholder user. Replace this middleware (not the routes) when
  // wiring in the managed auth provider from the Technical Architecture doc.
  app.use((req, _res, next) => {
    req.userId = DEV_USER_ID;
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/scripts", scriptsRouter(pool));
  app.use("/api/sessions", sessionsRouter(pool));
  app.use("/api/settings", settingsRouter(pool));

  return app;
}
