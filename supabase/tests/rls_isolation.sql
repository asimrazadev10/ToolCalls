-- Marginalia: cross-tenant isolation proof.
--
-- The exit criterion for phase 01. Not "policies exist" — "one owner provably
-- cannot reach another's rows, by read or by write".
--
-- Must be run by a role that can insert into auth.users (service_role or
-- postgres). Each probe switches to `authenticated` and supplies a JWT claim,
-- because the connecting role bypasses row level security and would otherwise
-- see everything and prove nothing.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql

\set alice '11111111-1111-4111-8111-111111111111'
\set bob   '22222222-2222-4222-8222-222222222222'

-- ---------------------------------------------------------------- fixtures --

insert into auth.users (id) values (:'alice'), (:'bob');

with inserted as (
  insert into rag.documents
    (owner_id, title, mime_type, byte_size, content_sha256, storage_path, status)
  values
    (:'alice', 'Alice lease agreement', 'application/pdf', 2048, '\x01'::bytea,
     :'alice' || '/lease.pdf', 'ready'),
    (:'bob',   'Bob salary review',     'application/pdf', 4096, '\x02'::bytea,
     :'bob' || '/salary.pdf', 'ready')
  returning id, owner_id, title
),
chunked as (
  insert into rag.chunks (document_id, owner_id, ordinal, content, token_count, heading_path)
  select id, owner_id, 0, 'Confidential content belonging to ' || title, 7, array['Root']
  from inserted
  returning id, owner_id
)
insert into rag.embeddings (chunk_id, owner_id, embedding, model_id)
select id, owner_id,
       replace(replace(array_fill(0.01::real, array[3072])::text, '{', '['), '}', ']')
         ::extensions.halfvec,
       'gemini-embedding-001'
from chunked;

-- --------------------------------------------------- probe 1: reads, Alice --

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  visible_documents  integer;
  visible_chunks     integer;
  visible_embeddings integer;
begin
  select count(*) into visible_documents  from rag.documents;
  select count(*) into visible_chunks     from rag.chunks;
  select count(*) into visible_embeddings from rag.embeddings;

  assert visible_documents  = 1, 'Alice must see exactly her own document';
  assert visible_chunks     = 1, 'Alice must see exactly her own chunk';
  assert visible_embeddings = 1, 'Alice must see exactly her own embedding';

  assert (select count(*) from rag.documents
          where owner_id = '22222222-2222-4222-8222-222222222222') = 0,
         'Bob''s documents leaked to Alice';
  assert (select count(*) from rag.chunks
          where owner_id = '22222222-2222-4222-8222-222222222222') = 0,
         'Bob''s chunks leaked to Alice';
  assert (select count(*) from rag.embeddings
          where owner_id = '22222222-2222-4222-8222-222222222222') = 0,
         'Bob''s embeddings leaked to Alice';

  raise notice 'probe 1 passed: Alice sees only her own rows';
end $$;
rollback;

-- ------------------------------------------------ probe 2: writes, as Bob --

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  rows_updated integer;
  rows_deleted integer;
begin
  assert (select count(*) from rag.documents) = 1,
         'Bob must see exactly his own document';

  update rag.documents set title = 'stolen by Bob'
    where owner_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics rows_updated = row_count;
  assert rows_updated = 0, 'Bob was able to update Alice''s document';

  delete from rag.documents
    where owner_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics rows_deleted = row_count;
  assert rows_deleted = 0, 'Bob was able to delete Alice''s document';

  -- Forging ownership must be refused by the WITH CHECK clause.
  begin
    insert into rag.documents
      (owner_id, title, mime_type, byte_size, content_sha256, storage_path)
    values ('11111111-1111-4111-8111-111111111111', 'forged', 'application/pdf',
            1, '\xff'::bytea, 'forged.pdf');
    raise exception 'Bob was able to forge a document owned by Alice';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- Chunks carry no insert grant, so this fails at the privilege layer before
  -- row level security is even consulted.
  begin
    insert into rag.chunks (document_id, owner_id, ordinal, content, token_count)
    select id, '22222222-2222-4222-8222-222222222222', 99, 'fabricated', 1
    from rag.documents limit 1;
    raise exception 'Bob was able to fabricate a chunk';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  raise notice 'probe 2 passed: Bob cannot read, alter or forge Alice''s data';
end $$;
rollback;

-- ----------------------------------------------------------------- cleanup --

-- Cascades through documents, chunks and embeddings.
delete from auth.users where id in (:'alice', :'bob');

do $$
begin
  assert (select count(*) from rag.documents)  = 0, 'fixture documents remain';
  assert (select count(*) from rag.chunks)     = 0, 'fixture chunks remain';
  assert (select count(*) from rag.embeddings) = 0, 'fixture embeddings remain';
  raise notice 'cleanup passed: cascade removed every dependent row';
end $$;
