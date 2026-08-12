import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../asyncHandler.js";

/**
 * Anonymous, opt-in session metrics -- backs Settings > "Help improve
 * FlowCue AI" (off by default). See legal/PRIVACY_POLICY.md's "Optional:
 * help improve FlowCue AI" section for the exact commitment this route
 * must keep, and migrations/002_anonymous_metrics.sql for the schema.
 *
 * Two things make this route different from every other one in this
 * server, deliberately:
 *
 * 1. No auth, no req.userId, no script/session ownership check -- there is
 *    nothing here to own. A submission isn't tied to any account.
 * 2. Strict allowlist validation, not just type-checking: an unexpected
 *    field in the body is rejected outright (400), not merely ignored.
 *    Silently dropping unknown fields would let a future client-side bug
 *    (e.g. accidentally spreading in extra session state) add a new field
 *    to the payload without this route ever noticing -- rejecting it
 *    outright fails loudly instead, which matters much more here than on
 *    an ordinary route, since the entire point of this one is to guarantee
 *    nothing beyond these exact fields can ever reach the database.
 *
 * Deliberately does NOT log the requesting IP address anywhere (Express's
 * default request logging isn't enabled in this app, and nothing here adds
 * it) -- see the Privacy Policy's "we do not log the originating IP
 * address" line. That also means this route currently has no per-source
 * abuse/rate-limiting beyond Express's global JSON body-size limit; add
 * one at the infra/edge layer (not by logging IPs here) if abuse ever
 * becomes a real problem.
 */

const SUPPORTED_LANGUAGES = new Set([
  "en-US",
  "es-ES",
  "fr-FR",
  "de-DE",
  "pt-BR",
  "it-IT",
  "nl-NL",
  "hi-IN",
  "ko-KR",
  "ru-RU",
]);
const SUPPORTED_VISUAL_MODES = new Set(["sentence", "focus", "confidence"]);

const EXPECTED_FIELDS = [
  "durationSec",
  "wordCount",
  "wpm",
  "fillerRate",
  "confidence",
  "freezeCount",
  "language",
  "visualMode",
  "usingFallback",
] as const;

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export function metricsRouter(pool: Pool): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};

      const unexpectedFields = Object.keys(body).filter((k) => !(EXPECTED_FIELDS as readonly string[]).includes(k));
      if (unexpectedFields.length > 0) {
        return res.status(400).json({ error: `Unexpected field(s): ${unexpectedFields.join(", ")}` });
      }

      const { durationSec, wordCount, wpm, fillerRate, confidence, freezeCount, language, visualMode, usingFallback } =
        body;

      if (!isFiniteNonNegative(durationSec)) return res.status(400).json({ error: "durationSec must be a finite non-negative number" });
      if (!isFiniteNonNegative(wordCount)) return res.status(400).json({ error: "wordCount must be a finite non-negative number" });
      if (!isFiniteNonNegative(wpm)) return res.status(400).json({ error: "wpm must be a finite non-negative number" });
      if (!isFiniteNonNegative(fillerRate)) return res.status(400).json({ error: "fillerRate must be a finite non-negative number" });
      if (!isFiniteNonNegative(confidence)) return res.status(400).json({ error: "confidence must be a finite non-negative number" });
      if (!isFiniteNonNegative(freezeCount)) return res.status(400).json({ error: "freezeCount must be a finite non-negative number" });
      if (typeof language !== "string" || !SUPPORTED_LANGUAGES.has(language)) {
        return res.status(400).json({ error: "language must be one of the app's supported language codes" });
      }
      if (typeof visualMode !== "string" || !SUPPORTED_VISUAL_MODES.has(visualMode)) {
        return res.status(400).json({ error: "visualMode must be one of sentence, focus, confidence" });
      }
      if (typeof usingFallback !== "boolean") {
        return res.status(400).json({ error: "usingFallback must be a boolean" });
      }

      await pool.query(
        `insert into anonymous_metrics
         (duration_sec, word_count, wpm, filler_rate, confidence, freeze_count, language, visual_mode, using_fallback)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          Math.round(durationSec),
          Math.round(wordCount),
          Math.round(wpm),
          fillerRate,
          confidence,
          Math.round(freezeCount),
          language,
          visualMode,
          usingFallback,
        ]
      );

      res.status(204).end();
    })
  );

  return router;
}
