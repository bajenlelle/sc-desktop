import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/shell/toolbar";
import { ScoutingReportDialog, type ScoutingReportRun } from "@/components/editor/scouting-report-dialog";
import { PlaylistViewSwitch } from "@/components/editor/playlist-view-switch";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import { trackEvent } from "@/lib/analytics";
import { useKeyScope, useHotkeys } from "@/lib/key-scope";
import { useReducedMotionSafe } from "@/lib/motion";
import { IS_MACOS } from "@/lib/platform";
import { pool, type GenerateOutcome } from "@/lib/scouting-report";
import type { MyScoutingReport } from "@/lib/scouting-reports-db";
import { leagueSeasonsOf, loadSeasonPlayers, seasonOf, statsKindOf } from "@/lib/stats-card-data";
import { cn } from "@/lib/utils";
import type { HostedSeasonPlayer } from "@scoutable/shared/lib/hosted-stats";
import { pruneSelection } from "@scoutable/shared/lib/list-selection";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { playerRoster, type PlayerChoice } from "@scoutable/shared/lib/player-roster";
import {
  LEFT_OUT,
  TEAM_SECTION,
  addSections,
  defaultOpponent,
  deriveReportLayout,
  includeClips,
  moveClips,
  moveSection,
  nudgeClips,
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
import { reportClipSource, type ReportClipSource } from "@scoutable/shared/lib/report-clip-source";
import { buildScoutingReport, reportOutline } from "@scoutable/shared/lib/scouting-report";
import type { Label } from "@scoutable/shared/types/labels";
import type { League } from "@scoutable/shared/types/league";
import type { OrgPlanTier } from "@scoutable/shared/types/org";
import { isClipItem, type PlayByPlayEvent, type Playlist, type StoredMatch } from "@/types/match";
import { ReportDocument, clipDomSelector, sectionDomId, type SectionStatsContext, type ViewClip, type ViewSection } from "./report-document";
import { ReportOutline, type MoveVia, type OutlineClipInfo, type OutlineSectionInfo } from "./report-outline";
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
  /** Another playlist's report was stopped from the share sheet: the page forgets what it held for it. */
  onOtherReportStopped: (playlistId: string) => void;
  /** The space's plan tier: the share sheet reports it with its events. */
  plan: OrgPlanTier;
  onUpgrade: () => void;
  /** Why sharing is off (a demo game), else null. */
  shareDisabledReason: string | null;
  /** Prepares the clips and previews and publishes (the page owns the pipeline). */
  runReport: (draft: ReportDraft, run: ScoutingReportRun) => Promise<GenerateOutcome>;
  onBack: () => void;
  /** Edit clip: back to the playlist with this clip selected. */
  onOpenClip: (key: string) => void;
  /** The playlist's seconds before and after each play, as the Clips view plays them. */
  preRoll: number;
  postRoll: number;
  /** The game's video file when it is on this computer, else null. */
  localVideoPath: (matchId: string) => string | null;
}

const STATS_CONCURRENCY = 3;

/** Playlists whose picker opened by itself this session: once is a welcome, twice is in the way. */
const autoOpened = new Set<string>();
/** The side panel's folded sections per playlist, for the session; the left-out clips start folded. */
const collapsedByPlaylist = new Map<string, ReadonlySet<Placement>>();
const FLASH_MS = 1200;

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
  const { playlist, eventByKey, matchLookup, leagues, myReport, onBack, onOpenClip, preRoll, postRoll, localVideoPath } = props;
  const items = playlist.items;
  const reducedMotion = useReducedMotionSafe();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { draft, isNew, status, apply, stepHistory, removeSectionWithUndo, reload } = useReportDraft({ playlistId: playlist.id, items });

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

  // The report's shape, the Team section kept so it can be written in and dropped on.
  const layout = useMemo(() => (draft ? deriveReportLayout(draft, items, eventByKey, { keepTeam: true }) : null), [draft, items, eventByKey]);
  // The document's sections: the layout joined with the plays.
  const sections = useMemo((): ViewSection[] => {
    if (!layout) return [];
    const join = (item: (typeof layout.leftOut)[number]): ViewClip => ({ key: itemKey(item), item, event: eventByKey.get(itemKey(item))! });
    return layout.sections.map((s) => ({ id: s.id, section: s.section, clips: s.clips.map(join) }));
  }, [layout, eventByKey]);
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
    const n = (k: number) => (k === 1 ? "1 player" : `${k} players`);
    const label = removedIds.length > 0 && c.added.length > 0 ? "Change players" : removedIds.length > 0 ? `Remove ${n(removedIds.length)}` : `Add ${n(c.added.length)}`;
    apply((d) => {
      let next = d;
      for (const id of removedIds) next = removeSection(next, id);
      const before = next.sections.length;
      next = addSections(next, players);
      newIds = next.sections.slice(before).map((s) => s.id);
      return next;
    }, label);
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

  const sectionInfo = useMemo(() => {
    const m = new Map<Placement, OutlineSectionInfo>([[TEAM_SECTION, { label: "Team", number: null, statsLoading: false }]]);
    for (const s of draft?.sections ?? []) m.set(s.id, { label: s.player.name, number: s.player.number, statsLoading: statsLoading.has(s.id) });
    m.set(LEFT_OUT, { label: "Not in report", number: null, statsLoading: false });
    return m;
  }, [draft?.sections, statsLoading]);

  const clipInfo = useMemo(() => {
    const m = new Map<string, OutlineClipInfo>();
    if (!layout) return m;
    const add = (item: (typeof layout.leftOut)[number], playerId: string | null) => {
      const key = itemKey(item);
      const event = eventByKey.get(key);
      if (!event) return;
      // The section says who it's about; a play by someone else names them.
      const actor = event.player && String(event.player.playerId) !== playerId ? event.player.familyName || null : null;
      m.set(key, { item, event, actor, game: matchLookup.get(item.matchId)?.title ?? null, labels: props.labelNamesByClip.get(key) ?? [] });
    };
    for (const s of layout.sections) for (const item of s.clips) add(item, s.section?.player.id ?? null);
    for (const item of layout.leftOut) add(item, null);
    return m;
  }, [layout, eventByKey, matchLookup, props.labelNamesByClip]);

  const [collapsed, setCollapsedState] = useState<ReadonlySet<Placement>>(() => collapsedByPlaylist.get(playlist.id) ?? new Set([LEFT_OUT]));
  const setCollapsed = useCallback(
    (next: ReadonlySet<Placement>) => {
      collapsedByPlaylist.set(playlist.id, next);
      setCollapsedState(next);
    },
    [playlist.id],
  );
  function toggleCollapsed(id: Placement, all: boolean) {
    const fold = !collapsed.has(id);
    if (all) {
      setCollapsed(fold ? new Set([...(layout?.sections.map((s) => s.id) ?? []), LEFT_OUT]) : new Set());
      return;
    }
    const next = new Set(collapsed);
    if (fold) next.add(id);
    else next.delete(id);
    setCollapsed(next);
  }

  // The side panel's selection of clips (⌘-click, ⇧-click); the document rings them too.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const selectClips = useCallback((next: Set<string>, nextAnchor: string | null) => {
    setSelected(next);
    setAnchor(nextAnchor);
  }, []);
  // Clips that left the panel (a folded section, the playlist) leave the selection.
  useEffect(() => {
    if (!layout) return;
    const shown = [...layout.sections.filter((s) => !collapsed.has(s.id)).flatMap((s) => s.clips), ...(collapsed.has(LEFT_OUT) ? [] : layout.leftOut)].map(itemKey);
    setSelected((prev) => pruneSelection(prev, shown));
  }, [layout, collapsed]);

  /** Where every clip sits now, to name an edit and to tell a reorder from a move. */
  const placeOf = useMemo(() => {
    const m = new Map<string, Placement>();
    for (const s of layout?.sections ?? []) for (const c of s.clips) m.set(itemKey(c), s.id);
    for (const c of layout?.leftOut ?? []) m.set(itemKey(c), LEFT_OUT);
    return m;
  }, [layout]);

  const moveClipsTo = useCallback(
    (keys: string[], to: Placement, before: string | null, via: MoveVia) => {
      if (keys.length === 0) return;
      const from = new Set(keys.map((k) => placeOf.get(k)));
      const noun = keys.length === 1 ? "1 clip" : `${keys.length} clips`;
      const label = to === LEFT_OUT ? `Leave out ${noun}` : from.size === 1 && from.has(LEFT_OUT) ? `Put back ${noun}` : `Move ${noun}`;
      const moved = apply((d) => moveClips(d, deriveReportLayout(d, items, eventByKey, { keepTeam: true }), keys, to, before), label);
      if (!moved) return;
      // A clip moved into a folded section shows where it went.
      if (via === "keys" && collapsed.has(to)) {
        const next = new Set(collapsed);
        next.delete(to);
        setCollapsed(next);
      }
      trackEvent("scouting_report_clip_moved", {
        to: to === TEAM_SECTION ? "team" : to === LEFT_OUT ? "out" : "player",
        clips: keys.length,
        via,
        reorder: from.size === 1 && from.has(to),
      });
    },
    [apply, items, eventByKey, placeOf, collapsed, setCollapsed],
  );

  const nudge = useCallback(
    (keys: string[], dir: -1 | 1) => {
      if (!layout) return;
      const target = nudgeClips(layout, keys, dir);
      if (target) moveClipsTo(keys, target.to, target.before, "keys");
    },
    [layout, moveClipsTo],
  );

  const include = useCallback(
    (keys: string[], via: MoveVia) => {
      const noun = keys.length === 1 ? "1 clip" : `${keys.length} clips`;
      if (apply((d) => includeClips(d, keys), `Put back ${noun}`)) trackEvent("scouting_report_clip_moved", { to: "in", clips: keys.length, via, reorder: false });
    },
    [apply],
  );

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

  // A clip picked in the side panel: its tile comes into view and lights up for a moment.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);
  function showClip(key: string) {
    scrollRef.current?.querySelector<HTMLElement>(clipDomSelector(key))?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    setFlashKey(key);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashKey(null), FLASH_MS);
  }

  // The clip playing in its tile. One at a time: only that tile holds a video.
  // `at` is its section when it started: a clip that leaves the report, or
  // whose section goes, stops. `via` "tile" hands its player the keyboard.
  const [playing, setPlaying] = useState<{ key: string; at: Placement; via: "tile" | "panel" } | null>(null);
  const clipByKey = useMemo(() => new Map(sections.flatMap((s) => s.clips.map((clip) => [clip.key, { clip, at: s.id }] as const))), [sections]);
  const livePlaying = playing && clipByKey.get(playing.key)?.at === playing.at ? playing : null;
  useEffect(() => {
    if (playing && !livePlaying) setPlaying(null);
  }, [playing, livePlaying]);

  const sourceOf = useCallback(
    (clip: ViewClip): ReportClipSource =>
      reportClipSource({
        item: clip.item,
        event: clip.event,
        videoPath: localVideoPath(clip.item.matchId),
        syncPoint: matchLookup.get(clip.item.matchId)?.syncPoint ?? null,
        preRoll,
        postRoll,
      }),
    [localVideoPath, matchLookup, preRoll, postRoll],
  );
  const playingClip = livePlaying ? clipByKey.get(livePlaying.key)?.clip : undefined;
  const playingSource = useMemo(() => (playingClip ? sourceOf(playingClip) : null), [playingClip, sourceOf]);

  /** A click on a tile plays it there; a row in the side panel also brings the tile into view. */
  function playClip(key: string, via: "tile" | "panel") {
    const found = clipByKey.get(key);
    if (!found) return;
    if (via === "panel") showClip(key);
    if (livePlaying?.key === key) return;
    setPlaying({ key, at: found.at, via });
    trackEvent("scouting_report_clip_played", { via, source: sourceOf(found.clip).kind });
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
    // ⌘Z / ⇧⌘Z for the report's structure; a text field keeps its own (useHotkeys skips fields).
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const done = k === "z" ? stepHistory(e.shiftKey ? "redo" : "undo") : k === "y" && !IS_MACOS && !e.shiftKey ? stepHistory("redo") : false;
      if (done) e.preventDefault();
      return;
    }
    if (e.key === "Escape" && !pickerOpen && !shareOpen) {
      e.preventDefault();
      // The playing clip stops first, then the selection goes, then the view.
      if (livePlaying) setPlaying(null);
      else if (selected.size > 0) selectClips(new Set(), null);
      else onBack();
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
      subtitle="Scouting report"
      actions={
        <>
          {saveCaption && <span className={cn("text-caption text-muted-foreground", status === "error" && "text-destructive")}>{saveCaption}</span>}
          <Button variant="outline" size="sm" onClick={openPicker} disabled={!draft}>
            <UserPlus />
            Add players
          </Button>
          <Button
            size="sm"
            onClick={() => {
              // Read the report again so the sheet's open count is fresh each time it opens.
              props.onRefreshReport();
              setShareOpen(true);
            }}
            disabled={!draft || !!props.shareDisabledReason}
            title={props.shareDisabledReason ?? undefined}
          >
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
        {layout ? (
          <ReportOutline
            layout={layout}
            sectionInfo={sectionInfo}
            clipInfo={clipInfo}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            activeId={activeId}
            selected={selected}
            anchor={anchor}
            onSelectionChange={selectClips}
            reducedMotion={reducedMotion}
            onShowSection={scrollTo}
            onShowClip={showClip}
            onPlayClip={(key) => playClip(key, "panel")}
            onMoveSection={(id, to) => apply((d) => moveSection(d, id, to), "Move player")}
            onRemoveSection={removeWithUndo}
            onMoveClips={moveClipsTo}
            onNudgeClips={nudge}
            onIncludeClips={include}
            onOpenClip={onOpenClip}
            onAddPlayers={openPicker}
          />
        ) : (
          <div className="w-[288px] shrink-0 border-r border-separator" />
        )}
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
                leftOutCount={layout?.leftOut.length ?? 0}
                selected={selected}
                flashKey={flashKey}
                playingKey={livePlaying?.key ?? null}
                playingSource={playingSource}
                focusPlayer={livePlaying?.via === "tile"}
                onPlayClip={(key) => playClip(key, "tile")}
                onStopClip={() => setPlaying(null)}
                onMoveClips={(keys, to) => moveClipsTo(keys, to, null, "menu")}
                onOpenClip={onOpenClip}
                onRemoveSection={removeWithUndo}
              />
              {draft.sections.length === 0 && (
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
          onOtherReportStopped={props.onOtherReportStopped}
          playlistId={playlist.id}
          plan={props.plan}
          onUpgrade={props.onUpgrade}
          run={run}
        />
      )}
    </div>
  );
});
