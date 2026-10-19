import { ListVideo } from "lucide-react";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";
import { Badge } from "@/components/ui/badge";
import { GroupRow } from "@/components/ui/group";

/** Clip items only; text cards are not clips. */
export function playlistClipCount(playlist: Playlist): number {
  return playlist.items.filter(isClipItem).length;
}

/** Whether anyone receives the playlist: a team or a person. */
export function isPlaylistShared(playlist: Playlist): boolean {
  return (playlist.teamIds?.length ?? 0) > 0 || (playlist.userIds?.length ?? 0) > 0 || !!playlist.teamId;
}

/**
 * The row's second line: "4 clips · Scouting · Shared with U17, U19". Team
 * names come from the caller (the active club's teams); direct recipients
 * are counted.
 */
export function playlistSummary(playlist: Playlist, opts: { folderLabel?: string | null; teamNames?: readonly string[] } = {}): string {
  const clips = playlistClipCount(playlist);
  const parts = [`${clips} clip${clips === 1 ? "" : "s"}`];
  if (opts.folderLabel) parts.push(opts.folderLabel);
  const recipients: string[] = [...(opts.teamNames ?? [])];
  const people = playlist.userIds?.length ?? 0;
  if (people > 0) recipients.push(`${people} ${people === 1 ? "person" : "people"}`);
  if (recipients.length > 0) parts.push(`Shared with ${recipients.join(", ")}`);
  return parts.join(" · ");
}

/**
 * One of the user's own playlists in a grouped list: its name, the clip
 * count with its folder and recipients, a "Shared" badge, whatever the
 * caller puts beside it (the Playlists page's ⋯ menu) and a chevron into
 * the editor.
 */
export function PlaylistRow({
  playlist,
  folderLabel,
  teamNames,
  trailing,
  onOpen,
}: {
  playlist: Playlist;
  folderLabel?: string | null;
  teamNames?: readonly string[];
  trailing?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <GroupRow
      label={<span className="font-medium">{playlist.name}</span>}
      description={playlistSummary(playlist, { folderLabel, teamNames })}
      leading={<ListVideo className="text-primary" />}
      trailing={
        <>
          {isPlaylistShared(playlist) && <Badge variant="secondary">Shared</Badge>}
          {trailing}
        </>
      }
      chevron
      onClick={onOpen}
    />
  );
}
