-- Resumable ingestion.
--
-- Embedding a long document cannot finish inside one request: it costs a model
-- call for every fifty chunks against a budget measured in calls per minute.
-- The usual answer is a queue and a background worker — which has no user
-- token, and so needs a credential that can reach every tenant. This system
-- has avoided holding one, and that is worth keeping.
--
-- Instead the progress lives in the database. A chunk without an embedding IS
-- the work queue, so any client holding the owner's own token can pick the job
-- up: the same tab, a new tab, or a different device tomorrow. Nothing is lost
-- when a browser closes or a quota window runs out; the document simply stays
-- in `embedding` until someone resumes it.
--
-- Three functions:
--   store_document_chunks   embeddings became optional, so chunks land first
--   next_unembedded_chunks  the queue, read under the caller's own RLS
--   store_chunk_embeddings  one batch of vectors, reporting what is left
--
-- Only the two writers need definer rights, and both re-establish the
-- ownership check RLS would have made. The queue reader is SECURITY INVOKER
-- because a user can already only see their own chunks, so it cannot be
-- pointed at anyone else's document.
--
-- A note on the enum: `set status = case ... end` is typed text, unlike a bare
-- literal which coerces, so the case expression is cast explicitly. Without
-- the cast the function creates cleanly and fails on first call.


create or replace function rag.store_document_chunks(
  target_document_id uuid,
  chunks             jsonb
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  calling_user   uuid := auth.uid();
  document_owner uuid;
  stored         integer;
  awaiting       integer;
begin
  if calling_user is null then
    raise exception 'store_document_chunks requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  select d.owner_id into document_owner from rag.documents d where d.id = target_document_id;
  if document_owner is null then
    raise exception 'document % does not exist', target_document_id using errcode = 'no_data_found';
  end if;
  if document_owner <> calling_user then
    raise exception 'document % belongs to another owner', target_document_id
      using errcode = 'insufficient_privilege';
  end if;

  delete from rag.chunks c where c.document_id = target_document_id;

  with incoming as (
    select
      (value ->> 'ordinal')::integer     as ordinal,
      value ->> 'content'                as content,
      (value ->> 'token_count')::integer as token_count,
      coalesce((select array_agg(heading)
                from jsonb_array_elements_text(value -> 'heading_path') as heading),
               '{}'::text[])             as heading_path,
      (value ->> 'page_from')::integer   as page_from,
      (value ->> 'page_to')::integer     as page_to,
      value ->> 'embedding'              as embedding
    from jsonb_array_elements(chunks) as value
  ),
  inserted as (
    insert into rag.chunks
      (document_id, owner_id, ordinal, content, token_count, heading_path, page_from, page_to)
    select target_document_id, calling_user, i.ordinal, i.content, i.token_count,
           i.heading_path, i.page_from, i.page_to
    from incoming i
    returning id, ordinal
  )
  insert into rag.embeddings (chunk_id, owner_id, embedding, model_id)
  select ins.id, calling_user, i.embedding::extensions.halfvec, 'gemini-embedding-001'
  from inserted ins join incoming i on i.ordinal = ins.ordinal
  where i.embedding is not null;

  select count(*) into stored from rag.chunks c where c.document_id = target_document_id;
  select count(*) into awaiting
  from rag.chunks c left join rag.embeddings e on e.chunk_id = c.id
  where c.document_id = target_document_id and e.chunk_id is null;

  update rag.documents d
  set status = (case when awaiting = 0 then 'ready' else 'embedding' end)::rag.document_status,
      failure_reason = null
  where d.id = target_document_id;

  return stored;
end;
$$;

create or replace function rag.next_unembedded_chunks(
  target_document_id uuid,
  batch_size         integer default 50
)
returns table (
  chunk_id     uuid,
  ordinal      integer,
  content      text,
  heading_path text[],
  remaining    bigint
)
language sql stable security invoker set search_path = ''
as $$
  with pending as (
    select c.id, c.ordinal, c.content, c.heading_path
    from rag.chunks c
    left join rag.embeddings e on e.chunk_id = c.id
    where c.document_id = target_document_id and e.chunk_id is null
  )
  select p.id, p.ordinal, p.content, p.heading_path, (select count(*) from pending)
  from pending p
  order by p.ordinal
  limit batch_size;
$$;

grant execute on function rag.next_unembedded_chunks(uuid, integer) to authenticated;

create or replace function rag.store_chunk_embeddings(
  target_document_id uuid,
  embeddings         jsonb
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  calling_user   uuid := auth.uid();
  document_owner uuid;
  awaiting       integer;
begin
  if calling_user is null then
    raise exception 'store_chunk_embeddings requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  select d.owner_id into document_owner from rag.documents d where d.id = target_document_id;
  if document_owner is null then
    raise exception 'document % does not exist', target_document_id using errcode = 'no_data_found';
  end if;
  if document_owner <> calling_user then
    raise exception 'document % belongs to another owner', target_document_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Joined against this document's own chunks, so a vector cannot be attached
  -- to a chunk elsewhere by naming its id.
  insert into rag.embeddings (chunk_id, owner_id, embedding, model_id)
  select c.id, calling_user, (value ->> 'embedding')::extensions.halfvec, 'gemini-embedding-001'
  from jsonb_array_elements(embeddings) as value
  join rag.chunks c
    on c.id = (value ->> 'chunk_id')::uuid
   and c.document_id = target_document_id
  on conflict (chunk_id) do nothing;

  select count(*) into awaiting
  from rag.chunks c left join rag.embeddings e on e.chunk_id = c.id
  where c.document_id = target_document_id and e.chunk_id is null;

  update rag.documents d
  set status = (case when awaiting = 0 then 'ready' else 'embedding' end)::rag.document_status
  where d.id = target_document_id;

  return awaiting;
end;
$$;

revoke all on function rag.store_chunk_embeddings(uuid, jsonb) from public;
grant execute on function rag.store_chunk_embeddings(uuid, jsonb) to authenticated;
