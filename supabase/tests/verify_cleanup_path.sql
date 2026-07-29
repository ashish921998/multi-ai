-- supabase/tests/verify_cleanup_path.sql
--
-- Regression verification for migration 0004.
--
-- Bug: delete_expired_rooms() matched storage objects by `<roomId>/%`, but
-- uploads live at `rooms/<roomId>/<id>.<ext>` (see upload-screenshot/index.ts),
-- so expired screenshots were never removed from the `screenshots` bucket.
--
-- This script seeds an expired room plus a correctly-pathed storage object,
-- calls delete_expired_rooms(), and asserts the object is gone and exactly one
-- room was deleted. Wrapped in a transaction that rolls back, so re-running it
-- leaves no data behind.
--
-- Run against a local Supabase stack, e.g.:
--   supabase db reset                                       # applies 0001-0004
--   supabase db execute --file supabase/tests/verify_cleanup_path.sql
-- or:
--   psql "$DATABASE_URL" -f supabase/tests/verify_cleanup_path.sql
--
-- Exits non-zero (via exception) if any assertion fails.

begin;

-- Seed: one expired room + one screenshot row + one storage object using the
-- REAL upload path (`rooms/<roomId>/<id>.<ext>`), and one fresh room that must
-- survive.
insert into public.rooms (id, password_hash, expires_at, last_activity_at)
values
  ('ROOMEXPR',
    '{"hash":"x","salt":"y","iterations":1}'::jsonb,
    now() + interval '30 days',
    now() - interval '31 days'),
  ('ROOMFRESH',
    '{"hash":"x","salt":"y","iterations":1}'::jsonb,
    now() + interval '30 days',
    now() - interval '1 day');

insert into public.screenshots (id, room_id, storage_path, mime, width, height, bytes)
values ('shotexpr', 'ROOMEXPR', 'rooms/ROOMEXPR/shotexpr.png', 'image/png', 1, 1, 1);

insert into storage.objects (id, bucket_id, name, owner)
values ('00000000-0000-0000-0000-00000000e1e1', 'screenshots', 'rooms/ROOMEXPR/shotexpr.png', 'postgres');

-- Run the function under test.
do $$
declare
  v_result integer;
  v_remaining integer;
begin
  select public.delete_expired_rooms() into v_result;

  -- Exactly the one expired room was deleted.
  if v_result <> 1 then
    raise exception 'FAIL: expected delete_expired_rooms() to delete 1 room, got %', v_result;
  end if;

  -- The screenshot object at rooms/<roomId>/... was removed.
  select count(*) into v_remaining
  from storage.objects
  where bucket_id = 'screenshots' and name = 'rooms/ROOMEXPR/shotexpr.png';
  if v_remaining <> 0 then
    raise exception 'FAIL: expired screenshot object was not removed (still % rows)', v_remaining;
  end if;

  raise notice 'PASS: delete_expired_rooms() removed the rooms/<roomId>/... storage object and 1 room';
end $$;

-- The fresh room must still be present.
do $$
declare v_alive integer;
begin
  select count(*) into v_alive from public.rooms where id = 'ROOMFRESH';
  if v_alive <> 1 then
    raise exception 'FAIL: fresh (non-expired) room was incorrectly deleted';
  end if;
  raise notice 'PASS: fresh (non-expired) room survived';
end $$;

rollback;
