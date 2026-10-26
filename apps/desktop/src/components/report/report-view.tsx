import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/shell/toolbar";
import { ScoutingReportDialog, type ScoutingReportRun } from "@/components/editor/scouting-report-dialog";
import { PlaylistViewSwitch } from "@/components/editor/playlist-view-switch";
import { Badge } from "@/components/ui/badge";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import { trackEvent } from "@/lib/analytics";
import { useKeyScope, useHotkeys } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { pool, type GenerateOutcome } from "@/lib/scouting-report";
import type { MyScoutingReport } from "@/lib/scouting-reports-db";
import { leagueSeasonsOf, loadSeasonPlayers, seasonOf, statsKindOf } from "@/lib/stats-card-data";
import { cn } from "@/lib/utils";
import type { HostedSeasonPlayer } from "@scoutable/shared/lib/hosted-stats";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { playerRoster, type PlayerChoice } from "@scoutable/shared/lib/player-roster";
import {
  TEAM_SECTION,
  addSections,
  defaultOpponent,
  deriveReportLayout,
  moveClip,
  moveSection,
  removeSection,
  setIntro,
  setNote,
  setOpponent,
  setSectionPlayer,
  setStats,
  setTitle,
  type DraftSection,
  type Placement,
  type ReportDraft,
} from "@scoutable/shared/lib/report-draft";
import { leaderCompetition, leaderRows } from "@scoutable/shared/lib/report-leaders";
import { buildScoutingReport, reportOutline } from "@scoutable/shared/lib/scouting-report";
import type { Label } from "@scoutable/shared/types/labels";
import type { League } from "@scoutable/shared/types/league";
import { isClipItem, type PlayByPlayEvent, type Playlist, type StoredMatch } from "@/types/match";
import { ReportDocument, sectionDomId, type SectionStatsContext, type ViewSection } from "./report-document";
import { ReportOutline, type OutlineRow } from "./report-outline";
import { ReportPlayerPicker, type PickerConfirm } from "./report-player-picker";
import { usePlayerStats, type StatsPerson } from "./use-player-stats";
import { useReportDraft } from "./use-report-draft";

export interface ReportViewProps {
  /**
   * Where the toolbar goes: the page's own toolbar row, full width above the
   * playlist browser, the same place as the clips toolbar, so the view switch
   * and the browser stay put when the view changes.
   */
  toolbarSlot: HTMLElement | null;
  playlist: Playlist;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  matchLookup: ReadonlyMap<string, StoredMatch>;
  leagues: League[];
  isMultiMatch: boolean;
  labels: Label[];
  clipAssignments: ReadonlyMap<string, ReadonlySet<string>>;
  /** The coach's labels per clip, by name, for the published report. */
  labelNamesByClip: ReadonlyMap<string, string[]>;
  /** The playlist's report that is not switched off, if any. */
  myReport: MyScoutingReport | null;
  onRefreshReport: () => void;
  /** The space is on a free plan: Share opens the upgrade dialog. */
  blockedByPlan: boolean;
  onUpgrade: () => void;
  /** Why sharing is off (a demo game), else null. */
  shareDisabledReason: string | null;
  /** Prepares the clips and previews and publishes (the page owns the pipeline). */
  runReport: (draft: ReportDraft, run: ScoutingReportRun) => Promise<GenerateOutcome>;
  onBack: () => void;
  /** Back to the playlist with this clip selected. */
  onOpenClip: (key: string) => void;
}

const STATS_CONCURRENCY = 3;

/** Playlists whose picker opened by itself this session: once is a welcome, twice is in the way. */
const autoOpened = new Set<string>();

function toPerson(p: PlayerChoice): StatsPerson {
  return { playerId: p.playerId, name: p.name, number: p.number, teamName: p.teamName, matchId: p.matchId };
}

/**
 * The scouting report next to its playlist: the outline on the left, the
 * document on the right, the player picker and the share sheet over it. The
 * page keeps the playlist, its plays and the publish pipeline; this view
 * keeps the draft (use-report-draft) and the players' numbers
 * (use-player-stats), and never changes the playlist.
 */
export const ReportView = memo(function ReportView(props: ReportViewProps) {
  const { playlist, eventByKey, matchLookup, leagues, myReport, onBack, onOpenClip } = props;
  const items = playlist.items;
  const reducedMotion = useReducedMotionSafe();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { draft, isNew, status, apply, removeSectionWithUndo, reload } = useReportDraft({ playlistId: playlist.id, items });

  // The playlist's games and the clips whose game has stats, for the roster and the numbers.
  const clipGames = useMemo(() => {
    const seen = new Set<string>();
    return items.flatMap((i) => {
      if (!isClipItem(i) || seen.has(i.matchId)) return [];
      const m = matchLookup.get(i.matchId);
      if (!m) return [];
      seen.add(m.id);
      return [m];
    });
  }, [items, matchLookup]);
  const statsClips = useMemo(
    () =>
      items.flatMap((i) => {
        if (!isClipItem(i) || statsKindOf(matchLookup.get(i.matchId)) === null) return [];
        const event = eventByKey.get(itemKey(i));
        return event ? [{ matchId: i.matchId, event }] : [];
      }),
    [items, matchLookup, eventByKey],
  );
  const { boxScores, statsMatchIdOf, readPlayerStats, ensureBoxScores } = usePlayerStats({ statsClips, matchLookup, leagues });

  const taken = useMemo(() => new Set(draft?.sections.map((s) => s.player.id) ?? []), [draft?.sections]);
  const roster = useMemo(() => playerRoster({ items, eventByKey, matches: matchLookup, boxScores, taken }), [items, eventByKey, matchLookup, boxScores, taken]);
  const rosterById = useMemo(() => new Map(roster.map((p) => [p.playerId, p])), [roster]);

  // The document's sections: the layout joined with the plays.
  const sections = useMemo((): ViewSection[] => {
    if (!draft) return [];
    return deriveReportLayout(draft, items, eventByKey).sections.map((s) => ({
      id: s.id,
      section: s.section,
      clips: s.clips.map((item) => ({ key: itemKey(item), item, event: eventByKey.get(itemKey(item))! })),
    }));
  }, [draft, items, eventByKey]);
  const clipCount = sections.reduce((n, s) => n + s.clips.length, 0);

  // ---------------------------------------------------------------------------
  // The players' numbers
  // ---------------------------------------------------------------------------

  const [statsLoading, setStatsLoading] = useState<ReadonlySet<string>>(() => new Set());
  const [statsFailed, setStatsFailed] = useState<ReadonlySet<string>>(() => new Set());
  const mark = (set: typeof setStatsLoading, id: string, on: boolean) =>
    set((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Reads a section's player's numbers into it (and the player as the box score names them). */
  const readInto = useCallback(
    async (sectionId: string, person: StatsPerson, preferMatchId?: string, competitionId?: number) => {
      mark(setStatsLoading, sectionId, true);
      mark(setStatsFailed, sectionId, false);
      try {
        const r = await readPlayerStats(person, preferMatchId, competitionId);
        apply((d) => {
          const s = d.sections.find((x) => x.id === sectionId);
          // The section changed player while the numbers were read: they aren't its numbers.
          if (!s || s.player.id !== person.playerId) return d;
          return setStats(setSectionPlayer(d, sectionId, r.player), sectionId, r.stats);
        });
        mark(setStatsFailed, sectionId, !r.stats && r.failed);
      } catch {
        mark(setStatsFailed, sectionId, true);
      } finally {
        mark(setStatsLoading, sectionId, false);
      }
    },
    [readPlayerStats, apply],
  );

  const statsContextOf = useCallback(
    (section: DraftSection): SectionStatsContext => {
      const matchId = statsMatchIdOf({ playerId: section.player.id, matchId: rosterById.get(section.player.id)?.matchId });
      const match = matchId ? matchLookup.get(matchId) : undefined;
      const seasons = match ? leagueSeasonsOf(match, leagues) : [];
      return {
        seasons,
        gameSeasonId: match ? (seasonOf(match, leagues)?.competitionId ?? null) : null,
        canRead: seasons.length > 0 || statsKindOf(match) !== null,
      };
    },
    [statsMatchIdOf, rosterById, matchLookup, leagues],
  );

  function retryStats(sectionId: string, competitionId?: number) {
    const section = draft?.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const choice = rosterById.get(section.player.id);
    const person: StatsPerson = { playerId: section.player.id, name: section.player.name, number: section.player.number, teamName: section.player.teamName, matchId: choice?.matchId };
    const matchId = statsMatchIdOf(person);
    void readInto(sectionId, person, matchId, competitionId);
  }

  // ---------------------------------------------------------------------------
  // The picker
  // ---------------------------------------------------------------------------

  const [pickerOpen, setPickerOpen] = useState(false);
  const [seasons, setSeasons] = useState<ReadonlyMap<number, ReadonlyMap<string, HostedSeasonPlayer>>>(() => new Map());
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    void ensureBoxScores(clipGames);
    const wanted = [...new Set(clipGames.flatMap((m) => seasonOf(m, leagues)?.competitionId ?? []))].filter((id) => !seasons.has(id));
    if (wanted.length === 0) return;
    setSeasonsLoading(true);
    void Promise.all(
      wanted.map(async (id) => {
        const players = await loadSeasonPlayers(id).catch(() => null);
        if (players) setSeasons((prev) => new Map(prev).set(id, players));
      }),
    ).finally(() => setSeasonsLoading(false));
  }, [ensureBoxScores, clipGames, leagues, seasons]);

  // A playlist whose report doesn't exist yet opens on the picker, once.
  useEffect(() => {
    if (status !== "ready" || !draft || !isNew || draft.sections.length > 0 || autoOpened.has(playlist.id)) return;
    autoOpened.add(playlist.id);
    openPicker();
  }, [status, draft, isNew, playlist.id, openPicker]);

  // Once per time the view opens (it is keyed by playlist).
  const openTracked = useRef(false);
  useEffect(() => {
    if (openTracked.current || !draft || status === "loading") return;
    openTracked.current = true;
    trackEvent("scouting_report_opened", { players: draft.sections.length, clips: clipCount, has_draft: !isNew, shared: !!myReport });
  }, [draft, status, clipCount, isNew, myReport]);

  // Players just added: the first one's section scrolls into view with its note ready to type in.
  useEffect(() => {
    if (!focusSectionId) return;
    const id = focusSectionId;
    setFocusSectionId(null);
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionDomId(id));
      el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      el?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    });
  }, [focusSectionId, reducedMotion]);

  const leaderRowsAll = useMemo(
    () => leaderRows(roster, (p) => leaderCompetition(p, items, matchLookup, leagues), seasons),
    [roster, items, matchLookup, leagues, seasons],
  );
  const noted = useMemo(() => new Set(draft?.sections.filter((s) => s.note.trim()).map((s) => s.player.id) ?? []), [draft?.sections]);
  const initialTicked = useMemo(() => (taken.size === 0 ? new Set(roster.filter((p) => p.clips > 0).map((p) => p.playerId)) : taken), [taken, roster]);

  function handlePicked(c: PickerConfirm) {
    if (!draft) return;
    const removedIds = c.removed.map((pid) => draft.sections.find((s) => s.player.id === pid)?.id).filter((id): id is string => !!id);
    const players = c.added.map((p) => ({ id: p.playerId, name: p.name, number: p.number, teamId: null, teamName: p.teamName }));
    let newIds: string[] = [];
    apply((d) => {
      let next = d;
      for (const id of removedIds) next = removeSection(next, id);
      const before = next.sections.length;
      next = addSections(next, players);
      newIds = next.sections.slice(before).map((s) => s.id);
      return next;
    });
    if (newIds[0]) setFocusSectionId(newIds[0]);
    trackEvent("scouting_report_players_picked", {
      players: draft.sections.length - removedIds.length + newIds.length,
      added: newIds.length,
      removed: removedIds.length,
      with_clips: c.added.filter((p) => p.clips > 0).length,
      from_leaders: c.fromLeaders,
      sorted_by: c.sortedBy,
    });
    // Their numbers, a few at a time; the season pages are warm from the picker.
    const added = c.added.slice(0, newIds.length);
    void pool(added, STATS_CONCURRENCY, new AbortController().signal, (p) => readInto(newIds[added.indexOf(p)], toPerson(p), p.matchId));
  }

  // ---------------------------------------------------------------------------
  // The outline and the document
  // ---------------------------------------------------------------------------

  const outlineRows: OutlineRow[] = sections.map((s) => ({
    id: s.id,
    label: s.section ? s.section.player.name : "Team",
    number: s.section?.player.number ?? null,
    clips: s.clips.length,
    statsLoading: !!s.section && statsLoading.has(s.section.id),
  }));

  const [activeId, setActiveId] = useState<Placement | null>(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>("[data-section-id]");
    if (targets.length === 0) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.sectionId!;
          if (e.isIntersecting) visible.set(id, e.boundingClientRect.top);
          else visible.delete(id);
        }
        if (visible.size === 0) return;
        setActiveId([...visible.entries()].sort((a, b) => a[1] - b[1])[0][0]);
      },
      { root, rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [sections.length, sections.map((s) => s.id).join("|")]);

  function scrollTo(id: Placement) {
    document.getElementById(sectionDomId(id))?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    setActiveId(id);
  }

  function removeWithUndo(id: string) {
    const clips = sections.find((s) => s.id === id)?.clips.length ?? 0;
    removeSectionWithUndo(id, clips);
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  const [shareOpen, setShareOpen] = useState(false);
  const liveReport = myReport && new Date(myReport.expiresAt).getTime() > Date.now() ? myReport : null;
  const effectiveTitle = draft?.title ?? playlist.name;
  const effectiveOpponent = draft ? (draft.opponent ?? defaultOpponent(draft)) : null;
  // What the page would say now, to compare with what was shared. Built only while it matters.
  const built = useMemo(() => {
    if (!draft || (!shareOpen && !liveReport)) return null;
    return buildScoutingReport({
      draft,
      playlist: { items },
      eventByKey,
      matchLabel: (id) => matchLookup.get(id)?.title ?? "",
      title: effectiveTitle,
      opponent: effectiveOpponent,
      labelsByKey: props.labelNamesByClip,
    });
  }, [draft, shareOpen, liveReport, items, eventByKey, matchLookup, effectiveTitle, effectiveOpponent, props.labelNamesByClip]);
  // The last one stays for the share sheet's closing animation.
  const lastBuilt = useRef(built);
  if (built) lastBuilt.current = built;
  const shownBuilt = built ?? lastBuilt.current;
  const stale = !!liveReport && !!built && liveReport.contentKey !== built.contentKey;
  const summary = useMemo(() => {
    const rows = draft ? reportOutline(draft, items, eventByKey) : [];
    const players = rows.filter((r) => r.id !== TEAM_SECTION);
    return { players: players.length, clips: rows.reduce((n, r) => n + r.clips, 0), empty: players.filter((r) => !r.note && r.clips === 0).length };
  }, [draft, items, eventByKey]);

  const run = useCallback((a: ScoutingReportRun) => (draft ? props.runReport(draft, a) : Promise.reject(new Error("No report"))), [draft, props]);

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  // No container: the toolbar sits outside the view's own box. The scope still yields to open dialogs.
  useKeyScope("report", true);
  useHotkeys("report", (e) => {
    if (e.key === "Escape" && !pickerOpen && !shareOpen) {
      e.preventDefault();
      onBack();
    }
  });

  const saveCaption =
    status === "saving" ? "Saving…" : status === "error" ? "Not saved" : status === "ready" && !isNew ? "Saved" : null;
  const shareLabel = liveReport ? (stale ? "Changed since sharing" : "Shared") : "Share";

  const toolbar = (
    <Toolbar
      variant="static"
      leading={<PlaylistViewSwitch value="report" onChange={(v) => v === "clips" && onBack()} sharedStatus={liveReport ? `Shared · expires ${formatCardDate(liveReport.expiresAt)}` : null} />}
      title={playlist.name}
      subtitle={
        <span className="flex items-center gap-1.5">
          Scouting report
          <Badge variant="secondary" className="px-1.5 text-caption">
            Beta
          </Badge>
        </span>
      }
      actions={
        <>
          {saveCaption && <span className={cn("text-caption text-muted-foreground", status === "error" && "text-destructive")}>{saveCaption}</span>}
          <Button variant="outline" size="sm" onClick={openPicker} disabled={!draft}>
            <UserPlus />
            Add players
          </Button>
          <Button size="sm" onClick={() => setShareOpen(true)} disabled={!draft || !!props.shareDisabledReason} title={props.shareDisabledReason ?? undefined}>
            {props.blockedByPlan && <Lock />}
            {liveReport && <span aria-hidden className={cn("size-1.5 rounded-full", stale ? "bg-warning" : "bg-success")} />}
            {shareLabel}
          </Button>
        </>
      }
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {props.toolbarSlot && createPortal(toolbar, props.toolbarSlot)}
      <div className="flex min-h-0 flex-1">
        <ReportOutline rows={outlineRows} activeId={activeId} reducedMotion={reducedMotion} onSelect={scrollTo} onMove={(id, to) => apply((d) => moveSection(d, id, to))} onRemove={removeWithUndo} onAddPlayers={openPicker} />
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          {draft ? (
            <>
              <ReportDocument
                draft={draft}
                sections={sections}
                playlistName={playlist.name}
                defaultOpponent={defaultOpponent(draft)}
                isMultiMatch={props.isMultiMatch}
                matchLookup={matchLookup}
                labels={props.labels}
                clipAssignments={props.clipAssignments}
                games={clipGames}
                leagues={leagues}
                statsLoading={statsLoading}
                statsFailed={statsFailed}
                statsContextOf={statsContextOf}
                onTitle={(t) => apply((d) => setTitle(d, t))}
                onOpponent={(o) => apply((d) => setOpponent(d, o))}
                onIntro={(i) => apply((d) => setIntro(d, i))}
                onNote={(id, n) => apply((d) => setNote(d, id, n))}
                onStats={(id, s) => apply((d) => setStats(d, id, s))}
                onRetryStats={retryStats}
                onMoveClip={(key, to) => {
                  apply((d) => moveClip(d, key, to));
                  trackEvent("scouting_report_clip_moved", { to: to === TEAM_SECTION ? "team" : "player" });
                }}
                onOpenClip={onOpenClip}
                onRemoveSection={removeWithUndo}
              />
              {sections.length === 0 && (
                <div className="mx-auto flex w-full max-w-[680px] flex-col items-start gap-3 px-8 pb-10">
                  <p className="text-body text-muted-foreground">No players yet. Add players to start the report.</p>
                  <Button variant="outline" size="sm" onClick={openPicker}>
                    <UserPlus />
                    Add players
                  </Button>
                </div>
              )}
            </>
          ) : status === "error" ? (
            <div className="flex flex-col items-start gap-3 px-8 py-10">
              <p className="text-body text-foreground">Couldn’t open the report. Check the connection and try again.</p>
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="px-8 py-10 text-callout text-muted-foreground">Opening the report…</p>
          )}
        </div>
      </div>

      <ReportPlayerPicker open={pickerOpen} onOpenChange={setPickerOpen} rows={leaderRowsAll} inReport={taken} noted={noted} initialTicked={initialTicked} loading={seasonsLoading} onConfirm={handlePicked} />

      {draft && shownBuilt && (
        <ScoutingReportDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          summary={summary}
          contentKey={shownBuilt.contentKey}
          existing={myReport}
          onExistingChange={props.onRefreshReport}
          blockedByPlan={props.blockedByPlan}
          onUpgrade={props.onUpgrade}
          run={run}
        />
      )}
    </div>
  );
});
