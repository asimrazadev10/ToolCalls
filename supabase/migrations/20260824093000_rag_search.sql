-- Marginalia: hybrid retrieval.
--
-- Both arms and their fusion run in a single statement, so a search is one
-- network round trip rather than three.
--
-- Two properties are load-bearing and neither is obvious from reading the SQL:
--
--   SECURITY INVOKER, not DEFINER. A definer-rights search function runs as its
--   owner, bypasses row-level security, and cheerfully returns other tenants'
--   chunks. That is the classic RAG data leak.
--
--   OPERATOR(extensions.<#>), not a bare <#>. An empty search_path is what
--   stops a caller shadowing an unqualified name, and it necessarily excludes
--   the schema pgvector's operators live in. Qualifying the operator keeps the
--   hardening and still resolves the name.

create or replace function rag.search_chunks(
  query_embedding extensions.halfvec,
  query_text      text,
  match_limit     integer default 20
)
returns table (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  content        text,
  heading_path   text[],
  page_from      integer,
  page_to        integer,
  fusion_score   double precision,
  dense_rank     integer,
  text_rank      integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  -- Filtered vector search needs this. HNSW walks the graph and row-level
  -- security filters afterwards, so asking for 50 neighbours can return three
  -- once other owners' rows are removed -- and the shortfall is silent. An
  -- iterative scan keeps walking until the requested count survives filtering.
  --
  -- Set here rather than in the function header: pgvector registers these
  -- parameters when its library loads, which has not happened yet at the
  -- moment the function is created.
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '60', true);
  perform set_config('hnsw.max_scan_tuples', '20000', true);

  return query
  with dense as (
    -- <#> is negative inner product, so ascending order is most-similar-first.
    -- Inner product rather than cosine because Gemini returns unit vectors,
    -- where the two rank identically and inner product costs less.
    select
      e.chunk_id,
      row_number() over (
        order by e.embedding OPERATOR(extensions.<#>) query_embedding
      )::integer as rank
    from rag.embeddings e
    order by e.embedding OPERATOR(extensions.<#>) query_embedding
    limit 50
  ),
  full_text as (
    -- The arm that finds what dense retrieval misses: an exact clause number,
    -- a surname, a product code. Its operators live in pg_catalog, which is
    -- always in scope regardless of search_path, so they need no qualifying.
    select
      c.id as chunk_id,
      row_number() over (
        order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', query_text)) desc,
                 c.id
      )::integer as rank
    from rag.chunks c
    where c.content_tsv @@ websearch_to_tsquery('english', query_text)
    limit 50
  ),
  fused as (
    -- Reciprocal Rank Fusion, k = 60, mirroring fuseByReciprocalRank in
    -- src/rag/retrieve. Ranks only, never scores: inner product and ts_rank_cd
    -- occupy incomparable scales, and any normalization tuned on one corpus
    -- misbehaves on the next. A full outer join because each arm legitimately
    -- finds rows the other does not.
    --
    -- Explicitly double precision: an untyped 1.0 is numeric, which does not
    -- match the declared return column and fails only at execution.
    select
      coalesce(d.chunk_id, f.chunk_id) as chunk_id,
      coalesce(1.0::double precision / (60 + d.rank), 0::double precision)
        + coalesce(1.0::double precision / (60 + f.rank), 0::double precision) as score,
      d.rank as dense_rank,
      f.rank as text_rank
    from dense d
    full outer join full_text f on f.chunk_id = d.chunk_id
  )
  select
    c.id,
    c.document_id,
    doc.title,
    c.content,
    c.heading_path,
    c.page_from,
    c.page_to,
    fused.score,
    fused.dense_rank,
    fused.text_rank
  from fused
  join rag.chunks c on c.id = fused.chunk_id
  join rag.documents doc on doc.id = c.document_id
  -- Ties break by id so the same question returns the same citations twice.
  order by fused.score desc, c.id
  limit match_limit;
end;
$$;

-- anon is granted nothing: an unauthenticated caller cannot reach the search.
grant execute on function rag.search_chunks(extensions.halfvec, text, integer) to authenticated;
