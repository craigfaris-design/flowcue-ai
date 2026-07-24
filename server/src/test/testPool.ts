import { randomUUID } from "crypto";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { newDb, DataType } from "pg-mem";
import type { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

// Backs tests with an in-memory Postgres-compatible engine speaking the real
// `pg` wire interface, so route code under test is identical to what runs
// against real Postgres -- no Docker required to run `npm test`. Applies the
// same migration files production uses, so schema drift between test and
// prod is caught here rather than only in a real DB.
export function createTestPool(): Pool {
  const db = newDb();
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    // Without this, pg-mem treats the default-value expression as constant and
    // reuses the same generated id across rows in a batch -- causing spurious
    // primary-key collisions on the second insert.
    impure: true,
  });

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.public.none(readFileSync(path.join(migrationsDir, file), "utf-8"));
  }

  const { Pool: MemPool } = db.adapters.createPg();
  return new MemPool();
}
