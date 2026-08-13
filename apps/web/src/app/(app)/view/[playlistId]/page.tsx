"use client";

/**
 * Legacy share-link target. There is exactly one real player on web — the
 * my-playlists watch view — so this route only redirects into it. Kept as a
 * route (rather than deleted) because copied "/view/{id}" links and old
 * share emails live in chat threads indefinitely.
 */
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

export default function ViewRedirectPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (playlistId) router.replace(`/my-playlists?p=${playlistId}`);
  }, [playlistId, router]);

  return (
    <div className="flex h-96 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
