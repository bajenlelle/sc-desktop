import { ChevronDown, ListPlus, Plus } from "lucide-react";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { AddToPopover } from "@/components/editor/add-to-popover";
import { PILL_LABEL, PillButton, SelectionBar } from "@/components/editor/selection-bar";
import type { Collect } from "@/components/game/use-collect";
import { cn } from "@/lib/utils";

/**
 * The selection's pill over a list of plays (the game view, Teams' Plays): Add to the playlist plays are being
 * collected into, or to another one, and Deselect. `plays` is read when a button is pressed, so the page hands
 * its selection as it is then. The parent must be a `@container` (SelectionBar).
 */
export function PlaysSelectionBar({
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
    <SelectionBar
      count={count}
      onClear={onClear}
      clearTitle="Deselect all (Esc)"
      group={null}
      addTo={
        <>
          <PillButton
            title={collect.target ? `Add ${count} ${count === 1 ? "play" : "plays"} to ${collect.target.name}` : "Add to playlist…"}
            // With no target the picker opens from its own button (the pill leaves with the selection), and
            // the selection stays until a playlist is chosen and the plays are in: dismissed, nothing is lost.
            onClick={() => collect.add(plays(), "selection", moment, null, onClear)}
          >
            <Plus />
            {collect.target ? (
              <span className={cn(PILL_LABEL, "max-w-40 truncate")}>Add to {collect.target.name}</span>
            ) : (
              <span className={PILL_LABEL}>Add to playlist…</span>
            )}
          </PillButton>
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
              <PillButton title="Add to another playlist">
                <ListPlus />
                <span className={PILL_LABEL}>Another playlist</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </PillButton>
            }
          />
        </>
      }
    />
  );
}
