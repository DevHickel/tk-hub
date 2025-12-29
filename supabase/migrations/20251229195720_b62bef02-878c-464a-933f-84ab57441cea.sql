-- Add DELETE policy for avatars bucket so users can replace their old avatars
CREATE POLICY "Avatar Auth Delete"
ON storage.objects
FOR DELETE
USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');