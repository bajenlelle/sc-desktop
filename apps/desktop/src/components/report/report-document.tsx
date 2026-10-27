import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Loader2, MoreHorizontal, Play } from "lucide-react";
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
import { StatsCardInspector } from "@/components/editor/stats-card-inspector";
import { LabelChip } from "@/components/labels/LabelChip";
import { cn } from "@/lib/utils";
import { eventColors, eventLabel, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { LEFT_OUT, REPORT_INTRO_LIMIT, REPORT_NOTE_LIMIT, REPORT_TITLE_MAX, TEAM_SECTION, sectionLabel, type DraftSection, type Placement, type ReportDraft } from "@scoutable/shared/lib/report-draft";
import { cardContent, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import type { Label } from "@scoutable/shared/types/labels";
import type { League } from "@scoutable/shared/types/league";
import type { PlayByPlayEvent, PlaylistClipItem, StoredMatch } from "@/types/match";

/** One clip as the document shows it: the item, and the play it is. */
export interface ViewClip {
  key: string;
  item: PlaylistClipItem;
  event: PlayByPlayEvent;
}

/** A section of the document: the team (section null) or a player's. */
export interface ViewSection {
  id: Placement;
  section: DraftSection | null;
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
  /** Clips the coach left out of the report (the side panel lists them). */
  leftOutCount: number;
  /** The side panel's selected clips: a tile's menu acts on all of them. */
  selected: ReadonlySet<string>;
  /** The clip the side panel just showed, lit up for a moment. */
  flashKey: string | null;
  onTitle: (title: string) => void;
  onOpponent: (opponent: string) => void;
  onIntro: (intro: string) => void;
  onNote: (id: string, note: string) => void;
  onStats: (id: string, stats: StatsCardSpec) => void;
  onRetryStats: (id: string, competitionId?: number) => void;
  /** To a section's end, or out of the report (LEFT_OUT). */
  onMoveClips: (keys: string[], to: Placement) => void;
  onOpenClip: (key: string) => void;
  onRemoveSection: (id: string) => void;
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
}: Pick<ReportDocumentProps, "draft" | "playlistName" | "defaultOpponent" | "onTitle" | "onOpponent"> & { players: number; clips: number; leftOut: number }) {
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
      </div>
      <input
        aria-label="Title"
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

const ClipTileCard = memo(function ClipTileCard({
  clip,
  here,
  targets,
  gameTitle,
  labels,
  selected,
  flashing,
  count,
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
  onMove: (to: Placement) => void;
  onOpen: () => void;
}) {
  const { event, item } = clip;
  const when = `${periodLabel(event.period)} · ${formatGameClock(event.gameClockTime).replace(/^0/, "")}`;
  const note = item.note?.trim();
  return (
    <figure className="group/tile relative flex flex-col gap-2" data-clip-key={clip.key}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${eventLabel(event)} in the playlist`}
        className={cn(
          "flex aspect-video items-center justify-center rounded-window bg-fill-2 ring-1 ring-separator outline-none transition-[background-color,box-shadow] duration-300 hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection",
          (selected || flashing) && "ring-2 ring-selection",
          flashing && "bg-fill-3",
        )}
      >
        <Play className="size-5 fill-current text-muted-foreground" aria-hidden />
      </button>
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("rounded-full px-2 py-0.5 text-caption font-medium", eventColors(event).badge)}>{eventLabel(event)}</span>
          <span className="text-callout text-muted-foreground nums">{when}</span>
          {gameTitle && <span className="truncate text-callout text-muted-foreground">· {gameTitle}</span>}
        </div>
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {labels.map((l) => (
              <LabelChip key={l.name} label={l} />
            ))}
          </div>
        )}
        {note && <p className="text-footnote text-foreground [text-wrap:pretty]">{note}</p>}
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
          <DropdownMenuItem onSelect={onOpen}>Open in playlist</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </figure>
  );
});

function ClipGrid({ clips, here, targets, empty, props }: { clips: ViewClip[]; here: Placement; targets: { id: Placement; label: string }[]; empty: string; props: ReportDocumentProps }) {
  if (clips.length === 0) return <p className="text-callout text-muted-foreground">{empty}</p>;
  return (
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
            onMove={(to) => props.onMoveClips(many ? [...props.selected] : [clip.key], to)}
            onOpen={() => props.onOpenClip(clip.key)}
          />
        );
      })}
    </div>
  );
}

function TeamSection({ view, targets, props }: { view: ViewSection; targets: { id: Placement; label: string }[]; props: ReportDocumentProps }) {
  return (
    <section id={sectionDomId(TEAM_SECTION)} data-section-id={TEAM_SECTION} aria-labelledby="report-team-h" className="flex flex-col gap-4 border-t border-separator pt-8">
      <h2 id="report-team-h" className="text-title-2 text-foreground">
        Team
      </h2>
      <GrowingText
        value={props.draft.intro}
        onChange={props.onIntro}
        placeholder="How they play: pace, sets, what to take away"
        maxLength={REPORT_INTRO_LIMIT}
        maxLines={12}
        ariaLabel="Team intro"
      />
      <ClipGrid clips={view.clips} here={TEAM_SECTION} targets={targets} empty="Clips that aren't about one player show here. Drag one here in the side panel." props={props} />
    </section>
  );
}

function PlayerSection({ view, targets, props }: { view: ViewSection; targets: { id: Placement; label: string }[]; props: ReportDocumentProps }) {
  const section = view.section!;
  const { player } = section;
  return (
    <section id={sectionDomId(section.id)} data-section-id={section.id} aria-labelledby={`${sectionDomId(section.id)}-h`} className="group/section flex flex-col gap-5 border-t border-separator pt-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {player.number && (
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full text-callout font-semibold text-foreground ring-1 ring-foreground/30 nums">
              {player.number}
            </span>
          )}
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
        empty={`No clips of ${firstName(player.name)} yet. Add some in the playlist, or drag clips here in the side panel.`}
        props={props}
      />
    </section>
  );
}

/**
 * The report as the coach writes it: the same document the page will show,
 * with the title, opponent, intro and notes typed in place, and each clip's
 * menu to move it under another player or out of the report (the side panel
 * arranges them by dragging). Clip tiles show the play and its time, no
 * footage; "Open in playlist" goes to the video.
 */
export function ReportDocument(props: ReportDocumentProps) {
  const { draft, sections } = props;
  const players = draft.sections.length;
  const clips = sections.reduce((n, s) => n + s.clips.length, 0);
  const targets: { id: Placement; label: string }[] = [
    { id: TEAM_SECTION, label: "Team" },
    ...draft.sections.map((s) => ({ id: s.id, label: sectionLabel(s.player) })),
  ];
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
      />
      {sections.map((s) => (s.section ? <PlayerSection key={s.id} view={s} targets={targets} props={props} /> : <TeamSection key={s.id} view={s} targets={targets} props={props} />))}
    </div>
  );
}
