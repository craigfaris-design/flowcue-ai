-- Anonymous, opt-in session metrics (Settings > "Help improve FlowCue AI").
-- Deliberately has NO user_id, NO script_id, and no column of any kind that
-- could link a row back to a specific user, device, or session -- see
-- legal/PRIVACY_POLICY.md's "Optional: help improve FlowCue AI" section,
-- which promises exactly that. Every column is a number, boolean, or short
-- bounded value from a known small set -- never free text, never a
-- transcript, never script content. The route inserting into this
-- (routes/metrics.ts) enforces that same shape server-side; this schema is
-- the second, structural half of that guarantee -- there is simply no
-- column here a transcript or identifier could be smuggled into.

create table if not exists anonymous_metrics (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  duration_sec integer not null,
  word_count integer not null,
  wpm integer not null,
  filler_rate double precision not null,
  confidence double precision not null,
  freeze_count integer not null,
  language text not null,
  visual_mode text not null,
  using_fallback boolean not null
);

create index if not exists idx_anonymous_metrics_received_at on anonymous_metrics (received_at);
