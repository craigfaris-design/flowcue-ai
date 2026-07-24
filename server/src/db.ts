import "dotenv/config";
import { Pool } from "pg";

export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance " +
        "(see docker-compose.yml for local dev: `docker compose up -d`)."
    );
  }
  return new Pool({ connectionString });
}
