import { Router } from "express";
import type { Pool } from "pg";
import { toSessionRecord } from "../serializers.js";

export function sessionsRouter(pool: Pool): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const { scriptId, date, durationSec, wordCount, fillerCount, wpm, fillerRate, confidence } = req.body ?? {};
    if (typeof scriptId !== "string" || typeof date !== "string") {
      return res.status(400).json({ error: "scriptId and date are required" });
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
  });

  return router;
}
