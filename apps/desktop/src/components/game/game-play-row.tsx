import { memo, type ReactNode } from "react";
import { SITUATION_OPTIONS } from "@scoutable/shared/lib/clip-filters";
import type { GameFlow, Score } from "@scoutable/shared/lib/game-flow";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { Label } from "@scoutable/shared/types/labels";
import { ActiveRowPill, PlayRowCells, playRowClass, RowLabelButton, RowPlaylistSlot, RowTip } from "@/components/plays/play-row";
import { pressable } from "@/lib/pressable";

/** The feed's qualifiers in words, as the Add clips filters name them. */
const QUALIFIER_WORDS = new Map(
  SITUATION_OPTIONS.filter((o) => o.value.startsWith("qual:")).map((o) => [o.value.slice(5), o.label]),
);

export type CollectStatus = "none" | "in" | "added";

/** Words for a play outside the video, for its row's tooltip and the Now bar. */
export function reachWords(play: TimedPlay): string | null {
  if (play.reach === "before") return "Before the video starts";
  if (play.reach === "after") return "After the video ends";
  return null;
}

/**
 * What the game view's Now bar adds after the clock and the score: the feed's
 * qualifiers in words ("In the paint"), what the play did to the game ("Lead
 * change", "Tied at 51"), and where it is when it is outside the video. The
 * play rows are one line; these were their second.
 */
export function playDetails(play: TimedPlay, flow: GameFlow): string[] {
  const e = play.event;
  const out = e.qualifiers.map((q) => QUALIFIER_WORDS.get(q)).filter((w): w is string => !!w);
  const point = flow.points.find((p) => p.eventId === e.eventId);
  if (flow.leadChanges.includes(e.eventId)) out.push("Lead change");
  else if (flow.ties.includes(e.eventId) && point) out.push(`Tied at ${point.home}`);
  const reach = reachWords(play);
  if (reach) out.push(reach);
  return out;
}

/**
 * One play in the game's list: the shared play row (clock, the team's code
 * when both teams are listed, the event, the player and the coach's labels,
 * the score beside every basket so the eye runs down it like a scoresheet),
 * and the two things to do with it: label it, add it to the playlist. The row
 * itself plays the play; ⌘ and Shift pick it into the list's selection
 * instead (`onPress`, as a Finder list does). Memoised: while the game runs
 * only the row that stops being current and the one that becomes it are drawn
 * again.
 */
export const GamePlayRow = memo(function GamePlayRow({
  play,
  active,
  selected,
  playing,
  teamCodes,
  score,
  scored,
  labels,
  collect,
  targetName,
  menuOpen,
  labelPicker,
  onPress,
  onAdd,
  onRemove,
  onLabel,
}: {
  play: TimedPlay;
  active: boolean;
  /** In the list's selection. */
  selected: boolean;
  /** The current play, with footage on the stage (not merely selected). */
  playing: boolean;
  /** Both teams are listed: the row names its team, in a column as wide as the widest of these codes. Null: no column. */
  teamCodes: readonly string[] | null;
  /** The score after the play; shown when the play scored. */
  score: Score | null;
  /** Which side the play scored for. */
  scored: 1 | 2 | null;
  labels: readonly Label[];
  collect: CollectStatus;
  targetName: string | null;
  /** The list's menu is open on this play: the row is outlined, as Finder outlines the item a menu is about. */
  menuOpen: boolean;
  /** The label picker, on the one row that is being labelled; the plain button otherwise. */
  labelPicker: ReactNode | null;
  /** A click or Return on the row: plain plays it, `toggle` (⌘) and `shift` change the selection. */
  onPress: (play: TimedPlay, mods: { shift: boolean; toggle: boolean }) => void;
  /** `anchor` is the plus that was pressed: a picker it has to open grows from there. */
  onAdd: (play: TimedPlay, anchor: HTMLElement) => void;
  onRemove: (play: TimedPlay) => void;
  onLabel: (play: TimedPlay) => void;
}) {
  const outside = reachWords(play);
  return (
    <div
      {...pressable(() => onPress(play, { shift: false, toggle: false }), { space: false })}
      onClick={(ev) => onPress(play, { shift: ev.shiftKey, toggle: ev.metaKey || ev.ctrlKey })}
      // A right-click in the row's label picker (a portal) bubbles here through React: it stops at the row, so the
      // list's menu doesn't take it and the picker's field keeps the system's Cut, Copy and Paste.
      onContextMenu={(ev) => {
        if (!ev.currentTarget.contains(ev.target as Node)) ev.stopPropagation();
      }}
      data-row-key={play.key}
      data-selected={selected || undefined}
      aria-current={active || undefined}
      title={outside ?? undefined}
      className={`${playRowClass({ selected, menuOpen })} scroll-my-16`}
    >
      {active && !selected && <ActiveRowPill />}
      <PlayRowCells
        event={play.event}
        clock="clock-only"
        now={active && playing}
        strong={active}
        team={teamCodes}
        labels={labels}
        score={score && scored ? { home: score.home, away: score.away, scored } : null}
        dim={outside !== null}
        check={{ on: selected, onToggle: (shift) => onPress(play, { shift, toggle: !shift }) }}
        actions={
          <>
            {labelPicker ?? (
              <RowTip label="Label" keyHint="G">
                <RowLabelButton visible={active || labels.length > 0} onClick={() => onLabel(play)} />
              </RowTip>
            )}
            <RowPlaylistSlot
              status={collect}
              targetName={targetName}
              visible={active}
              onAdd={(anchor) => onAdd(play, anchor)}
              onRemove={() => onRemove(play)}
            />
          </>
        }
      />
    </div>
  );
});
