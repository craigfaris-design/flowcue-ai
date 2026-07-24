import { Router } from "express";
import type { Pool } from "pg";
import { toScript, toSessionRecord } from "../serializers.js";

export function scriptsRouter(pool: Pool): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { rows } = await pool.query(
      "select * from scripts where user_id = $1 order by updated_at desc",
      [req.userId]
    );
    res.json(rows.map(toScript));
  });

  router.get("/:id", async (req, res) => {
    const { rows } = await pool.query("select * from scripts where id = $1 and user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "Script not found" });
    res.json(toScript(rows[0]));
  });

  router.post("/", async (req, res) => {
    const { title, body } = req.body ?? {};
    if (typeof title !== "string" || typeof body !== "string") {
      return res.status(400).json({ error: "title and body are required strings" });
    }
    const { rows } = await pool.query(
      "insert into scripts (user_id, title, body) values ($1, $2, $3) returning *",
      [req.userId, title, body]
    );
    res.status(201).json(toScript(rows[0]));
  });

  router.patch("/:id", async (req, res) => {
    const { title, body } = req.body ?? {};
    const { rows } = await pool.query(
      `update scripts set
         title = coalesce($3, title),
         body = coalesce($4, body),
         updated_at = now()
       where id = $1 and user_id = $2
       returning *`,
      [req.params.id, req.userId, title ?? null, body ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: "Script not found" });
    res.json(toScript(rows[0]));
  });

  router.patch("/:id/offline-cache", async (req, res) => {
    const { cached } = req.body ?? {};
    if (typeof cached !== "boolean") {
      return res.status(400).json({ error: "cached must be a boolean" });
    }
    const { rows } = await pool.query(
      `update scripts set
         cached_offline = $3,
         cached_at = case when $3 then now() else null end
       where id = $1 and user_id = $2
       returning *`,
      [req.params.id, req.userId, cached]
    );
    if (!rows[0]) return res.status(404).json({ error: "Script not found" });
    res.json(toScript(rows[0]));
  });

  router.delete("/:id", async (req, res) => {
    const result = await pool.query("delete from scripts where id = $1 and user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Script not found" });
    res.status(204).end();
  });

  // Deleting a script cascades to its sessions at the DB level (see migration
  // 001's `on delete cascade`), so callers don't need a separate cleanup step
  // the way the localStorage client does.
  router.get("/:id/sessions", async (req, res) => {
    const owns = await pool.query("select 1 from scripts where id = $1 and user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (owns.rowCount === 0) return res.status(404).json({ error: "Script not found" });
    const { rows } = await pool.query(
      "select * from session_records where script_id = $1 order by date asc",
      [req.params.id]
    );
    res.json(rows.map(toSessionRecord));
  });

  return router;
}
