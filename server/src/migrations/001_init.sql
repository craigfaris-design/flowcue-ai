-- Script Service schema (Technical Architecture doc, §4.1).
-- gen_random_uuid() is native to Postgres core since v13 -- no extension needed.
--
-- No real auth yet (Auth & Billing is a deferred component pending the managed
-- auth provider decision). Every table carries a user_id scoped to a single
-- dev placeholder user for now, so wiring in real auth later means swapping
-- the auth middleware, not reshaping these tables.

create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  title text not null,
  body text not null,
  cached_offline boolean not null default false,
  cached_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scripts_user_id on scripts (user_id);

create table if not exists session_records (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts (id) on delete cascade,
  date timestamptz not null,
  duration_sec double precision not null,
  word_count integer not null,
  filler_count integer not null,
  wpm integer not null,
  filler_rate double precision not null,
  confidence double precision not null
);

create index if not exists idx_session_records_script_id on session_records (script_id);

create table if not exists user_settings (
  user_id uuid primary key default '00000000-0000-0000-0000-000000000001',
  visual_mode text not null default 'sentence',
  onboarding_complete boolean not null default false,
  offline_mode_enabled boolean not null default false
);
