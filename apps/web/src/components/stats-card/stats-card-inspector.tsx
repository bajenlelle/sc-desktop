"use client";

import * as React from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CardAspect } from "@scoutable/shared/lib/card-layout";
import {
  MAX_STAT_COLUMNS,
  autoDetails,
  availableColumns,
  fallbackText,
  formatCardDate,
  formatStat,
  normalizeColumns,
  rankPlayersByClips,
  statLabel,
  type StatKey,
  type StatsCardPlayer,
  type StatsCardSeason,
  type StatsCardSpec,
} from "@scoutable/shared/lib/stats-card";
import type { League } from "@scoutable/shared/types/league";
import type { PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout, FORM_ROW_INPUT, FormRow, GroupedList } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  isHostedLayoutError,
  loadGameStats,
  loadSeasonPlayer,
  makeGameCard,
  makeSeasonCard,
  seasonOf,
  statsKindOf,
  type CardKeep,
  type GameStats,
  type StatsPlayerOption,
} from "@/lib/stats-card-data";
import { cn } from "@/lib/utils";
import { CardImage } from "./card-image";

export interface StatsCardInspectorProps {
  open: boolean;
  /** Cancel, Escape, a click outside, and after onSave. */
  onClose: () => void;
  /**
   * The game the card reads, with its events loaded: a new card's (the
   * anchor clip's game, or the default player's most-clipped one), or the
   * edited card's game (a season card: one of the player's games in it).
   */
  match: StoredMatch;
  /** Clip events a new card picks its player from: the most clips wins (one event = that clip's player). */
  events: PlayByPlayEvent[];
  leagues: League[];
  /** The card being edited; absent for a new card. */
  initial?: StatsCardSpec;
  /** The card and its readable line (playlist_clips.text_content). The dialog then closes itself. */
  onSave: (spec: StatsCardSpec, fallbackText: string) => void;
  /**
   * Optional: the playlist's games that have stats, for the Game and Season
   * pickers (the desktop inspector's `games`). Defaults to `match` alone.
   */
  games?: StoredMatch[];
  /**
   * Optional: what a new card shows first. "season" (the desktop's choice for
   * a playlist of several games) shows season averages when the league
   * publishes them, else the game line. Defaults to "game".
   */
  defaultScope?: "game" | "season";
}

interface Note {
  text: string;
  tone?: "neutral" | "warning";
  retry?: () => void;
}

const NO_STATS = "No stats for this game. Stats cards need a game imported with its league play-by-play.";
const NO_PLAYERS = "No one has a stat line in this game yet.";
const FEDERATION_SEASON = "The federation changed its stats pages, so season averages can't be read right now.";
const FEDERATION_DEFAULT = "The federation changed its stats pages, so the card shows this game's line instead of season averages.";
const SEASON_UNAVAILABLE = "Season averages aren't available right now.";

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

/** The clip player with the most clips who played in the game, else the game's top scorer. */
function defaultOption(stats: GameStats, events: readonly PlayByPlayEvent[]): StatsPlayerOption | null {
  const inGame = new Map(stats.players.map((p) => [p.player.id, p]));
  for (const p of rankPlayersByClips(events)) {
    const option = inGame.get(p.playerId);
    if (option) return option;
  }
  return [...stats.players].sort((a, b) => b.line.pts - a.line.pts)[0] ?? null;
}

type DefaultCard = { spec: StatsCardSpec; note: Note | null } | { error: string };

/** A new card's first state, as the desktop's defaultStatsCard builds it. */
async function defaultCard(
  match: StoredMatch,
  events: readonly PlayByPlayEvent[],
  leagues: League[],
  scope: "game" | "season",
): Promise<DefaultCard> {
  const stats = await loadGameStats(match, leagues);
  if (!stats) return { error: NO_STATS };
  const option = defaultOption(stats, events);
  if (!option) return { error: NO_PLAYERS };
  const season = seasonOf(match, leagues);
  let note: Note | null = null;
  if (scope === "season" && season) {
    try {
      const seasonPlayer = await loadSeasonPlayer(season.competitionId, option.player.id);
      if (seasonPlayer) return { spec: makeSeasonCard(season, option.player, seasonPlayer), note: null };
    } catch (e) {
      // Otherwise the game line, as on the desktop.
      if (isHostedLayoutError(e)) note = { text: FEDERATION_DEFAULT, tone: "warning" };
    }
  }
  return { spec: makeGameCard(match, stats, option, season?.competitionId ?? null), note };
}

/** Everyone's line in a game, for the player picker; reloads when the game or its season changes. */
function useGameStats(match: StoredMatch | null, leagues: League[]): GameStats | null {
  const competitionId = match ? (seasonOf(match, leagues)?.competitionId ?? null) : null;
  const key = match ? `${match.id}:${competitionId ?? ""}:${match.events?.length ?? 0}` : null;
  const [result, setResult] = React.useState<{ key: string; stats: GameStats | null } | null>(null);
  React.useEffect(() => {
    if (!match || !key) return;
    let cancelled = false;
    loadGameStats(match, leagues).then(
      (stats) => {
        if (!cancelled) setResult({ key, stats });
      },
      () => {
        if (!cancelled) setResult({ key, stats: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return result?.key === key ? result.stats : null;
}

/**
 * A stats card's settings in a dialog (a sheet on phones), with the card
 * itself as the preview: whose numbers, from which game or season, and which
 * of them show; the values are never edited. The desktop's inspector, which
 * sits under its stage, ported. It only hands back the card: putting it in
 * the playlist (and trackStatsCardInserted) is the caller's.
 */
export function StatsCardInspector(props: StatsCardInspectorProps) {
  const { open, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <InspectorBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted while the dialog is open, so every opening starts from its props. */
function InspectorBody({ onClose, match, events, leagues, initial, onSave, games, defaultScope = "game" }: StatsCardInspectorProps) {
  // As opened: a caller that clears `initial` while the dialog closes doesn't change its words on the way out.
  const [openedWith] = React.useState(() => initial ?? null);
  const isNew = openedWith === null;

  const [spec, setSpec] = React.useState<StatsCardSpec | null>(openedWith);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pendingScope, setPendingScope] = React.useState<"game" | "season" | null>(null);
  const [note, setNote] = React.useState<Note | null>(null);
  const [aspect, setAspect] = React.useState<CardAspect>("16:9");
  // Hand-picked columns survive a change of player or game; defaults don't.
  const [columnsTouched, setColumnsTouched] = React.useState(false);

  // The latest values, for page loads that land after more typing.
  const latest = React.useRef({ spec, columnsTouched });
  React.useLayoutEffect(() => {
    latest.current = { spec, columnsTouched };
  });
  const touched = React.useRef(false);
  const edit = (next: StatsCardSpec) => {
    touched.current = true;
    setSpec(next);
  };

  // A new card: its defaults, built again if the game's season becomes known
  // (the league catalogue refreshing) before anything was changed.
  const matchCompetition = seasonOf(match, leagues)?.competitionId ?? null;
  const defaultKey = isNew ? `${match.id}:${matchCompetition ?? ""}:${match.events?.length ?? 0}` : null;
  React.useEffect(() => {
    if (!defaultKey) return;
    let cancelled = false;
    defaultCard(match, events, leagues, defaultScope).then(
      (result) => {
        if (cancelled || touched.current) return;
        if ("error" in result) {
          if (!latest.current.spec) setFailure(result.error);
          return;
        }
        setFailure(null);
        setSpec(result.spec);
        setNote(result.note);
      },
      () => {
        if (!cancelled && !latest.current.spec) setFailure(NO_STATS);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [defaultKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allGames = React.useMemo(() => {
    const byId = new Map<string, StoredMatch>();
    for (const m of [match, ...(games ?? [])]) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()];
  }, [match, games]);
  const personId = spec?.player.id ?? "";
  const theirGames = React.useMemo(
    () => allGames.filter((m) => statsKindOf(m) !== null && sideIn(m, personId) !== null),
    [allGames, personId],
  );
  // The game the card's players and season come from.
  const contextMatch = React.useMemo(() => {
    if (!spec) return null;
    if (spec.scope === "game") return allGames.find((m) => m.id === spec.game.matchId) ?? null;
    const competitionId = spec.season.competitionId;
    return theirGames.find((m) => seasonOf(m, leagues)?.competitionId === competitionId) ?? theirGames[0] ?? null;
  }, [spec, allGames, theirGames, leagues]);
  const stats = useGameStats(contextMatch, leagues);

  const season = contextMatch ? seasonOf(contextMatch, leagues) : null;
  const canSeason = !!season && spec?.source !== "profixio";

  // One page load at a time: a newer choice wins, and an older answer is dropped.
  const seq = React.useRef(0);
  async function run(work: (current: () => boolean) => Promise<void>) {
    const mine = ++seq.current;
    setBusy(true);
    setNote(null);
    try {
      await work(() => seq.current === mine);
    } finally {
      if (seq.current === mine) {
        setBusy(false);
        setPendingScope(null);
      }
    }
  }
  function cancelRun() {
    seq.current++;
    setBusy(false);
    setPendingScope(null);
  }

  /** The overrides as they are now, so typing while a page loads isn't lost. */
  const overrides = (): CardKeep => ({ heading: latest.current.spec?.heading ?? null, details: latest.current.spec?.details ?? null });
  const pickedColumns = (): StatKey[] | undefined => (latest.current.columnsTouched ? latest.current.spec?.columns : undefined);

  function seasonCard(person: StatsCardPlayer, keep: () => CardKeep, pick: StatsCardSeason | null, current: () => boolean): Promise<void> {
    if (!pick) return Promise.resolve();
    return loadSeasonPlayer(pick.competitionId, person.id)
      .then((line) => {
        if (!current()) return;
        if (line) edit(makeSeasonCard(pick, person, line, keep()));
        else setNote({ text: `${person.name} isn't listed in ${pick.label}.` });
      })
      .catch((e: unknown) => {
        if (!current()) return;
        setNote(
          isHostedLayoutError(e)
            ? { text: FEDERATION_SEASON, tone: "warning" }
            : { text: SEASON_UNAVAILABLE, retry: () => void run((c) => seasonCard(person, keep, pick, c)) },
        );
      });
  }

  function choosePlayer(id: string) {
    const option = stats?.players.find((p) => p.player.id === id);
    if (!spec || !option || !contextMatch || !stats) return;
    // A new player starts with their own heading, details and defaults.
    const keep = () => ({ columns: pickedColumns() });
    if (spec.scope === "game") {
      cancelRun();
      edit(makeGameCard(contextMatch, stats, option, season?.competitionId ?? null, keep()));
    } else {
      void run((current) => seasonCard(option.player, keep, season, current));
    }
  }

  function chooseScope(scope: "game" | "season") {
    if (!spec || !contextMatch) return;
    if (scope === spec.scope) {
      cancelRun();
      return;
    }
    // Columns differ between a game and a season, so the new line's defaults apply.
    const person = spec.player;
    const from = contextMatch;
    setPendingScope(scope);
    if (scope === "season") {
      void run((current) => seasonCard(person, overrides, season, current));
      return;
    }
    void run(async (current) => {
      const gameStats = stats ?? (await loadGameStats(from, leagues));
      if (!current()) return;
      const option = gameStats?.players.find((p) => p.player.id === person.id);
      if (gameStats && option) edit(makeGameCard(from, gameStats, option, season?.competitionId ?? null, overrides()));
      else setNote({ text: `No stats for ${person.name} in that game.` });
    });
  }

  function chooseGame(matchId: string) {
    const target = allGames.find((m) => m.id === matchId);
    if (!target || !spec || spec.scope !== "game" || matchId === spec.game.matchId) return;
    const person = spec.player;
    void run(async (current) => {
      const gameStats = await loadGameStats(target, leagues);
      if (!current()) return;
      const option = gameStats?.players.find((p) => p.player.id === person.id);
      if (!gameStats || !option) {
        setNote({ text: `No stats for ${person.name} in that game.` });
        return;
      }
      edit(makeGameCard(target, gameStats, option, seasonOf(target, leagues)?.competitionId ?? null, { ...overrides(), columns: pickedColumns() }));
    });
  }

  function chooseSeason(value: string) {
    if (!spec || spec.scope !== "season" || Number(value) === spec.season.competitionId) return;
    const pick = theirGames.map((m) => seasonOf(m, leagues)).find((s) => s?.competitionId === Number(value)) ?? null;
    if (!pick) return;
    const person = spec.player;
    void run((current) => seasonCard(person, () => ({ ...overrides(), columns: pickedColumns() }), pick, current));
  }

  function updateSeason() {
    if (!spec || spec.scope !== "season") return;
    const { competitionId, label } = spec.season;
    const person = spec.player;
    const before = JSON.stringify(spec.line);
    void run(async (current) => {
      try {
        const fresh = await loadSeasonPlayer(competitionId, person.id, { fresh: true });
        if (!current()) return;
        if (!fresh) {
          setNote({ text: `${person.name} isn't listed in ${label} any more.` });
          return;
        }
        touched.current = true;
        // Into the card as it is now (the heading may have changed meanwhile).
        setSpec((s) =>
          s && s.scope === "season" && s.season.competitionId === competitionId && s.player.id === person.id
            ? { ...s, line: fresh.line, asOf: new Date().toISOString(), columns: normalizeColumns(s.columns, { scope: "season", line: fresh.line }) }
            : s,
        );
        toast.success(JSON.stringify(fresh.line) !== before ? "Season stats updated" : "Season stats are up to date");
      } catch (e) {
        if (!current()) return;
        setNote(isHostedLayoutError(e) ? { text: FEDERATION_SEASON, tone: "warning" } : { text: SEASON_UNAVAILABLE, retry: updateSeason });
      }
    });
  }

  function toggleColumn(key: StatKey) {
    if (!spec) return;
    setColumnsTouched(true);
    const on = spec.columns.includes(key);
    const next = on ? spec.columns.filter((k) => k !== key) : [...spec.columns, key];
    edit({ ...spec, columns: normalizeColumns(next, spec) } as StatsCardSpec);
  }

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!spec || busy) return;
    onSave(spec, fallbackText(spec));
    onClose();
  }

  const players = React.useMemo(() => {
    const list = stats?.players ?? [];
    const mySide = list.find((p) => p.player.id === personId)?.side;
    return [...list].sort((a, b) => (a.side === b.side ? b.line.pts - a.line.pts : a.side === mySide ? -1 : 1));
  }, [stats, personId]);

  const seasons = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of theirGames) {
      const s = seasonOf(m, leagues);
      if (s) seen.set(s.competitionId, s.label);
    }
    return [...seen];
  }, [theirGames, leagues]);

  const ids = React.useId();
  const loading = isNew && !spec && !failure;
  // A Genius game in a known season whose box score couldn't be read.
  const boxScoreMissing = spec?.scope === "game" && spec.source === "pbp" && spec.game.competitionId !== null;

  return (
    <form onSubmit={save} className="contents">
      <DialogHeader>
        <DialogTitle>{isNew ? "Add stats card" : "Edit stats card"}</DialogTitle>
        <DialogDescription>A player&rsquo;s numbers from one game or the season, shown full screen in the playlist.</DialogDescription>
      </DialogHeader>

      <div className={cn("flex flex-col gap-2", failure && !spec && "hidden")}>
        <div
          aria-busy={loading || busy}
          className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-separator"
        >
          {spec && <CardImage source={{ text: fallbackText(spec), card: spec }} aspect={aspect} className="absolute inset-0 size-full" />}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-callout text-white/70">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Reading the official stats…
            </div>
          )}
          {busy && spec && (
            <span className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white/80 ring-1 ring-white/15 backdrop-blur-md">
              <Loader2 className="size-4 animate-spin" aria-label="Reading the stats" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <SegmentedControl
            aria-label="Preview the card as"
            value={aspect}
            onValueChange={setAspect}
            options={[
              { value: "16:9", label: "Widescreen", title: "As the 16:9 export" },
              { value: "9:16", label: "Vertical", title: "As the 9:16 export" },
            ]}
          />
          {spec && <span className="text-caption text-muted-foreground">{sourceLine(spec)}</span>}
        </div>
      </div>

      {failure && (
        <Callout tone="warning" icon={<AlertTriangle />}>
          {failure}
        </Callout>
      )}

      {spec && (
        <>
          <GroupedList>
            <FormRow label="Player" htmlFor={`${ids}-player`}>
              <PopUpButton
                id={`${ids}-player`}
                align="end"
                value={personId}
                onValueChange={choosePlayer}
                placeholder={spec.player.name}
                disabled={busy || players.length === 0}
                options={
                  players.length > 0
                    ? players.map((p) => ({
                        value: p.player.id,
                        label: p.player.name,
                        description: [p.player.number ? `#${p.player.number}` : null, p.player.teamName, `${p.line.pts} PTS`]
                          .filter(Boolean)
                          .join(" · "),
                      }))
                    : [{ value: personId, label: spec.player.name }]
                }
              />
            </FormRow>
            <FormRow label="Show" description={canSeason ? undefined : "No season averages for this league"}>
              {canSeason ? (
                <SegmentedControl
                  aria-label="Show"
                  value={pendingScope ?? spec.scope}
                  onValueChange={chooseScope}
                  options={[
                    { value: "game", label: "Game", title: "This game's stat line" },
                    { value: "season", label: "Season", title: "Averages over the season" },
                  ]}
                />
              ) : (
                <span className="text-sm text-muted-foreground">Game line</span>
              )}
            </FormRow>
            {spec.scope === "game" ? (
              <FormRow label="Game" htmlFor={`${ids}-game`}>
                <PopUpButton
                  id={`${ids}-game`}
                  align="end"
                  value={spec.game.matchId}
                  onValueChange={chooseGame}
                  disabled={busy || theirGames.length < 2}
                  placeholder={`${spec.game.home ? "vs" : "@"} ${spec.game.opponent} · ${formatCardDate(spec.game.date)}`}
                  options={(theirGames.length > 0 ? theirGames : allGames.filter((m) => m.id === spec.game.matchId)).map((m) => ({
                    value: m.id,
                    label: gameLabel(m, personId),
                  }))}
                />
              </FormRow>
            ) : (
              <FormRow label="Season" htmlFor={`${ids}-season`}>
                <PopUpButton
                  id={`${ids}-season`}
                  align="end"
                  value={String(spec.season.competitionId)}
                  onValueChange={chooseSeason}
                  disabled={busy || seasons.length < 2}
                  options={(seasons.length > 0 ? seasons : [[spec.season.competitionId, spec.season.label] as const]).map(([id, label]) => ({
                    value: String(id),
                    label,
                  }))}
                />
                {spec.source === "genius_hosted" && (
                  <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={updateSeason} title="Read the season stats again">
                    Update
                  </Button>
                )}
              </FormRow>
            )}
            <FormRow label="Heading" htmlFor={`${ids}-heading`}>
              <Input
                id={`${ids}-heading`}
                className={FORM_ROW_INPUT}
                value={spec.heading ?? ""}
                placeholder={spec.player.name}
                autoComplete="off"
                onChange={(e) => edit({ ...spec, heading: e.target.value || null })}
              />
            </FormRow>
            <FormRow label="Details" htmlFor={`${ids}-details`}>
              <Input
                id={`${ids}-details`}
                className={FORM_ROW_INPUT}
                value={spec.details ?? ""}
                placeholder={autoDetails(spec.player) || "Details"}
                autoComplete="off"
                onChange={(e) => edit({ ...spec, details: e.target.value || null })}
              />
            </FormRow>
          </GroupedList>

          <StatColumns spec={spec} onToggle={toggleColumn} />
        </>
      )}

      <div aria-live="polite" className="empty:hidden">
        {note ? (
          <Callout
            tone={note.tone ?? "neutral"}
            icon={note.tone === "warning" ? <AlertTriangle /> : <Info />}
            action={
              note.retry && (
                <Button type="button" variant="ghost" size="xs" onClick={note.retry}>
                  Try again
                </Button>
              )
            }
          >
            {note.text}
          </Callout>
        ) : boxScoreMissing ? (
          <Callout icon={<Info />}>The official box score isn&rsquo;t available, so the numbers are counted from the play-by-play.</Callout>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {!(failure && !spec) && (
          <Button type="submit" disabled={!spec || busy}>
            {isNew ? "Add card" : "Save card"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

/** Which numbers the card shows: every one this line has, up to six on. */
function StatColumns({ spec, onToggle }: { spec: StatsCardSpec; onToggle: (key: StatKey) => void }) {
  const available = availableColumns(spec);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="text-headline text-foreground">Stats on the card</span>
        <span className="text-callout text-muted-foreground nums">
          {spec.columns.length} of {MAX_STAT_COLUMNS}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stats on the card">
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
              onClick={() => onToggle(key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 outline-none transition-[background-color,color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-40 disabled:active:scale-100 pointer-coarse:px-3 pointer-coarse:py-1.5 pointer-coarse:text-sm",
                on ? "bg-primary text-primary-foreground ring-transparent" : "bg-card text-foreground ring-separator hover:bg-fill-1",
              )}
            >
              <span className="font-medium">{statLabel(key)}</span>
              <span className="nums opacity-80">{formatStat(key, spec)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
