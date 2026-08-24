-- Marginalia: per-user document RAG storage.
--
-- Confined to the `rag` schema. This database's `public` schema belongs to an
-- unrelated Prisma/Auth.js application with live data; no object here may
-- reference it.

create schema if not exists rag;

-- pgvector lives in `extensions`, the Supabase convention, so types and
-- operator classes below are schema-qualified rather than relying on a
-- search_path that differs between roles.
create extension if not exists vector with schema extensions;

-- Pipeline stages, in order. Closed set: these are defined by our own worker,
-- so the database can enforce them rather than trusting the application.
create type rag.document_status as enum (
  'uploaded',   -- bytes in storage, nothing read yet
  'parsing',    -- extracting text, page by page
  'chunking',   -- splitting parsed text on structure
  'embedding',  -- generating vectors
  'ready',      -- answerable
  'failed'      -- see documents.failure_reason
);

create table rag.documents (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  title               text not null,
  mime_type           text not null,
  byte_size           bigint not null check (byte_size > 0),
  -- Content hash, not filename: re-uploading identical bytes must cost nothing.
  content_sha256      bytea not null,
  storage_path        text not null,
  status              rag.document_status not null default 'uploaded',
  page_count          integer check (page_count is null or page_count > 0),
  -- Which pages needed vision fallback and why, for diagnosing bad answers
  -- back to a bad parse.
  parse_report        jsonb,
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint documents_unique_content_per_owner unique (owner_id, content_sha256)
);

create table rag.chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references rag.documents (id) on delete cascade,
  -- Denormalized from documents on purpose: row-level security that has to
  -- join back to documents cannot be pushed into the vector index scan, so the
  -- planner filters after retrieval and the result set comes up short.
  owner_id      uuid not null references auth.users (id) on delete cascade,
  ordinal       integer not null check (ordinal >= 0),
  page_from     integer,
  page_to       integer,
  -- Breadcrumb such as {Lease Agreement,"Section 8 — Pets"}, embedded with the
  -- body so a bare "§8" is still retrievable by what it is about.
  heading_path  text[] not null default '{}',
  content       text not null check (length(content) > 0),
  -- Filled in phase 07 (contextual retrieval), null until then.
  context_blurb text,
  token_count   integer not null check (token_count > 0),
  content_tsv   tsvector generated always as (to_tsvector('english', content)) stored,
  created_at    timestamptz not null default now(),
  constraint chunks_unique_ordinal_per_document unique (document_id, ordinal)
);

create table rag.embeddings (
  chunk_id   uuid primary key references rag.chunks (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  -- halfvec, not vector: 3072 dimensions exceed pgvector's 2000-dimension HNSW
  -- ceiling for `vector`, which would leave this column unindexed and silent
  -- about it. halfvec indexes to 4096 at the same bytes per row.
  embedding  extensions.halfvec(3072) not null,
  model_id   text not null,
  created_at timestamptz not null default now()
);

create table rag.query_log (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  question            text not null,
  retrieved_chunk_ids uuid[] not null default '{}',
  fusion_scores       real[] not null default '{}',
  latency_ms          integer,
  model_id            text,
  created_at          timestamptz not null default now()
);

-- Listing a user's documents, newest first.
create index documents_by_owner_recent
  on rag.documents (owner_id, created_at desc);

-- Reassembling a document in order, and neighbour expansion at answer time.
create index chunks_by_document_order
  on rag.chunks (owner_id, document_id, ordinal);

-- Full-text arm of hybrid retrieval.
create index chunks_full_text
  on rag.chunks using gin (content_tsv);

-- Dense arm. Inner product rather than cosine: Gemini returns normalized
-- vectors, so the two rank identically and inner product costs less.
create index embeddings_vector_search
  on rag.embeddings using hnsw (embedding extensions.halfvec_ip_ops)
  with (m = 16, ef_construction = 64);

create index query_log_by_owner_recent
  on rag.query_log (owner_id, created_at desc);

-- Keeps updated_at honest so a job stuck mid-pipeline is visible.
create function rag.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_set_updated_at
  before update on rag.documents
  for each row execute function rag.set_updated_at();
