-- 0004_fix_screenshot_cleanup_path.sql
--
-- Fixes a bug introduced in migration 0003: delete_expired_rooms() matched
-- storage objects by `o.name like r.id || '/%'`, but screenshot uploads are
-- stored under a bucket-relative path of `rooms/<roomId>/<id>.<ext>` (see
-- supabase/functions/upload-screenshot/index.ts: `rooms/${roomId}/${id}.${ext}`).
-- The missing `rooms/` prefix meant the LIKE never matched, so expired rooms'
-- screenshot objects were left behind in the `screenshots` storage bucket even
-- though their database rows were deleted.
--
-- This migration corrects the match while preserving every other behavior:
--   * deletes the expired rooms' screenshot storage objects,
--   * deletes the expired rooms and their cascading database records,
--   * returns the number of deleted rooms,
--   * is safe to run repeatedly (idempotent: a second run deletes nothing).
--
-- Note on precedence: in PostgreSQL, `||` binds tighter than `LIKE`, so
-- `o.name LIKE 'rooms/' || r.id || '/%'` is parsed as
-- `o.name LIKE ('rooms/' || r.id || '/%')`.

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
  -- stored bucket-relative as "rooms/<roomId>/<objectId>.<ext>".
  delete from storage.objects o
  using public.rooms r
  where r.last_activity_at < now() - interval '30 days'
    and o.bucket_id = 'screenshots'
    and o.name like 'rooms/' || r.id || '/%';

  with deleted as (
    delete from public.rooms
    where last_activity_at < now() - interval '30 days'
    returning id
  )
  select count(*) into v_deleted from deleted;
  return v_deleted;
end;
$$;
