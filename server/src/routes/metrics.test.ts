import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createTestPool } from "../test/testPool.js";

let pool: Pool;
let app: ReturnType<typeof createApp>;

const validPayload = {
  durationSec: 60,
  wordCount: 140,
  wpm: 140,
  fillerRate: 2.5,
  confidence: 90,
  freezeCount: 0,
  language: "en-US",
  visualMode: "sentence",
  usingFallback: false,
};

beforeEach(() => {
  pool = createTestPool();
  app = createApp(pool);
});

describe("POST /api/metrics", () => {
  it("accepts a valid anonymous metrics payload and stores it", async () => {
    await request(app).post("/api/metrics").send(validPayload).expect(204);
    const { rows } = await pool.query("select * from anonymous_metrics");
    expect(rows).toHaveLength(1);
    expect(rows[0].word_count).toBe(140);
    expect(rows[0].language).toBe("en-US");
  });

  it("stores no user/script/session identifier of any kind -- the table has no such column", async () => {
    await request(app).post("/api/metrics").send(validPayload).expect(204);
    const { rows } = await pool.query("select * from anonymous_metrics");
    const columns = Object.keys(rows[0]);
    for (const forbidden of ["user_id", "script_id", "session_id", "device_id", "ip", "ip_address"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("rejects a payload containing any field outside the known allowlist", async () => {
    // Guards the actual privacy property: an unexpected field (e.g. a
    // future client bug accidentally including script text or a
    // transcript) must be refused outright, not silently dropped.
    const res = await request(app)
      .post("/api/metrics")
      .send({ ...validPayload, scriptTitle: "Sarah's Wedding Toast" })
      .expect(400);
    expect(res.body.error).toMatch(/unexpected field/i);

    const { rows } = await pool.query("select * from anonymous_metrics");
    expect(rows).toHaveLength(0);
  });

  it("rejects transcript-shaped content masquerading as a known field", async () => {
    const res = await request(app)
      .post("/api/metrics")
      .send({ ...validPayload, language: "Good evening everyone and thank you" })
      .expect(400);
    expect(res.body.error).toMatch(/language/i);
  });

  it.each(["durationSec", "wordCount", "wpm", "fillerRate", "confidence", "freezeCount"])(
    "rejects a non-numeric %s",
    async (field) => {
      await request(app)
        .post("/api/metrics")
        .send({ ...validPayload, [field]: "not a number" })
        .expect(400);
    }
  );

  it("rejects a negative number for any numeric field", async () => {
    await request(app).post("/api/metrics").send({ ...validPayload, wordCount: -5 }).expect(400);
  });

  it("rejects an unsupported language code", async () => {
    await request(app).post("/api/metrics").send({ ...validPayload, language: "xx-YY" }).expect(400);
  });

  it("rejects an unsupported visual mode", async () => {
    await request(app).post("/api/metrics").send({ ...validPayload, visualMode: "not-a-real-mode" }).expect(400);
  });

  it("rejects a non-boolean usingFallback", async () => {
    await request(app).post("/api/metrics").send({ ...validPayload, usingFallback: "yes" }).expect(400);
  });

  it("accepts every documented supported language", async () => {
    for (const language of ["en-US", "es-ES", "fr-FR", "de-DE", "pt-BR", "it-IT", "nl-NL", "hi-IN", "ko-KR", "ru-RU"]) {
      await request(app).post("/api/metrics").send({ ...validPayload, language }).expect(204);
    }
  });

  it("does not require any authentication or request body beyond the metrics themselves", async () => {
    // No cookies, no auth header, no userId -- this is the one route in
    // the app that's genuinely anonymous/unauthenticated by design.
    await request(app).post("/api/metrics").send(validPayload).expect(204);
  });
});
