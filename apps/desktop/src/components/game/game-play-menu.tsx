import type { ReactElement } from "react";
import { Plus, Timer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Sentry } from "@/lib/sentry";
import type { Collect } from "./use-collect";

/**
 * The menu for one or more plays (a row's right-click): add them to the
 * target, or once to any other playlist or a new one named after the game.
 * A one-time add never changes the target: "Adding to" stays as it is. Every
 * add is the collect toast's, with its Undo.
 */
export function GamePlayMenuContent({
  plays,
  collect,
  moment,
  anchor,
  onDone,
  onFixSync,
  onPutBack,
}: {
  plays: readonly TimedPlay[];
  collect: Collect;
  moment: string | null;
  /** The row the menu is about: a picker the add has to open grows from there. */
  anchor: HTMLElement;
  /** Called after an add, e.g. to clear the selection the plays came from. */
  onDone?: () => void;
  /** Fix sync on the one play the menu is about; absent for a selection, or where the play can't be found in the video. */
  onFixSync?: () => void;
  /** Takes back the play's own place ("Only this play"): it follows the sync again. Only for a play placed by hand. */
  onPutBack?: () => void;
}): ReactElement {
  const n = plays.length;
  const { target, candidates, loading, suggestedName } = collect;
  const allIn = n > 0 && plays.every((p) => collect.inTarget.has(p.key));
  const others = candidates.filter((pl) => pl.id !== target?.id);
  const showNew = suggestedName.length > 0 && !candidates.some((pl) => pl.name.toLowerCase() === suggestedName.toLowerCase());

  async function createAndAdd() {
    try {
      await collect.createAndAddTo(suggestedName, plays, "menu", moment);
      onDone?.();
    } catch (e) {
      Sentry.captureException(e);
      toast.error("Couldn't create the playlist", { description: "Check the connection and try again." });
    }
  }

  return (
    <ContextMenuContent className="max-w-72">
      {target && (
        <ContextMenuItem
          disabled={allIn}
          // `onDone` once the plays are in, not before: an add that has to ask for a playlist first keeps the selection.
          onSelect={() => collect.add(plays, "menu", moment, anchor, onDone)}
        >
          <span className="min-w-0 truncate">
            {allIn
              ? n === 1
                ? `In ${target.name}`
                : `All in ${target.name}`
              : n === 1
                ? `Add to ${target.name}`
                : `Add ${n} plays to ${target.name}`}
          </span>
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>{target ? "Add to another playlist" : "Add to playlist"}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-64 overflow-y-auto">
          {loading ? (
            <ContextMenuItem disabled>Loading playlists…</ContextMenuItem>
          ) : (
            <>
              {showNew && (
                <ContextMenuItem onSelect={() => void createAndAdd()}>
                  <Plus className="text-primary" />
                  <span className="min-w-0 flex-1 truncate">New playlist &ldquo;{suggestedName}&rdquo;</span>
                </ContextMenuItem>
              )}
              {showNew && others.length > 0 && <ContextMenuSeparator />}
              {others.map((pl) => (
                <ContextMenuItem
                  key={pl.id}
                  onSelect={() => {
                    collect.addToPlaylist(pl, plays, "menu", moment);
                    onDone?.();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                  {playlistIsShared(pl) && <span className="ml-auto shrink-0 text-xs text-muted-foreground">Shared</span>}
                </ContextMenuItem>
              ))}
              {!showNew && others.length === 0 && <ContextMenuItem disabled>No other playlists</ContextMenuItem>}
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {(onFixSync || onPutBack) && <ContextMenuSeparator />}
      {onFixSync && (
        <ContextMenuItem onSelect={onFixSync}>
          <Timer />
          Fix sync…
        </ContextMenuItem>
      )}
      {onPutBack && (
        <ContextMenuItem onSelect={onPutBack}>
          <Undo2 />
          Put back with the others
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}
