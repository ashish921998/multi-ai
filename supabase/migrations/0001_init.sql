-- 0001_init.sql
-- Multiplayer AI Planning Room V1 — schema, row-level security, sequence
-- allocator, activity tracking, storage bucket, and 30-day cleanup.
--
-- Design notes (see docs/v1-room-backend-handoff.md):
--   * The room id is the human code (e.g. K7Q9FXM2PW). It is the primary key.
--   * Only hashes are persisted: room passwords and connection codes use PBKDF2
--     (computed in the Edge Functions via @multi-ai/shared), session tokens use
--     SHA-256 (high-entropy random, no stretching needed).
--   * Messages carry a per-room monotonic sequence number. Sequence allocation
--     is an atomic upsert on room_seq so concurrent posts cannot collide.
--   * RLS denies direct access to every table from the anon/authenticated roles.
--     All reads and writes go through Edge Functions using the service role,
--     which bypasses RLS. Browsers receive only opaque realtime tickers.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id              text primary key,
  title           text not null default 'Planning room',
  password_hash   jsonb not null,           -- { hash, salt, iterations }
  created_at      timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at      timestamptz not null,     -- created_at + 30d
  creator_ip_hash text,                      -- sha256(ip) for creation rate limiting
  handoff_boundary bigint not null default 0  -- messages with seq > this are new context
);

create table if not exists public.participants (
  id               text primary key,
  room_id          text not null references public.rooms(id) on delete cascade,
  display_name     text not null,
  session_token_hash text not null,          -- sha256(opaque token)
  joined_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  ip_hash          text,
  unique (room_id, display_name)
);

create table if not exists public.messages (
  id            text primary key,
  room_id       text not null references public.rooms(id) on delete cascade,
  seq           bigint not null,
  author_kind   text not null check (author_kind in ('participant','agent')),
  author_participant_id   text references public.participants(id) on delete set null,
  author_agent_connection_id text,
  text          text not null default '',
  status        text not null default 'complete' check (status in ('streaming','complete')),
  created_at    timestamptz not null default now(),
  unique (room_id, seq)
);

create table if not exists public.screenshots (
  id          text primary key,
  room_id     text not null references public.rooms(id) on delete cascade,
  message_id  text references public.messages(id) on delete cascade,
  storage_path text not null,                 -- rooms/<roomId>/<id>.<ext>
  mime        text not null,
  width       integer not null,
  height      integer not null,
  bytes       bigint not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.agent_connections (
  id                 text primary key,
  room_id            text not null references public.rooms(id) on delete cascade,
  participant_id     text not null references public.participants(id) on delete cascade,
  connection_code_hash jsonb not null,        -- { hash, salt, iterations }
  status             text not null default 'active' check (status in ('active','disconnected')),
  last_heartbeat_at  timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  released_at        timestamptz not null default now()
);

-- A room has at most one active agent connection at a time (issue 0006).
create unique index if not exists one_active_agent_per_room
  on public.agent_connections (room_id)
  where status = 'active';

create table if not exists public.handoffs (
  id                  text primary key,
  room_id             text not null references public.rooms(id) on delete cascade,
  boundary_seq        bigint not null,         -- messages with seq > this included
  next_boundary_seq   bigint not null,         -- boundary the room advances to on delivery
  included_seqs       bigint[] not null default '{}',
  status              text not null default 'pending'
    check (status in ('pending','delivered','responding','complete','failed')),
  agent_connection_id text references public.agent_connections(id) on delete set null,
  agent_message_id    text references public.messages(id) on delete set null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

-- Per-room monotonic sequence allocator.
create table if not exists public.room_seq (
  room_id  text primary key references public.rooms(id) on delete cascade,
  next_seq bigint not null default 1
);

-- Generic per-window rate-limit counters (issue 0007).
create table if not exists public.rate_buckets (
  scope       text not null,                  -- e.g. 'room_create', 'join_fail', 'message'
  key         text not null,                  -- e.g. ip hash or participant id
  count       integer not null default 0,
  window_start bigint not null,               -- epoch ms
  primary key (scope, key)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists messages_room_seq_idx
  on public.messages (room_id, seq);
create index if not exists participants_room_idx
  on public.participants (room_id);
create index if not exists agent_connections_room_idx
  on public.agent_connections (room_id);
create index if not exists handoffs_room_idx
  on public.handoffs (room_id);
create index if not exists rooms_activity_idx
  on public.rooms (last_activity_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.rooms enable row level security;
  alter table public.participants enable row level security;
  alter table public.messages enable row level security;
  alter table public.screenshots enable row level security;
  alter table public.agent_connections enable row level security;
  alter table public.handoffs enable row level security;
  alter table public.room_seq enable row level security;
  alter table public.rate_buckets enable row level security;
end $$;

-- Deny all direct table access to the anon and authenticated roles. The service
-- role bypasses RLS, so Edge Functions (which hold the service role key) can
-- still read and write. Browsers hold only the anon key and must go through the
-- functions for any content; realtime carries only opaque tickers.
do $$
declare
  t text;
begin
  foreach t in array array[
    'rooms','participants','messages','screenshots',
    'agent_connections','handoffs','room_seq','rate_buckets'
  ] loop
    execute format('drop policy if exists anon_deny_all on public.%I;', t);
    execute format(
      'create policy anon_deny_all on public.%1$I for all using (false) with check (false);',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Atomically allocates and returns the next sequence number for a room.
create or replace function public.allocate_message_seq(p_room_id text)
returns bigint
language plpgsql
security definer
as $$
declare
  v_next bigint;
begin
  insert into public.room_seq (room_id, next_seq)
  values (p_room_id, 2)
  on conflict (room_id)
  do update set next_seq = public.room_seq.next_seq + 1
  returning public.room_seq.next_seq - 1 into v_next;
  return v_next;
end;
$$;

-- Bumps the room's last_activity_at, used for 30-day inactivity expiry.
create or replace function public.touch_room_activity(p_room_id text)
returns void
language sql
security definer
as $$
  update public.rooms set last_activity_at = now() where id = p_room_id;
$$;

create or replace function public.touch_participant_seen(p_participant_id text)
returns void
language sql
security definer
as $$
  update public.participants set last_seen_at = now() where id = p_participant_id;
$$;

-- Deletes rooms (and all cascading data) that have been inactive for 30 days.
-- Run by the cleanup Edge Function on a schedule.
create or replace function public.delete_expired_rooms()
returns integer
language plpgsql
security definer
as $$
declare
  v_deleted integer;
begin
  with deleted as (
    delete from public.rooms
    where last_activity_at < now() - interval '30 days'
    returning id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

-- Bumps activity whenever a message or handoff is written.
create or replace function public.message_activity_trigger()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.touch_room_activity(new.room_id);
  return new;
end;
$$;

drop trigger if exists trg_messages_activity on public.messages;
create trigger trg_messages_activity
  after insert on public.messages
  for each row execute function public.message_activity_trigger();

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private screenshot bucket. Objects are only reachable via short-lived signed
-- URLs issued by the signed-url Edge Function after session validation.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Only the service role (Edge Functions) may write screenshot objects. The
-- signed-url function reads with the service role to mint signed URLs.
do $$
begin
  drop policy if exists screenshots_service_write on storage.objects;
  execute 'create policy screenshots_service_write on storage.objects '
          'for all to anon, authenticated '
          'using (bucket_id = ''screenshots'' and false) '
          'with check (bucket_id = ''screenshots'' and false);';
end $$;
