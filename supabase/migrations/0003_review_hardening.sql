-- 0003_review_hardening.sql
-- Post-review hardening:
--   * One-time connection codes (review #1): a code is consumed exactly once
--     when it activates. agent_connections gains consumed_at, and activation
--     is a guarded UPDATE (... where consumed_at is null) so concurrent
--     connects cannot reuse a code.
--   * Concurrent-handoff guard (review #4): a partial unique index enforces
--     "at most one handoff in flight per room" at the database level, closing
--     the read-then-write race in send-handoff. Active statuses are the set a
--     participant must wait out before starting the next batch (pending,
--     delivered, responding).
--   * Scheduled cleanup (review #3): pg_cron runs delete_expired_rooms hourly.
--     The function now also removes expired rooms' screenshot storage objects,
--     so the scheduled job fully reclaims data without an Edge Function call.

-- ---------------------------------------------------------------------------
-- One-time connection codes
-- ---------------------------------------------------------------------------

alter table public.agent_connections
  add column if not exists consumed_at timestamptz;

-- ---------------------------------------------------------------------------
-- At most one in-flight handoff per room (database-level guarantee)
-- ---------------------------------------------------------------------------

-- A room may hold a single handoff in any of the "active" statuses at a time.
-- send-handoff still does an explicit pre-check for a friendly error, but this
-- index is the hard guarantee: a second insert/update into the active set
-- raises SQLSTATE 23505, which the function maps to HTTP 409.
create unique index if not exists one_active_handoff_per_room
  on public.handoffs (room_id)
  where status in ('pending', 'delivered', 'responding');

-- ---------------------------------------------------------------------------
-- Complete cleanup: rows AND screenshot storage objects
-- ---------------------------------------------------------------------------

create or replace function public.delete_expired_rooms()
returns integer
language plpgsql
security definer
as $$
declare
  v_deleted integer;
begin
  -- Drop screenshot storage objects for rooms about to expire. The function
  -- owner is the postgres superuser, which bypasses storage RLS. Names are
  -- stored bucket-relative as "<roomId>/<objectId>.<ext>".
  delete from storage.objects o
  using public.rooms r
  where r.last_activity_at < now() - interval '30 days'
    and o.bucket_id = 'screenshots'
    and o.name like r.id || '/%';

  with deleted as (
    delete from public.rooms
    where last_activity_at < now() - interval '30 days'
    returning id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule the hourly cleanup via pg_cron
-- ---------------------------------------------------------------------------

-- pg_cron ships with the Supabase image and defaults to the postgres database.
-- Jobs run as the postgres superuser, so delete_expired_rooms (security definer)
-- can clean both tables and storage objects.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('cleanup-expired-rooms');
exception when others then
  -- job does not exist yet on a fresh database — safe to ignore.
  null;
end $$;

select cron.schedule(
  'cleanup-expired-rooms',
  '3 * * * *',                                   -- hourly at :03
  $$select public.delete_expired_rooms();$$
);
