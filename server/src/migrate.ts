import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

async function main() {
  const pool = createPool();
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
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
