-- Repairs the lexical arm, which was silently contributing nothing.
--
-- websearch_to_tsquery ANDs every term, so "what are the rules about keeping
-- animals?" becomes 'rule' & 'keep' & 'anim' and matches nothing unless one
-- chunk holds all three. Measured against a real document:
--
--   the question, ANDed  -> 0 chunks
--   the bare word animals -> 3 chunks
--   the same terms, ORed  -> 3 chunks
--
-- So hybrid search degraded to dense-only for exactly the input the product
-- receives: natural-language questions. Keyword queries like "PM2.5" worked,
-- which is why it went unnoticed.
--
-- OR-ing restores the arm without hurting precision, because ts_rank_cd
-- already ranks by how many query terms a chunk carries and how close together
-- they sit. A chunk matching all three still leads, and Reciprocal Rank Fusion
-- reads only that ordering.
create or replace function rag.build_lexical_query(query_text text)
returns tsquery
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      array_to_string(
        (select array_agg(lexeme)
         from unnest(to_tsvector('english', coalesce(query_text, ''))) as lexeme),
        ' | '
      ),
      ''
    )::tsquery,
    ''::tsquery
  );
$$;

grant execute on function rag.build_lexical_query(text) to authenticated;

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
declare
  lexical_query tsquery := rag.build_lexical_query(query_text);
begin
  -- Filtered vector search needs this. HNSW walks the graph and row-level
  -- security filters afterwards, so asking for 50 neighbours can return three
  -- once other owners' rows are removed -- and the shortfall is silent.
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '60', true);
  perform set_config('hnsw.max_scan_tuples', '20000', true);

  return query
  with dense as (
    -- OPERATOR(extensions.<#>) rather than a bare <#>: an empty search_path is
    -- what stops a caller shadowing an unqualified name, and it necessarily
    -- excludes the schema pgvector's operators live in.
    --
    -- <#> is negative inner product, so ascending order is most-similar-first.
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
    select
      c.id as chunk_id,
      row_number() over (
        order by ts_rank_cd(c.content_tsv, lexical_query) desc, c.id
      )::integer as rank
    from rag.chunks c
    where lexical_query != ''::tsquery
      and c.content_tsv @@ lexical_query
    limit 50
  ),
  fused as (
    -- Reciprocal Rank Fusion, k = 60. Ranks only, never scores: inner product
    -- and ts_rank_cd occupy incomparable scales. Explicitly double precision,
    -- because an untyped 1.0 is numeric and fails only at execution.
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
    c.id, c.document_id, doc.title, c.content, c.heading_path,
    c.page_from, c.page_to, fused.score, fused.dense_rank, fused.text_rank
  from fused
  join rag.chunks c on c.id = fused.chunk_id
  join rag.documents doc on doc.id = c.document_id
  -- Ties break by id so the same question returns the same citations twice.
  order by fused.score desc, c.id
  limit match_limit;
end;
$$;
