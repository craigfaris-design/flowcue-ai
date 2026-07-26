import "dotenv/config";
import { Pool } from "pg";

export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Don't hard-fail server startup over a missing database: features that
    // don't touch it (the Deepgram STT relay, for one) shouldn't require
    // Postgres to be set up first. `pg.Pool` connects lazily, so this is
    // inert until something actually queries it -- at which point it fails
    // with a normal, clear connection error, scoped to just that request.
    return new Pool({ connectionString: "postgres://unconfigured/unconfigured" });
  }
  return new Pool({ connectionString });
}
