-- Marginalia: hybrid retrieval proof.
--
-- Vectors here are synthetic unit vectors along chosen axes, not real
-- embeddings. That is deliberate: this test is about the function's mechanics
-- — does each arm contribute, does fusion promote agreement, does row-level
-- security hold inside the function — and real embeddings would make it depend
-- on model behaviour that can change under it. Semantic quality is the eval
-- harness's job.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/search_chunks.sql

\set alice 'aaaaaaaa-0000-4000-8000-000000000001'
\set bob   'bbbbbbbb-0000-4000-8000-000000000002'

create or replace function rag.__test_axis_vector(axis integer)
returns extensions.halfvec
language sql immutable
set search_path = ''
as $$
  select replace(replace(
    (select array_agg(case when i = axis then 1.0::real else 0.0::real end order by i)
     from generate_series(1, 3072) as i)::text, '{', '['), '}', ']')::extensions.halfvec;
$$;

-- ---------------------------------------------------------------- fixtures --

insert into auth.users (id) values (:'alice'), (:'bob');

with docs as (
  insert into rag.documents
    (owner_id, title, mime_type, byte_size, content_sha256, storage_path, status)
  values
    (:'alice', 'Alice lease', 'application/pdf', 100, '\x0a'::bytea, 'a/lease.pdf', 'ready'),
    (:'bob',   'Bob lease',   'application/pdf', 100, '\x0b'::bytea, 'b/lease.pdf', 'ready')
  returning id, owner_id
),
seeded as (
  insert into rag.chunks (document_id, owner_id, ordinal, content, token_count, heading_path)
  select d.id, d.owner_id, v.ordinal, v.content, 20, v.heading_path
  from docs d
  join (values
    -- Axis 1: matches the query vector exactly. Dense finds this.
    (:'alice'::uuid, 0, 'The tenant shall obtain prior written consent before subletting.',
     array['Lease','Section 11 - Subletting']),
    -- Axis 2: unrelated direction, no query term. Should rank last.
    (:'alice'::uuid, 1, 'No animals may be kept on the premises.',
     array['Lease','Section 8 - Pets']),
    -- Axis 3: the farthest chunk from the query vector, but the only one
    -- holding the exact rare token. Only the full-text arm can find it, and
    -- fusion must still promote it — that is the whole argument for two arms.
    (:'alice'::uuid, 2, 'Air filtration must maintain PM2.5 below the stated threshold.',
     array['Lease','Schedule 3 - Services']),
    -- Bob's chunk carries the SAME axis-1 vector as Alice's best dense hit, so
    -- it would rank top for her query if the function leaked across owners.
    (:'bob'::uuid,   0, 'Bob confidential subletting terms.',
     array['Lease','Section 11 - Subletting'])
  ) as v(owner_id, ordinal, content, heading_path) on v.owner_id = d.owner_id
  returning id, owner_id, ordinal
)
insert into rag.embeddings (chunk_id, owner_id, embedding, model_id)
select s.id, s.owner_id,
       rag.__test_axis_vector(case when s.owner_id = :'bob'::uuid then 1 else s.ordinal + 1 end),
       'synthetic-test'
from seeded s;

-- ------------------------------------------- probe 1: both arms contribute --

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  results record;
  top_section text;
begin
  select heading_path[2], dense_rank, text_rank into results
  from rag.search_chunks(rag.__test_axis_vector(1), 'PM2.5', 10)
  limit 1;

  top_section := results.heading_path;

  -- The lexical arm rescues the chunk dense retrieval ranked worst.
  assert top_section = 'Schedule 3 - Services',
    'fusion must promote the chunk both arms found, got ' || coalesce(top_section, 'nothing');
  assert results.dense_rank = 3, 'the promoted chunk should be dense''s worst result';
  assert results.text_rank = 1,  'the promoted chunk should be full text''s best result';

  assert (select count(*) from rag.search_chunks(rag.__test_axis_vector(1), 'PM2.5', 10)) = 3,
    'Alice must see her three chunks and no more';

  raise notice 'probe 1 passed: hybrid fusion promotes cross-arm agreement';
end $$;
rollback;

-- ---------------------------- probe 2: isolation holds inside the function --

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  assert (select count(*) from rag.search_chunks(rag.__test_axis_vector(1), 'PM2.5', 10)
          where content like 'Bob%') = 0,
    'Bob''s chunk leaked into Alice''s search results';
  raise notice 'probe 2 passed: no cross-owner leak';
end $$;
rollback;

-- ---------------- probe 3: the counterfactual — Bob's chunk really does rank --

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare
  bobs_rank integer;
begin
  -- Without this, probe 2 proves nothing: Bob's chunk might simply be a poor
  -- match. It is in fact the top dense hit for that exact query vector.
  select dense_rank into bobs_rank
  from rag.search_chunks(rag.__test_axis_vector(1), 'PM2.5', 10)
  limit 1;

  assert bobs_rank = 1,
    'Bob''s chunk must be the top dense hit, or probe 2 proves nothing';
  raise notice 'probe 3 passed: the withheld chunk was genuinely a top match';
end $$;
rollback;

-- ----------------------------------------------------------------- cleanup --

drop function if exists rag.__test_axis_vector(integer);
delete from auth.users where id in (:'alice', :'bob');

do $$
begin
  assert (select count(*) from rag.chunks) = 0, 'fixture chunks remain';
  assert (select count(*) from rag.embeddings) = 0, 'fixture embeddings remain';
  raise notice 'cleanup passed';
end $$;
