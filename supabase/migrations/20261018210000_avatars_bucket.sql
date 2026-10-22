-- Profile pictures. The web and desktop profile pages have uploaded to an
-- "avatars" bucket (path <user id>/avatar.<ext>, upsert) since 2026-03, but no
-- migration ever created it, so every upload failed with "Bucket not found".
--
-- Public, because the saved URL goes straight into <img src>. 5 MB and images
-- only, matching the pages' own check; no SVG (a public SVG can carry script).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
ON CONFLICT (id) DO NOTHING;

-- Each signed-in user writes only inside their own folder. An upsert needs
-- SELECT and UPDATE as well as INSERT. Public reads go through the public
-- URL, which needs no policy; account deletion uses the service role.
CREATE POLICY "avatars owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY "avatars owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY "avatars owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY "avatars owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
