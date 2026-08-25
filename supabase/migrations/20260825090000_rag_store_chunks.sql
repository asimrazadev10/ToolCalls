-- The single privileged write path in Marginalia.
--
-- SECURITY DEFINER here, and nowhere else. rag.search_chunks must stay
-- SECURITY INVOKER: a definer-rights *search* runs as its owner, bypasses
-- row-level security and returns every tenant's chunks.
--
-- A definer-rights *write* is a different shape. It grants exactly one
-- capability -- insert chunks for a document you own -- and re-establishes the
-- check row-level security would have made, explicitly, before touching
-- anything. The alternative is a service-role key inside the application,
-- which grants every capability against every tenant and is one misplaced
-- environment variable away from total compromise.

create or replace function rag.store_document_chunks(
  target_document_id uuid,
  chunks             jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  calling_user   uuid := auth.uid();
  document_owner uuid;
  stored         integer;
begin
  if calling_user is null then
    raise exception 'store_document_chunks requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- The justification for the whole function. Definer rights mean row-level
  -- security will not do this for us, so it happens here, first, before any
  -- write is possible.
  select d.owner_id into document_owner
  from rag.documents d where d.id = target_document_id;

  if document_owner is null then
    raise exception 'document % does not exist', target_document_id
      using errcode = 'no_data_found';
  end if;

  if document_owner <> calling_user then
    raise exception 'document % belongs to another owner', target_document_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Replace rather than append, so re-ingesting after a parser fix leaves one
  -- set of chunks instead of two overlapping generations. The cascade on
  -- rag.chunks removes the matching embeddings.
  delete from rag.chunks c where c.document_id = target_document_id;

  with incoming as (
    select
      (value ->> 'ordinal')::integer             as ordinal,
      value ->> 'content'                        as content,
      (value ->> 'token_count')::integer         as token_count,
      coalesce(
        (select array_agg(heading)
         from jsonb_array_elements_text(value -> 'heading_path') as heading),
        '{}'::text[]
      )                                          as heading_path,
      (value ->> 'page_from')::integer           as page_from,
      (value ->> 'page_to')::integer             as page_to,
      (value ->> 'embedding')::extensions.halfvec as embedding
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
  select ins.id, calling_user, i.embedding, 'gemini-embedding-001'
  from inserted ins
  join incoming i on i.ordinal = ins.ordinal;

  get diagnostics stored = row_count;

  update rag.documents d
  set status = 'ready', failure_reason = null
  where d.id = target_document_id;

  return stored;
end;
$$;

revoke all on function rag.store_document_chunks(uuid, jsonb) from public;
grant execute on function rag.store_document_chunks(uuid, jsonb) to authenticated;
