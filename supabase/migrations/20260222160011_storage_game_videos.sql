-- Create game-videos bucket (public — video URLs are embedded in the app)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('game-videos', 'game-videos', true, 4294967296)  -- 4 GB limit
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload videos
CREATE POLICY "authenticated upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'game-videos'
    AND auth.role() = 'authenticated'
  );

-- Videos are publicly readable (needed for HTML5 <video src>)
CREATE POLICY "public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'game-videos');

-- Users can delete their own uploads (path starts with their user_id)
CREATE POLICY "owner delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'game-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
