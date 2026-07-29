-- 0002_reap_and_vision.sql
-- Follow-ups from code review:
--   * reap_stale_agent: one place that marks a room's timed-out active agent
--     disconnected. Replaces copy-pasted blocks in send-handoff / agent-connect /
--     room-state (issue 0006).
--   * supports_vision: the active agent declares whether its model can receive
--     image inputs, so non-vision agents get text-only handoffs with a clear
--     limitation note instead of screenshots (issue 0005).

create or replace function public.reap_stale_agent(
  p_room_id text,
  p_timeout_ms integer default 30000
)
returns void
language sql
security definer
as $$
  update public.agent_connections
  set status = 'disconnected', released_at = now()
  where room_id = p_room_id
    and status = 'active'
    and last_heartbeat_at < now() - make_interval(secs => p_timeout_ms / 1000.0);
$$;

alter table public.agent_connections
  add column if not exists supports_vision boolean not null default false;
