import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Pool } from "pg";
import { createPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

// Extracted so index.ts can run this on every server boot (idempotent --
// safe to call on a DB that's already up to date, see the `applied` check
// below) without needing Render's Shell/One-Off Jobs, both paid-tier-only
// features unavailable on the free plan this runs on. Deliberately doesn't
// own the pool's lifecycle (create/end) -- the caller decides that, since
// index.ts's pool needs to stay open for the running server, while the CLI
// entry point below (`npm run migrate`) still wants its own short-lived one.
export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set((await pool.query("select name from _migrations")).rows.map((r) => r.name));
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`Applying migration ${file}...`);
    const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
    await pool.query(sql);
    await pool.query("insert into _migrations (name) values ($1)", [file]);
  }

  console.log("Migrations up to date.");
}

// CLI entry point (`npm run migrate`) -- only runs when this file is
// executed directly, not when index.ts imports runMigrations from it.
// Must go through pathToFileURL rather than a manual `file://` template:
// process.argv[1] is a plain OS path (backslashes on Windows), while
// import.meta.url is always a properly-escaped file:// URL, so a naive
// string comparison never matches on Windows and this guard silently
// never fires there.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
