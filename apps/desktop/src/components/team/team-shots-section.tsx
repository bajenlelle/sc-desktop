import { SHOT_ZONES, type ShotZone } from "@scoutable/shared/lib/game-shots";
import type { TeamVideo } from "@scoutable/shared/lib/team-video";
import { GroupHeader } from "@/components/ui/group";
import { courtPercent, HalfCourt } from "@/components/game/stats/half-court";
import { WatchLink } from "./watch-link";

const ZONE_LABEL: Record<ShotZone, string> = { rim: "At the rim", mid: "Mid-range", three: "Threes" };

/**
 * The team's field goals in the coach's games on one half court, basket at
 * the top (a filled dot a make, a ring a miss, as the Stats view draws them),
 * and made of attempted by zone, each opening those shots. Only games with
 * shot positions count, so the dots and the zones always agree; older games
 * are named in a line.
 */
export function TeamShotsSection({ shots, onWatch }: { shots: TeamVideo["shots"]; onWatch: (zone: ShotZone) => void }) {
  if (shots.games === 0 && shots.withoutPositions === 0) return null;
  const attempts = SHOT_ZONES.reduce((n, z) => n + shots.zones[z].attempts, 0);
  const games = `${shots.games} ${shots.games === 1 ? "game" : "games"}`;
  return (
    <section aria-label="Their shots in your games">
      <GroupHeader
        title="Their shots in your games"
        action={
          shots.games > 0 ? (
            <span className="text-subheadline text-muted-foreground nums">
              {games} · {attempts} {attempts === 1 ? "shot" : "shots"} · made of attempted
            </span>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-6 rounded-window bg-card p-4 ring-1 ring-separator">
        {shots.games > 0 && (
          <div className="w-72 shrink-0">
            <HalfCourt label="Their shots in your games: shot chart">
              {shots.dots.map((s) => {
                const { left, top } = courtPercent(s.x, s.y);
                return (
                  <span
                    key={s.key}
                    aria-hidden
                    className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      backgroundColor: s.made ? "var(--foreground)" : "transparent",
                      boxShadow: s.made ? undefined : "inset 0 0 0 1.5px var(--foreground)",
                      opacity: 0.8,
                    }}
                  />
                );
              })}
            </HalfCourt>
          </div>
        )}
        <div className="min-w-56 flex-1">
          {shots.games > 0 && (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-separator">
                {SHOT_ZONES.map((z) => (
                  <tr key={z}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {ZONE_LABEL[z]}
                    </th>
                    <td className="py-1.5 pr-3 text-right nums">
                      {shots.zones[z].made} of {shots.zones[z].attempts}
                    </td>
                    <td className="w-16 py-1.5 text-right">
                      {shots.zones[z].attempts > 0 && <WatchLink onClick={() => onWatch(z)} label={`Watch their shots: ${ZONE_LABEL[z]}`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-subheadline text-muted-foreground">
            {shots.games > 0 ? "From the plays in your games, not the season." : "Your games of theirs have no shot positions."}
            {shots.games > 0 && shots.withoutPositions > 0 && (
              <> Leaves out {shots.withoutPositions} {shots.withoutPositions === 1 ? "game" : "games"} imported before shot positions.</>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
