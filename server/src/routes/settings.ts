import { Router } from "express";
import type { Pool } from "pg";
import { toSettings } from "../serializers.js";

export function settingsRouter(pool: Pool): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { rows } = await pool.query("select * from user_settings where user_id = $1", [req.userId]);
    if (rows[0]) return res.json(toSettings(rows[0]));

    const inserted = await pool.query("insert into user_settings (user_id) values ($1) returning *", [
      req.userId,
    ]);
    res.json(toSettings(inserted.rows[0]));
  });

  router.patch("/", async (req, res) => {
    const { visualMode, onboardingComplete, offlineModeEnabled } = req.body ?? {};
    await pool.query(
      `insert into user_settings (user_id, visual_mode, onboarding_complete, offline_mode_enabled)
       values ($1, coalesce($2, 'sentence'), coalesce($3, false), coalesce($4, false))
       on conflict (user_id) do update set
         visual_mode = coalesce($2, user_settings.visual_mode),
         onboarding_complete = coalesce($3, user_settings.onboarding_complete),
         offline_mode_enabled = coalesce($4, user_settings.offline_mode_enabled)`,
      [req.userId, visualMode ?? null, onboardingComplete ?? null, offlineModeEnabled ?? null]
    );
    const { rows } = await pool.query("select * from user_settings where user_id = $1", [req.userId]);
    res.json(toSettings(rows[0]));
  });

  return router;
}
