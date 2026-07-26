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

## Test it

```bash
npm test
```

Tests run against [pg-mem](https://github.com/oguimbal/pg-mem), an in-memory
Postgres-compatible engine, applying the exact same migration files as
production -- so `npm test` needs no Docker/Postgres, but still exercises the
same SQL and route code that runs against real Postgres.

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
