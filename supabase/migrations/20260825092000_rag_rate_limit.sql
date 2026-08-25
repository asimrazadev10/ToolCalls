-- Rate limiting that survives more than one instance.
--
-- The weather agent's limiter keeps its counters in process memory. On a
-- single instance that is correct; across N of them the "global" window
-- becomes per-instance and the provider ceiling is overrun by a factor of N —
-- precisely what the limiter exists to prevent. Postgres is the only thing
-- every instance already shares, so the counter belongs here.

create table if not exists rag.rate_limit_windows (
  bucket             text primary key,
  window_started_at  timestamptz not null,
  request_count      integer     not null
);

alter table rag.rate_limit_windows enable row level security;
-- No policies and no grants: this is infrastructure, not user data. Only the
-- definer function below touches it, and a signed-in user reading the table
-- directly is refused at the grant layer.

-- Claims one slot, atomically.
--
-- The bucket is derived from auth.uid() rather than accepted as an argument.
-- A caller-supplied bucket would let anyone spend somebody else's allowance,
-- which is a denial-of-service handed out with the API.
--
-- SECURITY DEFINER because the counter table is deliberately unreachable by
-- any user. The function grants exactly one capability — spend one of my own
-- slots — and cannot be pointed at another tenant.
create or replace function rag.claim_request_slot(
  operation       text,
  max_requests    integer,
  window_seconds  integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller        uuid := auth.uid();
  claimed_count integer;
  started_at    timestamptz;
begin
  if caller is null then
    raise exception 'rate limiting requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- One statement, so two concurrent requests cannot both read a stale count
  -- and both decide they are under the limit. The conflicting row is locked
  -- for the duration of the update.
  insert into rag.rate_limit_windows as existing (bucket, window_started_at, request_count)
  values (caller::text || ':' || operation, now(), 1)
  on conflict (bucket) do update
  set window_started_at =
        case
          when existing.window_started_at < now() - make_interval(secs => window_seconds)
          then now()
          else existing.window_started_at
        end,
      request_count =
        case
          when existing.window_started_at < now() - make_interval(secs => window_seconds)
          then 1
          else existing.request_count + 1
        end
  returning existing.request_count, existing.window_started_at
  into claimed_count, started_at;

  return query
  select
    claimed_count <= max_requests,
    greatest(
      1,
      ceil(extract(epoch from (started_at + make_interval(secs => window_seconds)) - now()))::integer
    );
end;
$$;

revoke all on function rag.claim_request_slot(text, integer, integer) from public;
grant execute on function rag.claim_request_slot(text, integer, integer) to authenticated;
