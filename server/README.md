# FlowCue AI -- Backend

Two independent pieces live here:

1. **Script Service** -- CRUD for scripts, session records, and settings,
   backed by PostgreSQL, per the Technical Architecture doc (§4.1). This is
   the swap target for `webapp/src/lib/storage.ts`, which is currently a
   `localStorage`-backed stand-in used deliberately through beta (see the
   Decision Log). Requires `DATABASE_URL`.
2. **Deepgram STT relay** (`src/sttRelay.ts`) -- a dumb WebSocket
   byte-forwarder between the webapp and Deepgram's real-time streaming API,
   so the Deepgram API key never reaches the browser. Requires
   `DEEPGRAM_API_KEY`. Does not touch the database at all.

These are deliberately decoupled: `DATABASE_URL` is optional (see `db.ts`),
so the STT relay works with no Postgres set up, and vice versa.

Scope note: the Realtime Gateway (beyond STT), Sync Engine Service, and Auth
& Billing components from the architecture doc are separate, later
milestones -- not part of this scaffold. There is no real auth yet; every
Script Service request is scoped to a single placeholder dev user
(`src/devUser.ts`).

## Run it locally

Requires Node. Docker (for Postgres) is only needed if you're working on the
Script Service.

```bash
docker compose up -d        # starts Postgres on localhost:5432 -- skip if you only need the STT relay
cp .env.example .env
npm install
npm run migrate             # applies src/migrations/*.sql -- skip if you only need the STT relay
npm run dev                 # starts the server on http://localhost:4000
```

### Enabling low-latency speech recognition (Deepgram)

The webapp's live cueing defaults to the browser's built-in speech
recognition, which has no SLA and no offline mode (see the Technical
Architecture doc's rationale). To use Deepgram instead:

1. Create a free account at https://console.deepgram.com and copy an API key.
2. Add it to `.env`: `DEEPGRAM_API_KEY=your-key-here`.
3. Restart this server (`npm run dev`).

That's it -- the webapp detects Deepgram is reachable and configured
automatically; no webapp-side config needed. If it's unreachable or
unconfigured, live cueing falls back to the browser's built-in recognizer
without breaking, and the UI says so ("browser fallback").

If the webapp is served over HTTPS (required for phone/LAN testing --
see webapp/README.md), this server also needs `HTTPS=true` in `.env`, or the
browser will block the relay connection as mixed content (a secure page
can't open a plain `ws://` connection).

## Deploying to production

`Dockerfile` builds a production image (multi-stage: compiles TypeScript,
then ships only `dist/` + prod deps). To build and smoke-test it locally:

```bash
docker compose --profile full up --build   # postgres + server, both in Docker
```

For a real host (Fly.io, Render, Railway, a VM -- anywhere that can run a
Docker image and reach a Postgres instance), you need to set in that
platform's environment/secrets:

- `DATABASE_URL` -- pointed at a real Postgres instance (managed or
  self-hosted; `db.ts` doesn't care which).
- `DEEPGRAM_API_KEY` -- same key as local dev.
- `PORT` -- whatever the platform expects the app to listen on.
- Leave `HTTPS` unset (or `false`) in production -- TLS termination is the
  platform's job (its load balancer/reverse proxy), not this process's; see
  the comment in `Dockerfile` and `src/index.ts`.

Then run the migration once against the production database before the app's
first request (`DATABASE_URL=<prod-url> npm run migrate`, from a machine that
can reach it -- there's no auto-migrate-on-boot by design, so a bad migration
can't take down a running deploy).

This is the last piece before FlowCue AI is reachable by anyone other than
someone running it locally -- see `webapp/DEPLOYMENT.md` for the matching
piece on the frontend side. If the webapp and this server end up on
different domains (e.g. webapp on Netlify, this on Render/Fly -- the
likely setup, since `webapp/DEPLOYMENT.md`'s options are all frontend-only
static hosts), set `VITE_STT_RELAY_URL` in the webapp's build environment to
this server's real `wss://` URL (see `webapp/.env.example`) -- otherwise the
webapp assumes the relay is on its own hostname and the connection silently
fails to reach it.

## Test it

```bash
npm test
```

Tests run against [pg-mem](https://github.com/oguimbal/pg-mem), an in-memory
Postgres-compatible engine, applying the exact same migration files as
production -- so `npm test` needs no Docker/Postgres, but still exercises the
same SQL and route code that runs against real Postgres.

12 tests currently pass, including two added under a security/robustness
review: a malformed id (or any other DB-level error) now returns a clean 500
instead of crashing the whole process, and `PATCH /api/scripts/:id`/
`POST /api/sessions` reject a wrong-shaped body with a 400 instead of
reaching the database at all. See "Hardening" below for the full list of
fixes that review found.

## Hardening

A security/robustness review (this beta had never had one) found and fixed:

- **Any DB-level error used to crash the entire process**, not just fail the
  one request -- Express 4 doesn't forward an async handler's rejection to
  error middleware on its own. Every route is now wrapped in
  `asyncHandler.ts`, and `app.ts` registers a final error-handling
  middleware that returns a 500 instead.
- `PATCH /api/scripts/:id` and `PATCH /api/settings` accepted any JSON type
  for their fields with no validation (unlike `POST`, which already
  checked) -- both now validate types the same way `POST` does.
- `POST /api/sessions` didn't validate its numeric fields, so a
  missing/wrong-type field threw a Postgres not-null/type error -- now
  validated up front with a 400.
- The STT relay (`sttRelay.ts`) had no `maxPayload` (the `ws` default is
  100MB per frame) and no cap on concurrent connections, each of which
  holds open a real connection to Deepgram against this beta's single
  shared API key/quota -- both are now bounded.

Confirmed clean in that same review: the Deepgram API key never leaks into
any client-visible response/log, all SQL is parameterized (no injection
risk), and every route correctly scopes to the current dev user.

## API

### STT relay

| Path              | Notes                                                        |
|-------------------|---------------------------------------------------------------|
| `WS /api/stt-relay` | Binary audio frames in (webm/opus, from MediaRecorder), Deepgram's JSON transcript messages relayed straight back out. No auth/session concept -- just a byte pipe. |

### Script Service

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
