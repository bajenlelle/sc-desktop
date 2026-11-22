import { Fragment } from "react";
import type { PointsFrom } from "@scoutable/shared/lib/game-box";
import { PROFILE_SCALE, type End, type GroupSeason, type ProfileKey, type TeamProfile } from "@scoutable/shared/lib/league-season";
import { ordinal } from "@scoutable/shared/lib/season-copy";
import { paceLine, placeTooltip } from "@scoutable/shared/lib/team-copy";
import { KEY_EDGE, MIN_KEY_GAMES } from "@scoutable/shared/lib/team-keys";
import { FACTORS } from "@/components/game/stats/factors-section";
import { FactorBar, WithHover } from "@/components/game/stats/factor-bar";
import { GroupHeader } from "@/components/ui/group";
import { cn } from "@/lib/utils";

type RowKey = Exclude<ProfileKey, "pace">;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** How they play's rows, in order; a report's How they play writes the same (lib/report-season.ts). */
export const PROFILE_ROWS: { key: RowKey; label: string; help: string; format: (v: number) => string }[] = [
  ...FACTORS,
  { key: "threeRate", label: "Share of shots from three", help: "Three-point attempts as a share of all field-goal attempts.", format: pct },
];

export const POINTS_FROM: { key: PointsFrom; label: string }[] = [
  { key: "paint", label: "the paint" },
  { key: "second_chance", label: "second chances" },
  { key: "fast_break", label: "fast breaks" },
  { key: "turnovers", label: "turnovers" },
  { key: "bench", label: "the bench" },
];

/** The bars' colour: neutral, so no colour says good or bad. */
const BAR = "var(--color-muted-foreground)";

/**
 * How the team plays at both ends: its offence grows left from each label and
 * what it allows grows right, on the game Stats view's fixed scales, with the
 * group's average as a 2 px line. Beside each number, its place in the group.
 * Season numbers: nothing here opens plays.
 */
export function TeamProfileSection({ profile, group, where }: { profile: TeamProfile; group: GroupSeason | null; where: string | null }) {
  const placed = profile.games >= MIN_KEY_GAMES;
  const caption = `Season, ${profile.games} ${profile.games === 1 ? "game" : "games"} · the line marks the league average${placed ? "" : ". Places appear after 5 games."}`;

  const Place = ({ end, k }: { end: End; k: RowKey }) => {
    const place = profile.place[end][k];
    if (!placed || place === null) return <span />;
    const strong = place <= KEY_EDGE || place > profile.of - KEY_EDGE;
    return (
      <WithHover hover={placeTooltip(place, profile.of, where)}>
        <span className={cn("nums", strong ? "text-foreground" : "text-muted-foreground")}>{ordinal(place)}</span>
      </WithHover>
    );
  };

  const perGame = POINTS_FROM.filter((f) => profile.perGame[f.key] !== null).map((f) => `${f.label} ${Math.round(profile.perGame[f.key]!)}`);

  return (
    <section aria-label="How they play">
      <GroupHeader title="How they play" action={<span className="text-subheadline text-muted-foreground">{caption}</span>} />
      <div className="rounded-window bg-card px-4 py-3 ring-1 ring-separator">
        <div className="grid grid-cols-[3.5rem_2.5rem_minmax(0,1fr)_minmax(9rem,auto)_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2 gap-y-2 text-sm">
          <span />
          <span />
          <span className="text-right text-caption-1 text-muted-foreground">Their offence</span>
          <span />
          <span className="text-caption-1 text-muted-foreground">What they allow</span>
          <span />
          <span />
          {PROFILE_ROWS.map((r) => {
            const own = profile.own[r.key];
            const allowed = profile.allowed[r.key];
            return (
              <Fragment key={r.key}>
                <span className="text-right nums">{own === null ? "–" : r.format(own)}</span>
                <span className="text-right">
                  <Place end="own" k={r.key} />
                </span>
                <FactorBar value={own} mark={group?.mean.own[r.key] ?? null} scale={PROFILE_SCALE[r.key]} colour={BAR} grow="left" />
                <WithHover hover={r.help}>
                  <span className="text-center text-muted-foreground">{r.label}</span>
                </WithHover>
                <FactorBar value={allowed} mark={group?.mean.allowed[r.key] ?? null} scale={PROFILE_SCALE[r.key]} colour={BAR} grow="right" />
                <span>
                  <Place end="allowed" k={r.key} />
                </span>
                <span className="nums">{allowed === null ? "–" : r.format(allowed)}</span>
              </Fragment>
            );
          })}
        </div>
        <div className="mt-3 space-y-0.5 border-t border-separator pt-2 text-subheadline text-muted-foreground">
          {profile.own.pace !== null && <p>{paceLine(profile.own.pace, placed ? profile.place.own.pace : null, profile.of)}</p>}
          {perGame.length > 0 && <p>Points a game from {perGame.join(" · ")}</p>}
        </div>
      </div>
    </section>
  );
}
