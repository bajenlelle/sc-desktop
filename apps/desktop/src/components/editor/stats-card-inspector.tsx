import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CardAspect } from "@scoutable/shared/lib/card-layout";
import {
  MAX_STAT_COLUMNS,
  autoDetails,
  availableColumns,
  formatCardDate,
  formatStat,
  normalizeColumns,
  statLabel,
  type StatKey,
  type StatsCardSpec,
} from "@scoutable/shared/lib/stats-card";
import type { League } from "@scoutable/shared/types/league";
import { Button } from "@/components/ui/button";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Stepper } from "@/components/ui/stepper";
import { loadGameStats, loadSeasonPlayer, makeGameCard, makeSeasonCard, seasonOf, type GameStats } from "@/lib/stats-card-data";
import { cn } from "@/lib/utils";
import type { StoredMatch } from "@/types/match";

/** The player's side in a game, from its stored events. */
function sideIn(match: StoredMatch, personId: string): "home" | "away" | null {
  const e = match.events?.find((ev) => String(ev.player?.playerId) === personId);
  if (!e?.player) return null;
  return e.player.teamNumber === 2 ? "away" : "home";
}

function gameLabel(match: StoredMatch, personId: string): string {
  const home = sideIn(match, personId) !== "away";
  return `${home ? "vs" : "@"} ${home ? match.awayTeam.name : match.homeTeam.name} · ${formatCardDate(match.date)}`;
}

function sourceLine(spec: StatsCardSpec): string {
  if (spec.source === "profixio") return "Counted from the play-by-play: baskets and fouls only";
  if (spec.source === "pbp") return "Counted from the play-by-play (no minutes or +/−)";
  if (spec.scope === "game") return "Official box score";
  return `Official season stats · as of ${formatCardDate(spec.asOf)}`;
}

/**
 * A stats card's settings, under the player while the card is on the stage
 * (the stage is the preview). Whose numbers, from which game or season, and
 * which of them show; the values themselves are never edited.
 */
export function StatsCardInspector({
  cardId,
  spec,
  durationSeconds,
  games,
  leagues,
  aspect,
  onAspectChange,
  onChange,
  onDurationChange,
  onHold,
}: {
  cardId: string;
  spec: StatsCardSpec;
  durationSeconds: number;
  /** The playlist's games that have stats. */
  games: StoredMatch[];
  leagues: League[];
  aspect: CardAspect;
  onAspectChange: (aspect: CardAspect) => void;
  onChange: (spec: StatsCardSpec) => void;
  onDurationChange: (seconds: number) => void;
  /** Editing holds the card on the stage. */
  onHold: () => void;
}) {
  const personId = spec.player.id;
  const theirGames = useMemo(() => games.filter((m) => sideIn(m, personId) !== null), [games, personId]);
  // The game the card's players and season come from.
  const contextMatch = useMemo(() => {
    if (spec.scope === "game") return games.find((m) => m.id === spec.game.matchId) ?? null;
    const competitionId = spec.season.competitionId;
    return theirGames.find((m) => seasonOf(m, leagues)?.competitionId === competitionId) ?? theirGames[0] ?? null;
  }, [spec, games, theirGames, leagues]);

  const [stats, setStats] = useState<GameStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; retry?: () => void } | null>(null);
  // Hand-picked columns survive a change of player or game; defaults don't.
  const [columnsTouched, setColumnsTouched] = useState(false);

  useEffect(() => {
    setColumnsTouched(false);
    setNote(null);
  }, [cardId]);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    if (contextMatch) {
      loadGameStats(contextMatch, leagues)
        .then((s) => !cancelled && setStats(s))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [contextMatch, leagues]);

  const season = contextMatch ? seasonOf(contextMatch, leagues) : null;
  const canSeason = !!season && spec.source !== "profixio";
  const keepColumns = columnsTouched ? spec.columns : undefined;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  function seasonCard(person: StatsCardSpec["player"], keep: Parameters<typeof makeSeasonCard>[3], seasonPick = season) {
    if (!seasonPick) return Promise.resolve();
    return loadSeasonPlayer(seasonPick.competitionId, person.id)
      .then((line) => {
        if (line) onChange(makeSeasonCard(seasonPick, person, line, keep));
        else setNote({ text: `${person.name} isn't listed in ${seasonPick.label}` });
      })
      .catch(() => setNote({ text: "Season averages aren't available right now", retry: () => void seasonCard(person, keep, seasonPick) }));
  }

  function choosePlayer(id: string) {
    const option = stats?.players.find((p) => p.player.id === id);
    if (!option || !contextMatch || !stats) return;
    // A new player starts with their own heading, details and defaults.
    const keep = { columns: keepColumns };
    if (spec.scope === "game") {
      onChange(makeGameCard(contextMatch, stats, option, season?.competitionId ?? null, keep));
    } else {
      void run(() => seasonCard(option.player, keep));
    }
  }

  function chooseScope(scope: "game" | "season") {
    if (scope === spec.scope || !contextMatch) return;
    // Columns differ between a game and a season, so the new line's defaults apply.
    const keep = { heading: spec.heading, details: spec.details };
    if (scope === "season") {
      void run(() => seasonCard(spec.player, keep));
      return;
    }
    void run(async () => {
      const gameStats = stats ?? (await loadGameStats(contextMatch, leagues));
      const option = gameStats?.players.find((p) => p.player.id === personId);
      if (gameStats && option) onChange(makeGameCard(contextMatch, gameStats, option, season?.competitionId ?? null, keep));
      else setNote({ text: `No stats for ${spec.player.name} in that game` });
    });
  }

  function chooseGame(matchId: string) {
    const match = games.find((m) => m.id === matchId);
    if (!match || spec.scope !== "game" || matchId === spec.game.matchId) return;
    void run(async () => {
      const gameStats = await loadGameStats(match, leagues);
      const option = gameStats?.players.find((p) => p.player.id === personId);
      if (!gameStats || !option) {
        setNote({ text: `No stats for ${spec.player.name} in that game` });
        return;
      }
      onChange(makeGameCard(match, gameStats, option, seasonOf(match, leagues)?.competitionId ?? null, {
        heading: spec.heading,
        details: spec.details,
        columns: keepColumns,
      }));
    });
  }

  function chooseSeason(competitionId: string) {
    if (spec.scope !== "season" || Number(competitionId) === spec.season.competitionId) return;
    const pick = theirGames.map((m) => seasonOf(m, leagues)).find((s) => s?.competitionId === Number(competitionId));
    if (!pick) return;
    void run(() => seasonCard(spec.player, { heading: spec.heading, details: spec.details, columns: keepColumns }, pick));
  }

  function updateSeason() {
    if (spec.scope !== "season") return;
    const current = spec;
    void run(() =>
      loadSeasonPlayer(current.season.competitionId, personId, { fresh: true })
        .then((line) => {
          if (!line) return;
          const changed = JSON.stringify(line.line) !== JSON.stringify(current.line);
          onChange({ ...current, line: line.line, asOf: new Date().toISOString(), columns: normalizeColumns(current.columns, { scope: "season", line: line.line }) });
          toast.success(changed ? "Season stats updated" : "Season stats are up to date");
        })
        .catch(() => setNote({ text: "Season averages aren't available right now", retry: updateSeason })),
    );
  }

  function toggleColumn(key: StatKey) {
    setColumnsTouched(true);
    const on = spec.columns.includes(key);
    const next = on ? spec.columns.filter((k) => k !== key) : [...spec.columns, key];
    onChange({ ...spec, columns: normalizeColumns(next, spec) } as StatsCardSpec);
  }

  const players = useMemo(() => {
    const list = stats?.players ?? [];
    const mySide = list.find((p) => p.player.id === personId)?.side;
    return [...list].sort((a, b) => (a.side === b.side ? b.line.pts - a.line.pts : a.side === mySide ? -1 : 1));
  }, [stats, personId]);

  const seasons = useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of theirGames) {
      const s = seasonOf(m, leagues);
      if (s) seen.set(s.competitionId, s.label);
    }
    return [...seen];
  }, [theirGames, leagues]);

  const playerOptions =
    players.length > 0
      ? players.map((p) => ({
          value: p.player.id,
          label: p.player.name,
          description: [p.player.number ? `#${p.player.number}` : null, p.player.teamName, `${p.line.pts} PTS`]
            .filter(Boolean)
            .join(" · "),
        }))
      : [{ value: personId, label: spec.player.name }];

  const available = availableColumns(spec);
  const field =
    "h-7 min-w-0 flex-1 rounded-md bg-card px-2 text-sm text-foreground ring-1 ring-separator outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-selection";

  return (
    <div className="flex flex-col gap-2 px-1" onPointerDownCapture={onHold} onFocusCapture={onHold}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="text-callout text-muted-foreground">Stats card</span>
        <PopUpButton
          size="sm"
          aria-label="Player"
          value={personId}
          onValueChange={choosePlayer}
          placeholder={spec.player.name}
          disabled={busy || players.length === 0}
          options={playerOptions}
        />
        {canSeason ? (
          <SegmentedControl
            aria-label="Show"
            value={spec.scope}
            onValueChange={chooseScope}
            options={[
              { value: "game", label: "Game", title: "This game's stat line" },
              { value: "season", label: "Season", title: "Averages over the season" },
            ]}
          />
        ) : (
          <span className="text-callout text-muted-foreground" title="Season averages need a league with official statistics">
            Game
          </span>
        )}
        {spec.scope === "game" ? (
          <PopUpButton
            size="sm"
            aria-label="Game"
            value={spec.game.matchId}
            onValueChange={chooseGame}
            disabled={busy || theirGames.length < 2}
            options={(theirGames.length > 0 ? theirGames : games.filter((m) => m.id === spec.game.matchId)).map((m) => ({
              value: m.id,
              label: gameLabel(m, personId),
            }))}
          />
        ) : (
          <PopUpButton
            size="sm"
            aria-label="Season"
            value={String(spec.season.competitionId)}
            onValueChange={chooseSeason}
            disabled={busy || seasons.length < 2}
            options={(seasons.length > 0 ? seasons : [[spec.season.competitionId, spec.season.label] as const]).map(([id, label]) => ({
              value: String(id),
              label,
            }))}
          />
        )}
        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Reading the stats" />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Stats on the card">
        {available.map((key) => {
          const on = spec.columns.includes(key);
          const full = !on && spec.columns.length >= MAX_STAT_COLUMNS;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={full}
              title={full ? `Up to ${MAX_STAT_COLUMNS} stats fit on a card` : undefined}
              onClick={() => toggleColumn(key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 outline-none transition-[background-color,color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-40 disabled:active:scale-100",
                on ? "bg-primary text-primary-foreground ring-transparent" : "bg-card text-foreground ring-separator hover:bg-fill-1",
              )}
            >
              <span className="font-medium">{statLabel(key)}</span>
              <span className="nums opacity-80">{formatStat(key, spec)}</span>
            </button>
          );
        })}
        <span className="ml-1 text-caption text-muted-foreground nums">
          {spec.columns.length} of {MAX_STAT_COLUMNS}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Heading"
          className={field}
          value={spec.heading ?? ""}
          placeholder={spec.player.name}
          onChange={(e) => onChange({ ...spec, heading: e.target.value || null })}
        />
        <input
          aria-label="Details"
          className={field}
          value={spec.details ?? ""}
          placeholder={autoDetails(spec.player) || "Details"}
          onChange={(e) => onChange({ ...spec, details: e.target.value || null })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Stepper label="Seconds on screen" value={durationSeconds} min={1} max={120} onChange={onDurationChange} format={(v) => `${v} s`} />
        </div>
        <SegmentedControl
          aria-label="Preview the card as"
          value={aspect}
          onValueChange={onAspectChange}
          options={[
            { value: "16:9", label: "Widescreen", title: "As the 16:9 export" },
            { value: "9:16", label: "Vertical", title: "As the 9:16 export" },
          ]}
        />
        <span className="text-caption text-muted-foreground">{sourceLine(spec)}</span>
        {spec.scope === "season" && spec.source === "genius_hosted" && (
          <Button variant="ghost" size="xs" disabled={busy} onClick={updateSeason}>
            Update
          </Button>
        )}
      </div>

      {note && (
        <p className="flex items-center gap-2 text-callout text-muted-foreground">
          {note.text}
          {note.retry && (
            <Button variant="ghost" size="xs" onClick={note.retry}>
              Try again
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
