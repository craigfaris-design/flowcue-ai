import { Router } from "express";
import type { Pool } from "pg";
import { toSessionRecord } from "../serializers.js";
import { asyncHandler } from "../asyncHandler.js";

const NUMERIC_FIELDS = ["durationSec", "wordCount", "fillerCount", "wpm", "fillerRate", "confidence"] as const;

export function sessionsRouter(pool: Pool): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { scriptId, date, durationSec, wordCount, fillerCount, wpm, fillerRate, confidence } = req.body ?? {};
      if (typeof scriptId !== "string" || typeof date !== "string") {
        return res.status(400).json({ error: "scriptId and date are required" });
      }
      // Found via code review: these six columns are all `not null` in the
      // schema, but were previously inserted as-is with no validation --
      // omitting one, or sending a string/null/object, throws a Postgres
      // not-null/type-coercion error that (before the error-handling
      // middleware added alongside this fix) crashed the whole server.
      const values = { durationSec, wordCount, fillerCount, wpm, fillerRate, confidence };
      for (const field of NUMERIC_FIELDS) {
        if (typeof values[field] !== "number" || !Number.isFinite(values[field])) {
          return res.status(400).json({ error: `${field} must be a finite number` });
        }
      }

      const owns = await pool.query("select 1 from scripts where id = $1 and user_id = $2", [
        scriptId,
        req.userId,
      ]);
      if (owns.rowCount === 0) return res.status(404).json({ error: "Script not found" });

      const { rows } = await pool.query(
        `insert into session_records
         (script_id, date, duration_sec, word_count, filler_count, wpm, filler_rate, confidence)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
        [scriptId, date, durationSec, wordCount, fillerCount, wpm, fillerRate, confidence]
      );
      res.status(201).json(toSessionRecord(rows[0]));
    })
  );

  return router;
}
