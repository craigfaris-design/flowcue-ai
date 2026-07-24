import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "./app.js";
import { createTestPool } from "./test/testPool.js";

let pool: Pool;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  pool = createTestPool();
  app = createApp(pool);
});

describe("scripts", () => {
  it("creates and lists scripts", async () => {
    await request(app).post("/api/scripts").send({ title: "Wedding Toast", body: "Hello everyone." }).expect(201);

    const res = await request(app).get("/api/scripts").expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Wedding Toast");
    expect(res.body[0].cachedOffline).toBe(false);
  });

  it("rejects a script missing title/body", async () => {
    await request(app).post("/api/scripts").send({ title: "Only a title" }).expect(400);
  });

  it("gets a single script by id, 404s for an unknown one", async () => {
    const created = await request(app).post("/api/scripts").send({ title: "T", body: "B" });
    await request(app).get(`/api/scripts/${created.body.id}`).expect(200);
    await request(app).get("/api/scripts/00000000-0000-0000-0000-000000000099").expect(404);
  });

  it("updates a script's body and bumps updatedAt", async () => {
    const created = await request(app).post("/api/scripts").send({ title: "Toast", body: "v1" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await request(app).patch(`/api/scripts/${created.body.id}`).send({ body: "v2" }).expect(200);
    expect(updated.body.body).toBe("v2");
    expect(updated.body.updatedAt).not.toBe(created.body.updatedAt);
  });

  it("toggles offline cache flag", async () => {
    const created = await request(app).post("/api/scripts").send({ title: "Toast", body: "body" });
    const res = await request(app)
      .patch(`/api/scripts/${created.body.id}/offline-cache`)
      .send({ cached: true })
      .expect(200);
    expect(res.body.cachedOffline).toBe(true);
    expect(res.body.cachedAt).toBeDefined();
  });

  it("deletes a script and cascades its sessions", async () => {
    const created = await request(app).post("/api/scripts").send({ title: "Toast", body: "body" });
    await request(app)
      .post("/api/sessions")
      .send({
        scriptId: created.body.id,
        date: new Date().toISOString(),
        durationSec: 30,
        wordCount: 80,
        fillerCount: 2,
        wpm: 140,
        fillerRate: 2.5,
        confidence: 90,
      })
      .expect(201);

    await request(app).delete(`/api/scripts/${created.body.id}`).expect(204);
    await request(app).get(`/api/scripts/${created.body.id}`).expect(404);
    await request(app).get(`/api/scripts/${created.body.id}/sessions`).expect(404);
  });
});

describe("sessions", () => {
  it("stores sessions per script and returns them sorted by date", async () => {
    const created = await request(app).post("/api/scripts").send({ title: "Toast", body: "body" });
    const scriptId = created.body.id;

    await request(app)
      .post("/api/sessions")
      .send({
        scriptId,
        date: "2026-01-02T00:00:00.000Z",
        durationSec: 30,
        wordCount: 80,
        fillerCount: 2,
        wpm: 140,
        fillerRate: 2.5,
        confidence: 90,
      })
      .expect(201);
    await request(app)
      .post("/api/sessions")
      .send({
        scriptId,
        date: "2026-01-01T00:00:00.000Z",
        durationSec: 30,
        wordCount: 80,
        fillerCount: 2,
        wpm: 140,
        fillerRate: 2.5,
        confidence: 85,
      })
      .expect(201);

    const res = await request(app).get(`/api/scripts/${scriptId}/sessions`).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].date).toBe("2026-01-01T00:00:00.000Z");
  });

  it("404s when the referenced script doesn't exist", async () => {
    await request(app)
      .post("/api/sessions")
      .send({ scriptId: "00000000-0000-0000-0000-000000000099", date: new Date().toISOString() })
      .expect(404);
  });
});

describe("settings", () => {
  it("returns defaults on first read, then persists updates", async () => {
    const res = await request(app).get("/api/settings").expect(200);
    expect(res.body.onboardingComplete).toBe(false);
    expect(res.body.visualMode).toBe("sentence");

    await request(app).patch("/api/settings").send({ onboardingComplete: true, visualMode: "word" }).expect(200);

    const updated = await request(app).get("/api/settings").expect(200);
    expect(updated.body.onboardingComplete).toBe(true);
    expect(updated.body.visualMode).toBe("word");
  });
});
