import { Folder } from "lucide-react";
import type { PlaylistFolder } from "@scoutable/shared/types/match";
import { GroupRow } from "@/components/ui/group";
import { playlistCountLabel } from "./folder-nav";

/**
 * A folder in a grouped list, as Notes and Files show one: the folder, its
 * name, how many playlists are in it (counting its subfolders), the ⋯ menu
 * the caller passes, and a chevron into it. A folder still being created
 * shows but can't be opened yet.
 */
export function FolderRow({
  folder,
  count,
  description,
  pending = false,
  menu,
  onOpen,
}: {
  folder: PlaylistFolder;
  count: number;
  /** A second line, such as where the folder is (search results). */
  description?: string | null;
  pending?: boolean;
  menu?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <GroupRow
      label={<span className="font-medium">{folder.name}</span>}
      description={description || undefined}
      leading={<Folder className="fill-primary/15 text-primary" />}
      trailing={
        <>
          <span aria-hidden className="nums">
            {count}
          </span>
          <span className="sr-only">{playlistCountLabel(count)}</span>
          {menu}
        </>
      }
      chevron
      disabled={pending}
      onClick={onOpen}
    />
  );
}
