import { ChevronDown, ListPlus } from "lucide-react";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { AddToPopover } from "@/components/editor/add-to-popover";
import { BarAddButton, BarButton } from "@/components/plays/plays-count-line";
import type { Collect } from "@/components/game/use-collect";

/**
 * The selection's buttons in the count line over a list of plays (the game view, Teams' Plays; PlaysCountLine's
 * `selection.actions`): Add to the playlist or report plays are being collected into, labelled with how many,
 * and Add to… another one. `plays` is read when a button is pressed, so the page hands its selection as it is
 * then. With no target yet the Add asks where from the toolbar's picker and the selection stays until the plays
 * are in.
 */
export function PlaysSelectionActions({
  count,
  collect,
  plays,
  moment = null,
  onClear,
}: {
  count: number;
  collect: Collect;
  plays: () => readonly TimedPlay[];
  /** The game view's moment, which the analytics of an add carry. */
  moment?: string | null;
  onClear: () => void;
}) {
  return (
    <>
      <BarAddButton count={count} targetName={collect.target?.name ?? null} shortcut="A" onClick={() => collect.add(plays(), "selection", moment, null, onClear)} />
      <AddToPopover
        playlists={collect.candidates}
        activePlaylistId={collect.target?.id ?? null}
        onAddToPlaylist={async (pl) => {
          collect.addToPlaylist(pl, plays(), "selection", moment);
          onClear();
        }}
        onCreatePlaylist={async (name) => {
          await collect.createAndAddTo(name, plays(), "selection", moment);
          onClear();
        }}
        trigger={
          <BarButton icon={<ListPlus />} label="Add to…" title="Add to another playlist">
            <ChevronDown className="size-3 text-muted-foreground" />
          </BarButton>
        }
      />
    </>
  );
}
