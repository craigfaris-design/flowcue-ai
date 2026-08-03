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

  // Found via code review: with no error-handling middleware, an async
  // route handler's rejection (see asyncHandler.ts -- e.g. a DB error) had
  // nowhere to go but an unhandled rejection, crashing the whole process
  // for every user, not just returning a 500 to the one request that hit
  // it. Must be registered last and take 4 params for Express to recognize
  // it as error-handling middleware.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
