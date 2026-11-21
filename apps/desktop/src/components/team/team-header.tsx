import type { TeamProfile } from "@scoutable/shared/lib/league-season";
import { standingLine } from "@scoutable/shared/lib/season-copy";
import { coverageLine, meetingLine } from "@scoutable/shared/lib/team-copy";
import { meeting, type TeamGameRow } from "@scoutable/shared/lib/team-schedule";
import { gameDay, playedDay } from "./dates";
import { FormStrip } from "./form-strip";
import { WatchLink } from "./watch-link";

/**
 * The top of a team's page: its place and form, when the coach's team meets
 * it, the season game by game, and how many of its games the coach has.
 */
export function TeamHeader({
  profile,
  rows,
  library,
  mine,
  watchAll,
}: {
  profile: TeamProfile;
  rows: readonly TeamGameRow[];
  library: ReadonlyMap<number, string>;
  mine: ReadonlySet<number>;
  /** Every play of theirs in the coach's games, once read: "Watch all n plays". */
  watchAll?: { plays: number; onWatch: () => void } | null;
}) {
  const m = meeting(rows, mine);
  const meetLine = mine.has(profile.teamId)
    ? "Your team."
    : m
      ? meetingLine({ kind: m.kind, home: m.row.home, score: m.row.score }, m.kind === "next" ? gameDay(m.row.at) : playedDay(m.row.at))
      : null;
  const played = rows.filter((r) => r.status === "played");
  const inLibrary = played.filter((r) => library.has(r.matchId)).length;

  return (
    <section aria-label="Season" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {profile.standing && <span className="text-headline text-foreground nums">{standingLine(profile.standing)}</span>}
        {meetLine && <span className="text-body text-muted-foreground">{meetLine}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FormStrip rows={rows} library={library} />
        <span className="text-subheadline text-muted-foreground nums">{coverageLine(played.length, inLibrary)}</span>
        {watchAll && watchAll.plays > 0 && (
          <WatchLink onClick={watchAll.onWatch} icon className="nums">
            Watch all {watchAll.plays} {watchAll.plays === 1 ? "play" : "plays"}
          </WatchLink>
        )}
      </div>
    </section>
  );
}
