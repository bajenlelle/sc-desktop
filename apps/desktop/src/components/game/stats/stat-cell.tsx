import type { BoxCell } from "@scoutable/shared/lib/game-box";
import { cn } from "@/lib/utils";

/** The plays behind a number, by name: what the Game view lists when the number is clicked. */
export interface PlaySet {
  name: string;
  eventIds: readonly number[];
}

/** Which kind of number opened plays, for analytics. */
export type OpenKind = "player_stat" | "team_stat" | "shot" | "zone" | "lineup" | "quarter" | "run";

export type OpenPlays = (set: PlaySet, meta: { kind: OpenKind; stat?: string }) => void;

/**
 * A number that opens its plays in the Game view. It answers on press
 * (the fill comes on pointer-down), has a focus ring for the keyboard and a
 * name that says what opens. A number with no plays behind it is dimmed and
 * opens nothing.
 */
export function StatCell({
  cell,
  name,
  display,
  onOpen,
  className,
}: {
  cell: Pick<BoxCell, "eventIds">;
  /** The set's name, shown on the Game view's filter ("Lind: three-point attempts"). */
  name: string;
  /** What the cell prints: "4/9", "27", "+11". */
  display: string;
  onOpen: (set: PlaySet) => void;
  className?: string;
}) {
  if (cell.eventIds.length === 0) {
    return <span className={cn("nums text-muted-foreground/70", className)}>{display}</span>;
  }
  return (
    <button
      type="button"
      aria-label={`${name}, ${display}, show plays`}
      title={`Show plays: ${name}`}
      onClick={() => onOpen({ name, eventIds: cell.eventIds })}
      className={cn(
        "-mx-1 rounded-[5px] px-1 nums outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection",
        className,
      )}
    >
      {display}
    </button>
  );
}
