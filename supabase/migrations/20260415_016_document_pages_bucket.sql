-- Bucket to store per-page PNG renders used as "visual source" thumbnails in chat answers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-pages',
  'document-pages',
  true,
  5242880, -- 5MB per image
  array['image/png']
)
on conflict (id) do nothing;

create policy "Authenticated users can upload document page images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'document-pages');

create policy "Public can read document page images"
  on storage.objects for select
  to public
  using (bucket_id = 'document-pages');

create policy "Authenticated users can delete document page images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'document-pages');

-- Persist the visual sources returned by /api/chat alongside the assistant message,
-- so reloading a conversation restores the thumbnails next to each answer.
alter table public.messages
  add column if not exists sources jsonb;

