import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PLAYER_NOTE_LIMIT, type PlayerCardSpec } from "@scoutable/shared/lib/player-card";
import type { StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import type { League } from "@scoutable/shared/types/league";
import { Button } from "@/components/ui/button";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { Textarea } from "@/components/ui/textarea";
import { StatsCardInspector } from "@/components/editor/stats-card-inspector";
import type { PlayerChoice } from "@scoutable/shared/lib/player-roster";
import type { StoredMatch } from "@/types/match";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * A player card's settings, under the player while the card is selected (the
 * stage previews the report's section for them). Whose card it is, which
 * numbers show (the stats card's controls, embedded), and the one note. The
 * clips under the card are the player's: the line below says how many, and
 * offers to bring in the same player's clips from elsewhere in the playlist.
 */
export function PlayerCardInspector({
  cardId,
  spec,
  players,
  games,
  leagues,
  clipCount,
  elsewhere,
  statsLoading,
  canReadStats,
  autoFocusNote,
  onChange,
  onPlayerChange,
  onRetryStats,
  onMoveClips,
}: {
  cardId: string;
  spec: PlayerCardSpec;
  players: PlayerChoice[];
  /** The playlist's games that have stats. */
  games: StoredMatch[];
  leagues: League[];
  /** Clips between this card and the next. */
  clipCount: number;
  /** The same player's clips elsewhere in the playlist that the helper can bring here. */
  elsewhere: number;
  statsLoading: boolean;
  /** One of the player's games has official stats, so a failed read is worth retrying. */
  canReadStats: boolean;
  /** The card was just added: the note takes focus. */
  autoFocusNote?: boolean;
  onChange: (spec: PlayerCardSpec) => void;
  onPlayerChange: (playerId: string) => void;
  onRetryStats: () => void;
  onMoveClips: () => void;
}) {
  const [note, setNote] = useState(spec.note);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const noteDirty = useRef(false);

  // Another card, or an edit that came from elsewhere: take it unless this one is mid-typing.
  useEffect(() => {
    if (!noteDirty.current) setNote(spec.note);
  }, [spec.note, cardId]);
  useEffect(() => {
    noteDirty.current = false;
    setNote(spec.note);
    if (autoFocusNote) ref.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // The textarea grows with its lines, up to eight.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 22 + 16)}px`;
  }, [note]);

  const { player } = spec;
  const left = PLAYER_NOTE_LIMIT - note.length;
  const options = players.some((p) => p.playerId === player.id)
    ? players
    : [{ playerId: player.id, name: player.name, number: player.number, teamName: player.teamName, clips: 0, matchId: "", taken: false }, ...players];

  return (
    <div className="flex flex-col gap-2.5 px-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="text-callout text-muted-foreground">Player card</span>
        <PopUpButton
          size="sm"
          aria-label="Player"
          value={player.id}
          onValueChange={onPlayerChange}
          disabled={statsLoading}
          options={options.map((p) => ({
            value: p.playerId,
            label: p.name,
            description: p.taken && p.playerId !== player.id
              ? "Already in this playlist"
              : [p.number ? `#${p.number}` : null, p.teamName, p.clips > 0 ? `${p.clips} ${p.clips === 1 ? "clip" : "clips"}` : null].filter(Boolean).join(" · "),
            disabled: p.taken && p.playerId !== player.id,
          }))}
        />
        {statsLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Reading the stats" />}
      </div>

      {spec.stats ? (
        <StatsCardInspector
          embedded
          cardId={cardId}
          spec={spec.stats}
          games={games}
          leagues={leagues}
          onChange={(stats: StatsCardSpec) => onChange({ ...spec, stats })}
        />
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 text-callout text-muted-foreground">
          {statsLoading
            ? "Reading the official stats…"
            : "No official stats for this league. The report shows the note and clips."}
          {!statsLoading && canReadStats && (
            <Button variant="ghost" size="xs" onClick={onRetryStats}>
              Try again
            </Button>
          )}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Textarea
          ref={ref}
          aria-label="Note"
          rows={3}
          value={note}
          maxLength={PLAYER_NOTE_LIMIT}
          placeholder={`What to know about ${firstName(player.name)}: tendencies, strengths, how to defend`}
          className="min-h-[4.5rem] py-2 leading-[22px]"
          onChange={(e) => {
            noteDirty.current = true;
            setNote(e.target.value);
            onChange({ ...spec, note: e.target.value });
          }}
          onBlur={() => {
            noteDirty.current = false;
          }}
          onKeyDown={(e) => {
            // The editor's keys stay out of the field; Esc commits.
            e.stopPropagation();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
        {left <= 100 && <span className="self-end text-caption text-muted-foreground nums">{left} left</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-callout text-muted-foreground">
          {clipCount > 0
            ? `${clipCount} ${clipCount === 1 ? "clip below belongs" : "clips below belong"} to ${firstName(player.name)}`
            : "No clips below yet. Drag clips under this card."}
        </span>
        {elsewhere > 0 && (
          <Button variant="outline" size="xs" onClick={onMoveClips}>
            Move {elsewhere} more {elsewhere === 1 ? "clip" : "clips"} of {firstName(player.name)} here
          </Button>
        )}
      </div>
      <p className="text-caption text-muted-foreground">Not in the video. Shows in the shared report.</p>
    </div>
  );
}
