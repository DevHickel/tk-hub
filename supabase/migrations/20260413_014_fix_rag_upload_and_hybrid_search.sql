-- Fix 1: Create 'documents' storage bucket (RAG uploads fail with "Bucket not found")
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  true,
  20971520, -- 20MB (matches MAX_FILE_SIZE in rag.routes.ts)
  array['application/pdf']
)
on conflict (id) do nothing;

-- Allow authenticated users to upload
drop policy if exists "Authenticated users can upload documents" on storage.objects;
create policy "Authenticated users can upload documents"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

-- Allow public read (PDFs referenced by the RAG agent)
drop policy if exists "Public can read documents" on storage.objects;
create policy "Public can read documents"
  on storage.objects for select
  to public
  using (bucket_id = 'documents');

-- Allow authenticated users to delete documents (admins manage via backend)
drop policy if exists "Authenticated users can delete documents" on storage.objects;
create policy "Authenticated users can delete documents"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents');

-- Fix 2: Drop the duplicate hybrid_search(text, vector, int) overload.
-- The current implementation (migration 010) takes (text, text, int) and casts
-- the second arg internally. The old vector-typed overload makes PostgREST
-- unable to pick a candidate and fails every chat request with
-- "Could not choose the best candidate function".
DROP FUNCTION IF EXISTS public.hybrid_search(text, vector, int);
DROP FUNCTION IF EXISTS public.hybrid_search(text, vector(1536), int);
