import { Router } from "express";
import type { Pool } from "pg";
import { toSettings } from "../serializers.js";
import { asyncHandler } from "../asyncHandler.js";

const VALID_VISUAL_MODES = new Set(["sentence", "word", "focus", "confidence"]);

export function settingsRouter(pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query("select * from user_settings where user_id = $1", [req.userId]);
      if (rows[0]) return res.json(toSettings(rows[0]));

      const inserted = await pool.query("insert into user_settings (user_id) values ($1) returning *", [
        req.userId,
      ]);
      res.json(toSettings(inserted.rows[0]));
    })
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const { visualMode, onboardingComplete, offlineModeEnabled } = req.body ?? {};
      // Found via code review alongside the same gap in the scripts/sessions
      // routes: an unvalidated value bound as a query parameter can throw on
      // the wrong type, which (before the error-handling middleware added
      // alongside this fix) crashed the whole server rather than returning
      // a 400 for the one bad request.
      if (visualMode !== undefined && !VALID_VISUAL_MODES.has(visualMode)) {
        return res.status(400).json({ error: "visualMode must be one of: " + [...VALID_VISUAL_MODES].join(", ") });
      }
      if (onboardingComplete !== undefined && typeof onboardingComplete !== "boolean") {
        return res.status(400).json({ error: "onboardingComplete must be a boolean" });
      }
      if (offlineModeEnabled !== undefined && typeof offlineModeEnabled !== "boolean") {
        return res.status(400).json({ error: "offlineModeEnabled must be a boolean" });
      }
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
    })
  );

  return router;
}
