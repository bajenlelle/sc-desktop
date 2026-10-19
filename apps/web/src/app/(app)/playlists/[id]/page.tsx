"use client";

import { useParams } from "next/navigation";
import { PlaylistEditor } from "@/components/editor/playlist-editor";

/** One of the user's playlists, in the editor. */
export default function PlaylistEditorPage() {
  const { id } = useParams<{ id: string }>();
  return <PlaylistEditor playlistId={id} />;
}
