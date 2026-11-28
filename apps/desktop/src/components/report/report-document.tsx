import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, ChevronDown, EyeOff, Loader2, MoreHorizontal, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { AddSectionItems, addableSections } from "@/components/report/add-section-items";
import { StatsCardInspector } from "@/components/editor/stats-card-inspector";
import { LabelChip } from "@/components/labels/LabelChip";
import { useReportFrame } from "@/lib/report-frames";
import { cn } from "@/lib/utils";
import { GameLink, TeamLink } from "@/components/entity-link";
import { eventColors, eventLabel, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import {
  LEFT_OUT,
  REPORT_BLOCK_TEXT_LIMIT,
  REPORT_BLOCK_TITLE_MAX,
  REPORT_INTRO_LIMIT,
  REPORT_NOTE_LIMIT,
  REPORT_TITLE_MAX,
  TEAM_SECTION,
  blocksOf,
  canRemoveBlock,
  holdsClips,
  holdsText,
  sectionLabel,
  type DraftSection,
  type Placement,
  type ReportBlock,
  type ReportBlockKind,
  type ReportDraft,
} from "@scoutable/shared/lib/report-draft";
import { reportSectionTitle, type ReportSeasonSnapshot } from "@scoutable/shared/lib/scouting-report";
import type { ReportClipEffects, ReportClipSource, ReportFrameRequest } from "@scoutable/shared/lib/report-clip-source";
import { cardContent, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import type { Label } from "@scoutable/shared/types/labels";
import type { League } from "@scoutable/shared/types/league";
import type { PlayByPlayEvent, PlaylistClipItem, StoredMatch } from "@/types/match";
import { PlayerPhoto } from "./player-photo";
import { ReportClipPlayer } from "./report-clip-player";

/** One clip as the document shows it: the item, and the play it is. */
export interface ViewClip {
  key: string;
  item: PlaylistClipItem;
  event: PlayByPlayEvent;
}

/** A section of the document: a player's (`section`), or one of the draft's blocks (`block`). */
export interface ViewSection {
  id: Placement;
  section: DraftSection | null;
  block: ReportBlock | null;
  /** Players don't see it. */
  hidden: boolean;
  clips: ViewClip[];
}

/** What a player's section can read its numbers from, for the no-stats line and the season picker. */
export interface SectionStatsContext {
  seasons: { competitionId: number; label: string }[];
  gameSeasonId: number | null;
  canRead: boolean;
}

export interface ReportDocumentProps {
  draft: ReportDraft;
  sections: ViewSection[];
  /** What the title shows when the draft has none. */
  playlistName: string;
  /** What the opponent shows when the draft has none. */
  defaultOpponent: string | null;
  isMultiMatch: boolean;
  matchLookup: ReadonlyMap<string, StoredMatch>;
  labels: Label[];
  clipAssignments: ReadonlyMap<string, ReadonlySet<string>>;
  /** The playlist's games, for the stats controls. */
  games: StoredMatch[];
  leagues: League[];
  statsLoading: ReadonlySet<string>;
  statsFailed: ReadonlySet<string>;
  statsContextOf: (section: DraftSection) => SectionStatsContext;
  /** Roster photo keys by player id (use-player-photos). */
  photos: ReadonlyMap<string, string>;
  /** Clips the coach left out of the report (the side panel lists them). */
  leftOutCount: number;
  /** The side panel's selected clips: a tile's menu acts on all of them. */
  selected: ReadonlySet<string>;
  /** The clip the side panel just showed, lit up for a moment. */
  flashKey: string | null;
  /** The clip playing in its tile (one at a time), what it plays, and whether its player takes the keyboard. */
  playingKey: string | null;
  playingSource: ReportClipSource | null;
  /** The playing clip's drawings and slow motion, in the time of what it plays. */
  playingEffects: ReportClipEffects | null;
  /** Where a tile's still comes from (its first frame); null when nothing can play. */
  frameOf: (clip: ViewClip) => ReportFrameRequest | null;
  focusPlayer: boolean;
  /** Goes up when the side panel's row for the playing clip is clicked again (see ReportClipPlayer). */
  playRequest: number;
  onPlayClip: (key: string) => void;
  onStopClip: () => void;
  onTitle: (title: string) => void;
  /** The Title field takes the keyboard when the page opens (a blank report). */
  focusTitle?: boolean;
  onOpponent: (opponent: string) => void;
  onIntro: (intro: string) => void;
  onNote: (id: string, note: string) => void;
  onStats: (id: string, stats: StatsCardSpec) => void;
  onRetryStats: (id: string, competitionId?: number) => void;
  /** To a section's end, or out of the report (LEFT_OUT). */
  onMoveClips: (keys: string[], to: Placement) => void;
  /** Edit clip: the clip in the Clips view. */
  onOpenClip: (key: string) => void;
  onRemoveSection: (id: string) => void;
  /** How they play and Their games as the report would show them now; null without a team or before its season is read. */
  season: ReportSeasonSnapshot | null;
  /** The report was started from a team, so the season's sections have something to show. */
  hasTeam: boolean;
  onBlockText: (id: string, text: string) => void;
  onBlockTitle: (id: string, title: string) => void;
  onBlockHidden: (id: string, hidden: boolean) => void;
  /** One place up (-1) or down (1) among the sections. */
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onRemoveBlock: (id: string) => void;
  onAddBlock: (kind: ReportBlockKind) => void;
  /** + Add clips under a section's clips: the Add clips sheet, adding to that section. Undefined draws none (the editor's view). */
  onAddClips?: (sectionId: Placement) => void;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The id a section's element carries, so the outline can scroll to it. */
export const sectionDomId = (id: Placement) => `report-section-${id}`;
/** Finds a clip's tile, for the outline to scroll to. */
export const clipDomSelector = (key: string) => `[data-clip-key="${CSS.escape(key)}"]`;

/** The editor's keys stay out of the fields; Esc commits by leaving the field. */
function fieldKeys(e: KeyboardEvent<HTMLElement>, opts: { enterBlurs?: boolean } = {}) {
  e.stopPropagation();
  if (e.key === "Escape" || (opts.enterBlurs && e.key === "Enter") || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/**
 * A text field that reads like the document: no frame, the body font, growing
 * with its lines up to a cap. Local state mirrors the draft so typing never
 * waits on a save; an edit that came from elsewhere is taken unless this field
 * is mid-typing.
 */
function GrowingText({
  value,
  onChange,
  placeholder,
  maxLength,
  maxLines,
  autoFocus,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  maxLines: number;
  autoFocus?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, maxLines * 24 + 8)}px`;
  }, [text, maxLines]);

  const left = maxLength - text.length;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={ref}
        aria-label={ariaLabel}
        rows={1}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        className={cn(
          "w-full resize-none rounded-md bg-transparent px-0 py-1 text-body leading-6 text-foreground outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:bg-fill-1/60 focus:bg-fill-1 focus:px-2 focus:ring-2 focus:ring-selection [text-wrap:pretty]",
          className,
        )}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => {
          dirty.current = false;
        }}
        onKeyDown={(e) => fieldKeys(e)}
      />
      {left <= 100 && <span className="self-end text-caption text-muted-foreground nums">{left} left</span>}
    </div>
  );
}

function ReportHeader({
  draft,
  playlistName,
  defaultOpponent,
  players,
  clips,
  leftOut,
  onTitle,
  onOpponent,
  focusTitle,
}: Pick<ReportDocumentProps, "draft" | "playlistName" | "defaultOpponent" | "onTitle" | "onOpponent" | "focusTitle"> & { players: number; clips: number; leftOut: number }) {
  const [title, setTitle] = useState(draft.title ?? "");
  const [opponent, setOpponent] = useState(draft.opponent ?? "");
  useEffect(() => setTitle(draft.title ?? ""), [draft.title]);
  useEffect(() => setOpponent(draft.opponent ?? ""), [draft.opponent]);
  const meta = `${players} ${players === 1 ? "player" : "players"} · ${clips} ${clips === 1 ? "clip" : "clips"}${leftOut > 0 ? ` · ${leftOut} not in report` : ""}`;
  const field = "w-full rounded-md bg-transparent outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 hover:bg-fill-1/60 focus:bg-fill-1 focus:ring-2 focus:ring-selection";
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-callout text-muted-foreground">
        <span className="shrink-0">Scouting report ·</span>
        <input
          aria-label="Opponent"
          value={opponent}
          maxLength={80}
          placeholder={defaultOpponent ?? "Opponent (optional)"}
          className={cn(field, "h-6 px-1 text-callout text-muted-foreground focus:text-foreground")}
          onChange={(e) => setOpponent(e.target.value)}
          onBlur={() => onOpponent(opponent)}
          onKeyDown={(e) => fieldKeys(e, { enterBlurs: true })}
        />
        {/* The team the report is on, a step away (docs/navigation.md): beside the name, which is a field to type in. */}
        {draft.team && (
          <TeamLink
            team={{ competitionId: draft.team.competitionId, teamId: draft.team.teamId }}
            name={draft.team.name}
            aria-label={`Go to ${draft.team.name}`}
            title={`Go to ${draft.team.name}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-fill-1 hover:text-foreground hover:no-underline"
          >
            <ArrowRight className="size-3.5" aria-hidden />
          </TeamLink>
        )}
      </div>
      <input
        aria-label="Title"
        autoFocus={focusTitle}
        onFocus={focusTitle ? (e) => e.currentTarget.select() : undefined}
        value={title}
        maxLength={REPORT_TITLE_MAX}
        placeholder={playlistName}
        className={cn(field, "-mx-1 px-1 py-0.5 text-large-title font-semibold text-foreground [text-wrap:balance]")}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => onTitle(title)}
        onKeyDown={(e) => fieldKeys(e, { enterBlurs: true })}
      />
      <p className="text-callout text-muted-foreground nums">{meta}</p>
    </header>
  );
}

/** The player's numbers as the page shows them, with the controls to change which. */
function SectionStats({
  section,
  games,
  leagues,
  loading,
  failed,
  context,
  onStats,
  onRetryStats,
}: {
  section: DraftSection;
  games: StoredMatch[];
  leagues: League[];
  loading: boolean;
  failed: boolean;
  context: SectionStatsContext;
  onStats: (stats: StatsCardSpec) => void;
  onRetryStats: (competitionId?: number) => void;
}) {
  // The season picked while the section has no numbers; the game's own until then.
  const [seasonPick, setSeasonPick] = useState<number | null>(null);
  useEffect(() => setSeasonPick(null), [section.id, section.player.id]);

  if (section.stats) {
    const c = cardContent(section.stats);
    return (
      <div className="flex flex-col gap-1.5">
        {c.cells.length > 0 && (
          <dl className="flex flex-wrap gap-x-6 gap-y-3">
            {c.cells.map((cell) => (
              <div key={cell.label} className="flex flex-col">
                <dd className="order-1 text-title-3 text-foreground nums">{cell.value}</dd>
                <dt className="order-2 text-caption text-muted-foreground">{cell.label}</dt>
              </div>
            ))}
          </dl>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-mx-1.5 flex w-fit max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-footnote text-muted-foreground transition-colors duration-100 hover:bg-fill-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection outline-none data-[state=open]:bg-fill-1"
              aria-label="Which numbers show"
            >
              <span className="truncate">{c.context}</span>
              {loading ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <ChevronDown className="size-3 shrink-0" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[26rem] p-3">
            <StatsCardInspector embedded cardId={section.id} spec={section.stats} games={games} leagues={leagues} onChange={onStats} />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  const shownSeasonId = seasonPick ?? context.gameSeasonId;
  const shownSeason = context.seasons.find((s) => s.competitionId === shownSeasonId) ?? null;
  return (
    <div className="flex flex-col gap-2">
      {context.seasons.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="text-callout text-muted-foreground">Season</span>
          <PopUpButton
            size="sm"
            aria-label="Season"
            value={String(shownSeasonId)}
            onValueChange={(v) => {
              setSeasonPick(Number(v));
              onRetryStats(Number(v));
            }}
            disabled={loading}
            options={context.seasons.map((s) => ({ value: String(s.competitionId), label: s.label }))}
          />
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-footnote text-muted-foreground">
        {loading
          ? "Reading the official stats…"
          : failed
            ? "Couldn't read the official stats. Check the connection and try again."
            : shownSeason
              ? `No official stats for ${firstName(section.player.name)} in ${shownSeason.label}.`
              : "No official stats for this game."}
        {!loading && context.canRead && (
          <Button variant="ghost" size="xs" onClick={() => onRetryStats(seasonPick ?? undefined)}>
            Try again
          </Button>
        )}
      </p>
    </div>
  );
}

/** A tile's still, faded in once it has loaded. */
function Still({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={() => setLoaded(true)}
      className={cn("absolute inset-0 size-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
    />
  );
}

const ClipTileCard = memo(function ClipTileCard({
  clip,
  here,
  targets,
  gameTitle,
  labels,
  selected,
  flashing,
  count,
  playing,
  effects,
  frameOf,
  focusPlayer,
  playRequest,
  onPlay,
  onStop,
  onMove,
  onOpen,
}: {
  clip: ViewClip;
  /** Where the clip sits now. */
  here: Placement;
  /** Every section it can move to, in report order. */
  targets: { id: Placement; label: string }[];
  gameTitle: string | null;
  labels: Pick<Label, "name" | "color">[];
  selected: boolean;
  flashing: boolean;
  /** How many clips the menu acts on: more than 1 when the tile is one of several selected. */
  count: number;
  /** What the tile plays while it is the playing one; null shows the placeholder. */
  playing: ReportClipSource | null;
  effects: ReportClipEffects | null;
  frameOf: (clip: ViewClip) => ReportFrameRequest | null;
  focusPlayer: boolean;
  playRequest: number;
  onPlay: () => void;
  onStop: () => void;
  onMove: (to: Placement) => void;
  onOpen: () => void;
}) {
  const { event, item } = clip;
  const when = `${periodLabel(event.period)} · ${formatGameClock(event.gameClockTime).replace(/^0/, "")}`;
  const note = item.note?.trim();

  // A clip stopped from the keyboard (Esc, the Stop button) leaves focus nowhere: it comes back to the tile.
  const placeholderRef = useRef<HTMLButtonElement | null>(null);
  const isPlaying = playing !== null;
  const wasPlaying = useRef(isPlaying);
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (wasPlaying.current && !isPlaying && lost) placeholderRef.current?.focus({ preventScroll: true });
    wasPlaying.current = isPlaying;
  }, [isPlaying]);

  // The clip's first frame, asked for once the tile comes near the screen.
  const frame = useMemo(() => frameOf(clip), [frameOf, clip]);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = placeholderRef.current;
    if (near || !el) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root: el.closest<HTMLElement>("[data-report-scroll]"),
      rootMargin: "400px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, isPlaying]);
  const still = useReportFrame(frame, near);

  return (
    <figure className="group/tile relative flex flex-col gap-2" data-clip-key={clip.key}>
      {playing ? (
        <ReportClipPlayer
          source={playing}
          effects={effects}
          onClose={onStop}
          autoFocus={focusPlayer}
          playRequest={playRequest}
          className={cn((selected || flashing) && "ring-2 ring-selection")}
        />
      ) : (
        <button
          ref={placeholderRef}
          type="button"
          onClick={onPlay}
          aria-label={`Play ${eventLabel(event)}`}
          className={cn(
            "group/still relative flex aspect-video items-center justify-center overflow-hidden rounded-window bg-fill-2 ring-1 ring-separator outline-none transition-[background-color,box-shadow] duration-300 hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection",
            (selected || flashing) && "ring-2 ring-selection",
            flashing && "bg-fill-3",
          )}
        >
          {still ? (
            <>
              <Still key={still} src={still} />
              <span className="relative flex size-11 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md transition-transform duration-150 group-hover/still:scale-105 group-active/still:scale-95">
                <Play className="size-5 translate-x-px fill-current" aria-hidden />
              </span>
            </>
          ) : (
            <Play className="size-5 fill-current text-muted-foreground" aria-hidden />
          )}
        </button>
      )}
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("rounded-full px-2 py-0.5 text-caption font-medium", eventColors(event).badge)}>{eventLabel(event)}</span>
          <span className="text-callout text-muted-foreground nums">{when}</span>
          {gameTitle && (
            <span className="truncate text-callout text-muted-foreground">
              ·{" "}
              {/* The clip's game, at this play (docs/navigation.md). */}
              <GameLink gameId={clip.item.matchId} title={gameTitle} play={event.eventId}>
                {gameTitle}
              </GameLink>
            </span>
          )}
        </div>
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {labels.map((l) => (
              <LabelChip key={l.name} label={l} />
            ))}
          </div>
        )}
        {note && <p className="whitespace-pre-wrap text-footnote text-foreground [text-wrap:pretty]">{note}</p>}
      </figcaption>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Clip options"
            className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md bg-background/85 text-foreground opacity-0 shadow-xs ring-1 ring-separator backdrop-blur-sm transition-opacity duration-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 data-[state=open]:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-selection"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{count === 1 ? "Move to" : `Move ${count} clips to`}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {targets.map((t) => (
                <DropdownMenuItem key={t.id} disabled={count === 1 && t.id === here} onSelect={() => onMove(t.id)}>
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => onMove(LEFT_OUT)}>{count === 1 ? "Leave out of report" : `Leave ${count} clips out of report`}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpen}>Edit clip</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </figure>
  );
});

/** + Add clips under a section's clips: quiet until hovered, as Add section is. */
function AddClipsRow({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="-ml-2 flex h-8 items-center gap-2 self-start rounded-md px-2 text-callout text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-1 hover:text-foreground active:scale-[0.98] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
    >
      <Plus className="size-4" />
      Add clips
    </button>
  );
}

function ClipGrid({
  clips,
  here,
  targets,
  empty,
  props,
}: {
  clips: ViewClip[];
  here: Placement;
  targets: { id: Placement; label: string }[];
  /** What an empty section says: [with Add clips, without it (the editor's view: drag here)]. */
  empty: readonly [string, string];
  props: ReportDocumentProps;
}) {
  const add = props.onAddClips ? <AddClipsRow onAdd={() => props.onAddClips!(here)} /> : null;
  if (clips.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-callout text-muted-foreground">{add ? empty[0] : empty[1]}</p>
        {add}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
    <div className="grid grid-cols-1 gap-x-4 gap-y-6 min-[36rem]:grid-cols-2">
      {clips.map((clip) => {
        const ids = props.clipAssignments.get(clip.key);
        const labels = ids ? props.labels.filter((l) => ids.has(l.id)).slice(0, 2) : [];
        // A tile that is one of several selected acts for all of them, as in the playlist.
        const many = props.selected.size > 1 && props.selected.has(clip.key);
        return (
          <ClipTileCard
            key={clip.key}
            clip={clip}
            here={here}
            targets={targets}
            gameTitle={props.isMultiMatch ? (props.matchLookup.get(clip.item.matchId)?.title ?? null) : null}
            labels={labels}
            selected={props.selected.has(clip.key)}
            flashing={props.flashKey === clip.key}
            count={many ? props.selected.size : 1}
            playing={props.playingKey === clip.key ? props.playingSource : null}
            effects={props.playingKey === clip.key ? props.playingEffects : null}
            frameOf={props.frameOf}
            focusPlayer={props.focusPlayer}
            playRequest={props.playingKey === clip.key ? props.playRequest : 0}
            onPlay={() => props.onPlayClip(clip.key)}
            onStop={props.onStopClip}
            onMove={(to) => props.onMoveClips(many ? [...props.selected] : [clip.key], to)}
            onOpen={() => props.onOpenClip(clip.key)}
          />
        );
      })}
    </div>
    {add}
    </div>
  );
}

function PlayerSection({ view, targets, props }: { view: ViewSection; targets: { id: Placement; label: string }[]; props: ReportDocumentProps }) {
  const section = view.section!;
  const { player } = section;
  return (
    <section id={sectionDomId(section.id)} data-section-id={section.id} aria-labelledby={`${sectionDomId(section.id)}-h`} className="group/section flex flex-col gap-5 border-t border-separator pt-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerPhoto
            photoKey={props.photos.get(player.id)}
            px={56}
            fallback={
              player.number && (
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full text-callout font-semibold text-foreground ring-1 ring-foreground/30 nums">
                  {player.number}
                </span>
              )
            }
            badge={player.number}
          />
          <div className="min-w-0 flex-1">
            <h2 id={`${sectionDomId(section.id)}-h`} className="truncate text-title-2 text-foreground">
              {player.name}
            </h2>
            {player.teamName && <p className="truncate text-subheadline text-muted-foreground">{player.teamName}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for ${player.name}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color] duration-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100 hover:bg-fill-1 hover:text-foreground data-[state=open]:opacity-100 data-[state=open]:bg-fill-1 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => props.onRemoveSection(section.id)} className="text-destructive focus:text-destructive">
                Remove from report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SectionStats
          section={section}
          games={props.games}
          leagues={props.leagues}
          loading={props.statsLoading.has(section.id)}
          failed={props.statsFailed.has(section.id)}
          context={props.statsContextOf(section)}
          onStats={(stats) => props.onStats(section.id, stats)}
          onRetryStats={(competitionId) => props.onRetryStats(section.id, competitionId)}
        />
        <GrowingText
          value={section.note}
          onChange={(note) => props.onNote(section.id, note)}
          placeholder={`What to know about ${firstName(player.name)}: tendencies, strengths, how to defend`}
          maxLength={REPORT_NOTE_LIMIT}
          maxLines={8}
          ariaLabel={`Note about ${player.name}`}
        />
      </div>
      <ClipGrid
        clips={view.clips}
        here={section.id}
        targets={targets}
        empty={[`No clips of ${firstName(player.name)} yet.`, `No clips of ${firstName(player.name)} yet. Add some in the playlist, or drag clips here in the side panel.`]}
        props={props}
      />
    </section>
  );
}

/** The words that start each kind of section, as placeholders. */
const BLOCK_PLACEHOLDER: Partial<Record<ReportBlockKind, string>> = {
  keys: "A key per line: what every player should remember",
  actions: "What they run: sets, out-of-bounds plays, their press",
  custom: "Write anything players should know",
};

/** What a section with no clips says: with Add clips, and without it (the editor's view). */
const BLOCK_EMPTY_CLIPS: Partial<Record<ReportBlockKind, readonly [string, string]>> = {
  keys: ["Clips that show the keys go here.", "Clips that show the keys go here. Drag one here in the side panel."],
  actions: ["Clips that aren't about one player show here.", "Clips that aren't about one player show here. Drag one here in the side panel."],
  profile: ["Clips that show how they play go here.", "Clips that show how they play go here. Drag one here in the side panel."],
  custom: ["No clips yet.", "Drag clips here in the side panel."],
};
const NO_EMPTY: readonly [string, string] = ["", ""];

/**
 * A section's heading row and its menu, the same for every section: its
 * name (typed in place for a section of the coach's own), "Hidden from
 * players" while it is hidden, and on hover a menu to hide or show it, move
 * it, or take it out. A hidden section stays here as it is, dimmed.
 */
function SectionFrame({
  block,
  index,
  count,
  props,
  heading,
  children,
}: {
  block: ReportBlock;
  index: number;
  count: number;
  props: ReportDocumentProps;
  heading?: ReactNode;
  children?: ReactNode;
}) {
  const name = reportSectionTitle(block.kind === "players" ? "player" : block.kind, block.title);
  const label = block.kind === "players" ? "Players to stop" : name;
  const headingId = `${sectionDomId(block.id)}-h`;
  return (
    <section
      id={sectionDomId(block.id)}
      data-section-id={block.id}
      aria-labelledby={headingId}
      className="group/section flex flex-col gap-4 border-t border-separator pt-8"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {heading ?? (
            <h2 id={headingId} className="truncate text-title-2 text-foreground">
              {label}
            </h2>
          )}
        </div>
        {block.hidden && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-fill-2 px-2 py-0.5 text-caption text-muted-foreground">
            <EyeOff className="size-3" />
            Hidden from players
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${label}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color] duration-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100 hover:bg-fill-1 hover:text-foreground data-[state=open]:opacity-100 data-[state=open]:bg-fill-1 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => props.onBlockHidden(block.id, !block.hidden)}>{block.hidden ? "Show to players" : "Hide from players"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index === 0} onSelect={() => props.onMoveBlock(block.id, -1)}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => props.onMoveBlock(block.id, 1)}>
              Move down
            </DropdownMenuItem>
            {canRemoveBlock(block.kind) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => props.onRemoveBlock(block.id)} className="text-destructive focus:text-destructive">
                  Remove section
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className={cn("flex flex-col gap-4 transition-opacity duration-200", block.hidden && "opacity-55")}>{children}</div>
    </section>
  );
}

/** A custom section's name, typed in place as its heading. */
function TitleField({ block, props }: { block: ReportBlock; props: ReportDocumentProps }) {
  const [title, setTitle] = useState(block.title ?? "");
  useEffect(() => setTitle(block.title ?? ""), [block.title]);
  return (
    <input
      id={`${sectionDomId(block.id)}-h`}
      aria-label="Section name"
      value={title}
      maxLength={REPORT_BLOCK_TITLE_MAX}
      placeholder="Name this section"
      autoFocus={!block.title}
      className="-mx-1 w-full rounded-md bg-transparent px-1 py-0.5 text-title-2 text-foreground outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 hover:bg-fill-1/60 focus:bg-fill-1 focus:ring-2 focus:ring-selection"
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => props.onBlockTitle(block.id, title)}
      onKeyDown={(e) => fieldKeys(e, { enterBlurs: true })}
    />
  );
}

/** How they play, as the shared page will show it. */
function ProfileView({ season }: { season: NonNullable<ReportSeasonSnapshot["profile"]> }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-subheadline text-muted-foreground">{season.context}</p>
      <table className="w-full border-collapse text-sm nums">
        <thead>
          <tr className="text-caption-1 text-muted-foreground">
            <th className="pb-1.5 text-left font-normal">
              <span className="sr-only">Number</span>
            </th>
            <th className="pb-1.5 text-right font-normal">With the ball</th>
            <th className="pb-1.5 text-right font-normal">They allow</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-separator border-t border-separator">
          {season.rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground">
                {r.label}
              </th>
              <td className="py-1.5 text-right">
                {r.own}
                {r.ownPlace && <span className="text-muted-foreground"> · {r.ownPlace}</span>}
              </td>
              <td className="py-1.5 pl-3 text-right">
                {r.allowed}
                {r.allowedPlace && <span className="text-muted-foreground"> · {r.allowedPlace}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {season.lines.map((l) => (
        <p key={l} className="text-subheadline text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

function GamesView({ rows }: { rows: NonNullable<ReportSeasonSnapshot["games"]> }) {
  return (
    <ul className="flex flex-col divide-y divide-separator text-sm nums">
      {rows.map((g, i) => (
        <li key={i} className="flex items-baseline gap-3 py-1.5">
          <span className="w-24 shrink-0 text-muted-foreground">{g.date}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">{g.home ? "vs" : "at"}</span> {g.opponent}
          </span>
          <span className={cn("shrink-0", !g.result && "text-muted-foreground")}>{g.result ?? "To play"}</span>
        </li>
      ))}
    </ul>
  );
}

/** A section that isn't a player's: Keys, Their actions, How they play, Their games, or one the coach named. */
function BlockSection({
  view,
  index,
  count,
  targets,
  props,
}: {
  view: ViewSection;
  index: number;
  count: number;
  targets: { id: Placement; label: string }[];
  props: ReportDocumentProps;
}) {
  const block = view.block!;
  const seasonLine = props.hasTeam ? "Reading the team's season…" : "Shows the team's season in a report started from a team.";
  return (
    <SectionFrame block={block} index={index} count={count} props={props} heading={block.kind === "custom" ? <TitleField block={block} props={props} /> : undefined}>
      {holdsText(block.kind) && (
        <GrowingText
          value={block.text ?? ""}
          onChange={(t) => props.onBlockText(block.id, t)}
          placeholder={BLOCK_PLACEHOLDER[block.kind] ?? ""}
          maxLength={REPORT_BLOCK_TEXT_LIMIT}
          maxLines={12}
          ariaLabel={`${reportSectionTitle(block.kind as Exclude<ReportBlockKind, "players">, block.title)} text`}
          className={block.kind === "keys" ? "text-title-3 leading-8" : undefined}
        />
      )}
      {block.kind === "profile" &&
        (props.season?.profile ? <ProfileView season={props.season.profile} /> : <p className="text-callout text-muted-foreground">{seasonLine}</p>)}
      {block.kind === "games" && (props.season?.games ? <GamesView rows={props.season.games} /> : <p className="text-callout text-muted-foreground">{seasonLine}</p>)}
      {holdsClips(block.kind) && <ClipGrid clips={view.clips} here={block.id} targets={targets} empty={BLOCK_EMPTY_CLIPS[block.kind] ?? NO_EMPTY} props={props} />}
    </SectionFrame>
  );
}

/** The quiet row at the end: the sections the report doesn't have, and one of the coach's own. */
function AddSectionRow({ props }: { props: ReportDocumentProps }) {
  const { missing, canAddOwn } = addableSections(props.draft);
  if (missing.length === 0 && !canAddOwn) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 self-start rounded-md px-2 text-callout text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 hover:text-foreground data-[state=open]:bg-fill-1 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <Plus className="size-4" />
          Add section
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <AddSectionItems draft={props.draft} onAddBlock={props.onAddBlock} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The report as the coach writes it: the same document the page will show,
 * with the title, opponent, intro and notes typed in place, and each clip's
 * menu to move it under another player or out of the report (the side panel
 * arranges them by dragging). A clip tile shows the play and its time and
 * plays the clip in place when clicked, one tile at a time (the others keep
 * no video); "Edit clip" in its menu goes to the clip in the Clips view.
 */
export function ReportDocument(props: ReportDocumentProps) {
  const { draft, sections } = props;
  const players = draft.sections.length;
  const clips = sections.reduce((n, s) => n + s.clips.length, 0);
  // Every report has its sections and their controls; one from before sections reads as Their actions, then the
  // players (blocksOf), its intro as the summary, and takes on sections with the first change to them.
  const blocks = blocksOf(draft);
  const targets: { id: Placement; label: string }[] = blocks.flatMap((b) =>
        b.kind === "players"
          ? draft.sections.map((s) => ({ id: s.id, label: sectionLabel(s.player) }))
          : holdsClips(b.kind)
            ? [{ id: b.id, label: reportSectionTitle(b.kind as Exclude<ReportBlockKind, "players">, b.title) }]
            : [],
      );
  const byId = new Map(sections.map((s) => [s.id, s]));
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-8 px-8 py-10">
      <ReportHeader
        draft={draft}
        playlistName={props.playlistName}
        defaultOpponent={props.defaultOpponent}
        players={players}
        clips={clips}
        leftOut={props.leftOutCount}
        onTitle={props.onTitle}
        onOpponent={props.onOpponent}
        focusTitle={props.focusTitle}
      />
      <>
          <GrowingText
            value={draft.intro}
            onChange={props.onIntro}
            placeholder="A summary: what players should know before anything else"
            maxLength={REPORT_INTRO_LIMIT}
            maxLines={8}
            ariaLabel="Summary"
            className="-mt-4"
          />
          {blocks.map((b, i) => {
            if (b.kind === "players") {
              const own = draft.sections.map((s) => byId.get(s.id)).filter((v): v is ViewSection => !!v);
              return (
                <SectionFrame key={b.id} block={b} index={i} count={blocks.length} props={props}>
                  {own.length === 0 && <p className="text-callout text-muted-foreground">No players yet. Add players to start.</p>}
                  {own.map((v) => (
                    <PlayerSection key={v.id} view={v} targets={targets} props={props} />
                  ))}
                </SectionFrame>
              );
            }
            const view = byId.get(b.id);
            return view ? <BlockSection key={b.id} view={view} index={i} count={blocks.length} targets={targets} props={props} /> : null;
          })}
          <AddSectionRow props={props} />
      </>
    </div>
  );
}
