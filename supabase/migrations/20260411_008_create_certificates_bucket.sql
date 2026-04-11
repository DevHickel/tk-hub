-- Create certificates storage bucket for manual certificate uploads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificates',
  'certificates',
  true,
  10485760, -- 10MB
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Allow authenticated users to upload
create policy "Authenticated users can upload certificates"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'certificates');

-- Allow public read
create policy "Public can read certificates"
  on storage.objects for select
  to public
  using (bucket_id = 'certificates');

-- Allow users to delete their own files
create policy "Users can delete own certificates"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'certificates' and auth.uid()::text = (storage.foldername(name))[1]);
