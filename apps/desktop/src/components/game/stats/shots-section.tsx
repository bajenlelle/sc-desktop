import { matchProvider } from "@scoutable/shared/lib/provider";
import { useMemo, useState } from "react";
import { eventLabel, playClock } from "@scoutable/shared/lib/events";
import { SHOT_ZONES, zoneCells, type ChartShot, type gameShots, type ShotZone } from "@scoutable/shared/lib/game-shots";
import type { PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import { GroupHeader } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { teamTints } from "../team-tints";
import { courtPercent, HalfCourt } from "./half-court";
import { StatCell, type OpenPlays } from "./stat-cell";
import { SideTeamLink } from "./side-team-link";

const ZONE: Record<ShotZone, { label: string; set: string }> = {
  rim: { label: "At the rim", set: "shots at the rim" },
  mid: { label: "Mid-range", set: "mid-range shots" },
  three: { label: "Threes", set: "threes" },
};

type People = ReadonlyMap<number, { number: string; name: string }>;

/**
 * Where each team shot from: a half court per team with every field goal, a
 * filled dot for a make and a ring for a miss, and makes of attempts by zone
 * under it. A dot opens its play; a zone opens its shots. Games imported
 * before shot positions were stored say so instead.
 */
export function ShotsSection({
  match,
  shots,
  people,
  onOpen,
}: {
  match: StoredMatch;
  shots: ReturnType<typeof gameShots>;
  people: People;
  onOpen: OpenPlays;
}) {
  const tints = useMemo(() => teamTints(match.homeTeam.color, match.awayTeam.color), [match.homeTeam.color, match.awayTeam.color]);
  const byId = useMemo(() => new Map(match.events.map((e) => [e.eventId, e])), [match.events]);
  return (
    <section>
      <GroupHeader title="Shots" />
      {!shots.hasPositions ? (
        <p className="rounded-window bg-card px-4 py-3 text-subheadline text-muted-foreground ring-1 ring-separator">
          {matchProvider(match) === "profixio"
            ? "This league doesn’t record where shots are taken."
            : "Shot positions come with games imported since September 2026."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <TeamShots side={1} name={match.homeTeam.name || "Home"} shots={shots.home} tint={tints.home} people={people} byId={byId} onOpen={onOpen} />
          <TeamShots side={2} name={match.awayTeam.name || "Away"} shots={shots.away} tint={tints.away} people={people} byId={byId} onOpen={onOpen} />
        </div>
      )}
    </section>
  );
}

function TeamShots({
  side,
  name,
  shots,
  tint,
  people,
  byId,
  onOpen,
}: {
  side: 1 | 2;
  name: string;
  shots: readonly ChartShot[];
  tint: string;
  people: People;
  byId: ReadonlyMap<number, PlayByPlayEvent>;
  onOpen: OpenPlays;
}) {
  const [who, setWho] = useState<string>("all");
  const shooters = useMemo(() => {
    const ids = [...new Set(shots.map((s) => s.personId).filter((id): id is number => id !== null))];
    return ids
      .map((id) => ({ id, ...(people.get(id) ?? { number: "", name: "Unknown" }), count: shots.filter((s) => s.personId === id).length }))
      .sort((a, b) => b.count - a.count);
  }, [shots, people]);
  const shown = who === "all" ? shots : shots.filter((s) => String(s.personId) === who);
  const whoName = who === "all" ? name : (people.get(Number(who))?.name ?? name);
  const zones = zoneCells(shown);

  return (
    <div className="rounded-window bg-card p-4 ring-1 ring-separator">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SideTeamLink side={side} name={name} className="truncate font-medium" />
        <PopUpButton
          size="sm"
          align="end"
          aria-label={`Whose shots: ${name}`}
          value={who}
          onValueChange={setWho}
          options={[
            { value: "all", label: "All players" },
            ...shooters.map((s) => ({ value: String(s.id), label: `${s.number ? `#${s.number} ` : ""}${s.name}`, description: `${s.count} shots` })),
          ]}
        />
      </div>
      <HalfCourt label={`${whoName}: shot chart`}>
        {shown.map((s) => {
          const e = byId.get(s.eventId);
          const shooter = s.personId !== null ? people.get(s.personId)?.name : null;
          const words = [shooter, e && eventLabel(e), e && playClock(e)].filter(Boolean).join(" · ");
          const { left, top } = courtPercent(s.x, s.y);
          return (
            <button
              key={s.eventId}
              type="button"
              title={words}
              aria-label={`${words}, show play`}
              onClick={() => onOpen({ name: words, eventIds: [s.eventId] }, { kind: "shot" })}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition-transform duration-100 hover:scale-150 active:scale-125 focus-visible:ring-2 focus-visible:ring-selection"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                backgroundColor: s.made ? tint : "transparent",
                boxShadow: s.made ? undefined : `inset 0 0 0 1.5px ${tint}`,
              }}
            />
          );
        })}
      </HalfCourt>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-subheadline">
        {SHOT_ZONES.map((z) => (
          <span key={z} className="whitespace-nowrap">
            <span className="text-muted-foreground">{ZONE[z].label} </span>
            <StatCell
              cell={zones[z]}
              name={`${whoName}: ${ZONE[z].set}`}
              display={`${zones[z].value}/${zones[z].attempts ?? 0}`}
              onOpen={(set) => onOpen(set, { kind: "zone", stat: z })}
            />
          </span>
        ))}
      </p>
    </div>
  );
}
