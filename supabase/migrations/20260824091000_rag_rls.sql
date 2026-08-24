-- Marginalia: per-user isolation.
--
-- Two independent layers. Grants decide which verbs exist for a role at all;
-- policies decide which rows. A policy written too loosely still cannot let
-- `anon` read anything, because `anon` holds no grant on this schema.

alter table rag.documents  enable row level security;
alter table rag.chunks     enable row level security;
alter table rag.embeddings enable row level security;
alter table rag.query_log  enable row level security;

grant usage on schema rag to authenticated;

grant select, insert, update, delete on rag.documents to authenticated;
grant select                        on rag.chunks     to authenticated;
grant select                        on rag.embeddings to authenticated;
grant select, insert                on rag.query_log  to authenticated;

-- Chunks and embeddings are written only by the ingest worker, which connects
-- as service_role and bypasses row level security. Withholding the insert
-- grant means a user cannot fabricate a chunk and then have the model cite it
-- as though it came from a document they uploaded.

-- auth.uid() is wrapped in a subselect so the planner evaluates it once per
-- statement instead of once per row.
create policy documents_are_visible_to_owner on rag.documents
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy documents_are_insertable_by_owner on rag.documents
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy documents_are_updatable_by_owner on rag.documents
  for update to authenticated using ((select auth.uid()) = owner_id)
                                with check ((select auth.uid()) = owner_id);
create policy documents_are_deletable_by_owner on rag.documents
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy chunks_are_visible_to_owner on rag.chunks
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy embeddings_are_visible_to_owner on rag.embeddings
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy query_log_is_visible_to_owner on rag.query_log
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy query_log_is_insertable_by_owner on rag.query_log
  for insert to authenticated with check ((select auth.uid()) = owner_id);
