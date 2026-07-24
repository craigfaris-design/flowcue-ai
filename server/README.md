# FlowCue AI -- Backend (Script Service)

Scaffolding for the "Script Service" component from the Technical Architecture
doc (§4.1): CRUD for scripts, session records, and settings, backed by
PostgreSQL. This is the swap target for `webapp/src/lib/storage.ts`, which is
currently a `localStorage`-backed stand-in used deliberately through beta (see
the Decision Log).

Scope note: this covers persistence only. The Realtime Gateway, Sync Engine
Service, and Auth & Billing components from the architecture doc are separate,
later milestones -- not part of this scaffold. There is no real auth yet;
every request is scoped to a single placeholder dev user (`src/devUser.ts`).

## Run it locally

Requires Docker (for Postgres) and Node.

```bash
docker compose up -d        # starts Postgres on localhost:5432
cp .env.example .env
npm install
npm run migrate             # applies src/migrations/*.sql
npm run dev                 # starts the API on http://localhost:4000
```

## Test it

```bash
npm test
```

Tests run against [pg-mem](https://github.com/oguimbal/pg-mem), an in-memory
Postgres-compatible engine, applying the exact same migration files as
production -- so `npm test` needs no Docker/Postgres, but still exercises the
same SQL and route code that runs against real Postgres.

## API

All routes are scoped to the current dev user.

| Method | Path                          | Notes                          |
|--------|-------------------------------|---------------------------------|
| GET    | `/health`                     | liveness check                 |
| GET    | `/api/scripts`                | list, newest-updated first     |
| GET    | `/api/scripts/:id`            |                                 |
| POST   | `/api/scripts`                | `{ title, body }`               |
| PATCH  | `/api/scripts/:id`            | `{ title?, body? }`             |
| PATCH  | `/api/scripts/:id/offline-cache` | `{ cached: boolean }`        |
| DELETE | `/api/scripts/:id`            | cascades its sessions           |
| GET    | `/api/scripts/:id/sessions`   | sorted by date ascending        |
| POST   | `/api/sessions`               | `{ scriptId, date, durationSec, wordCount, fillerCount, wpm, fillerRate, confidence }` |
| GET    | `/api/settings`               | creates defaults on first read  |
| PATCH  | `/api/settings`               | `{ visualMode?, onboardingComplete?, offlineModeEnabled? }` |

Response shapes match `webapp/src/lib/types.ts` exactly (camelCase), so a
future async `apiStorage.ts` client can implement the same function
signatures as `storage.ts` today.

## What's deliberately not here yet

- **Auth.** The Technical Architecture doc calls for a managed provider
  (Auth0/Clerk) -- an account/billing decision outside engineering scope.
  `devUser.ts` is the seam: replace the auth middleware in `app.ts`, not the
  routes, when that's decided.
- **Cloud deployment.** Cloud provider (AWS recommended) is still an open
  decision in the Decision Log. This scaffold runs anywhere Postgres does --
  local Docker today, RDS/Aurora later, no code change required, just a
  `DATABASE_URL`.
- **Frontend wiring.** The webapp still runs on `localStorage` by default,
  per the beta decision already on record. Pointing `ScriptWorkspace`/`App`
  at this API is a separate, deliberate follow-up (it also means converting
  those components' synchronous reads to async).
