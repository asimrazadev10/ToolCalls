-- Marginalia: private bucket for uploaded source documents.
--
-- Objects are addressed as "<owner uuid>/<filename>". Deriving the owner from
-- the first path segment lets one predicate cover every verb, and makes a
-- mis-scoped upload impossible rather than merely discouraged.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rag-documents',
  'rag-documents',
  false,
  33554432,  -- 32 MiB, mirrors MAX_UPLOAD_BYTES in src/rag/config.ts
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do nothing;

create policy rag_documents_are_readable_by_owner on storage.objects
  for select to authenticated
  using (bucket_id = 'rag-documents'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy rag_documents_are_uploadable_by_owner on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rag-documents'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy rag_documents_are_updatable_by_owner on storage.objects
  for update to authenticated
  using (bucket_id = 'rag-documents'
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'rag-documents'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy rag_documents_are_deletable_by_owner on storage.objects
  for delete to authenticated
  using (bucket_id = 'rag-documents'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
