/**
 * The scouting report, as the page draws it. A server component: the markup
 * is the report, and the few interactive parts (playing a clip, the jump bar,
 * Save as PDF, the printed QR, the footer link) are the client components next
 * to it.
 *
 * One scrolling page: the summary, then the coach's sections in their order
 * (lib/scouting-report.ts built them from the draft): Keys, the players to
 * stop, Their actions, How they play, Their games and sections the coach
 * named; a report from before sections has its Team section and players.
 * A chip for each in the jump bar. It follows the
 * viewer's system theme on screen and prints light. Every report ends with the
 * "Made with Scoutable" mark, on screen and in the saved PDF.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { playerPhotoSources } from "@scoutable/shared/lib/player-photos";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import {
  JUMP_BAR_MIN_SECTIONS,
  reportJumpItems,
  reportSectionTitle,
  type ReportBlock,
  type ReportClip,
  type ReportGamesBlock,
  type ReportProfileBlock,
  type ReportSection,
  type ReportStats,
  type ScoutingReport,
} from "@scoutable/shared/lib/scouting-report";
import { ClipTile } from "./clip-tile";
import { FooterMark, JumpBar, PrintQr, SaveAsPdf, type JumpItem } from "./report-chrome";

/** What a stat's short label means, for screen readers and hover. */
const STAT_NAMES: Record<string, string> = {
  PTS: "Points",
  REB: "Rebounds",
  OREB: "Offensive rebounds",
  DREB: "Defensive rebounds",
  AST: "Assists",
  STL: "Steals",
  BLK: "Blocks",
  FG: "Field goals",
  FGM: "Field goals made",
  "FG%": "Field goal percentage",
  "3P": "Three-pointers",
  "3PM": "Three-pointers made",
  "3P%": "Three-point percentage",
  FT: "Free throws",
  FTM: "Free throws made",
  "FT%": "Free throw percentage",
  MIN: "Minutes",
  "+/−": "Plus/minus",
  EFF: "Efficiency",
  TO: "Turnovers",
  PF: "Personal fouls",
  GP: "Games played",
};

function mediaUrl(base: string | null, key: string | null): string | null {
  if (!base || !key) return null;
  return `${base.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function StatsRow({ stats }: { stats: ReportStats }) {
  if (stats.cells.length === 0 && !stats.context) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {stats.cells.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-3">
          {stats.cells.map((c) => (
            <div key={c.label} className="report-stat flex flex-col">
              <dd className="order-1 text-title-3 text-foreground">{c.value}</dd>
              <dt className="order-2 text-caption text-muted-foreground">
                <abbr title={STAT_NAMES[c.label] ?? c.label} className="no-underline">
                  {c.label}
                </abbr>
              </dt>
            </div>
          ))}
        </dl>
      )}
      {stats.context && <p className="text-footnote text-muted-foreground">{stats.context}</p>}
    </div>
  );
}

/** The coach's keys: few, numbered, large enough to read on a phone at the gym. */
function KeysList({ items }: { items: string[] }) {
  return (
    <ol className="report-keys flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-baseline gap-3">
          <span aria-hidden className="w-5 shrink-0 text-right text-title-3 font-semibold text-muted-foreground nums">
            {i + 1}
          </span>
          <span className="text-title-3 text-foreground [text-wrap:pretty]">{item}</span>
        </li>
      ))}
    </ol>
  );
}

const place = (p: string | null) => (p ? <span className="text-footnote text-muted-foreground"> · {p}</span> : null);

/** How they play: their numbers with the ball and what they allow, a row per number. */
function ProfileTable({ block }: { block: ReportProfileBlock }) {
  return (
    <div className="flex flex-col gap-2">
      {block.context && <p className="text-footnote text-muted-foreground">{block.context}</p>}
      <table className="w-full border-collapse text-callout nums">
        <thead>
          <tr className="text-left text-footnote text-muted-foreground">
            <th scope="col" className="pb-1.5 font-normal">
              <span className="sr-only">Number</span>
            </th>
            <th scope="col" className="pb-1.5 text-right font-normal">
              With the ball
            </th>
            <th scope="col" className="pb-1.5 text-right font-normal">
              They allow
            </th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r) => (
            <tr key={r.label} className="border-t border-separator">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">
                {r.label}
              </th>
              <td className="py-2 text-right text-foreground">
                {r.own}
                {place(r.ownPlace)}
              </td>
              <td className="py-2 pl-3 text-right text-foreground">
                {r.allowed}
                {place(r.allowedPlace)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {block.lines.map((l) => (
        <p key={l} className="text-footnote text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  );
}

/** Their games: a row each, the result or "to play". */
function GamesList({ block }: { block: ReportGamesBlock }) {
  return (
    <ul className="flex flex-col">
      {block.rows.map((g, i) => (
        <li key={i} className="flex items-baseline gap-3 border-t border-separator py-2 text-callout first:border-t-0 nums">
          <span className="w-24 shrink-0 text-muted-foreground">{g.date}</span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {g.home ? "vs" : "at"} {g.opponent}
          </span>
          <span className={cn("shrink-0", g.result ? "text-foreground" : "text-muted-foreground")}>{g.result ?? "To play"}</span>
        </li>
      ))}
    </ul>
  );
}

function Blocks({ blocks, mediaBase }: { blocks: ReportBlock[]; mediaBase: string | null }) {
  // Consecutive clips sit in one grid; a paragraph or a stats row breaks the run.
  const out: ReactNode[] = [];
  let run: ReportClip[] = [];
  let firstClip = true;
  const flush = () => {
    if (run.length === 0) return;
    const clips = run;
    run = [];
    out.push(
      <div key={`run-${out.length}`} className="grid grid-cols-1 gap-x-4 gap-y-6 min-[40rem]:grid-cols-2 print:grid-cols-2">
        {clips.map((c, i) => (
          <ClipTile key={c.id} clip={c} src={mediaUrl(mediaBase, c.clipKey)} poster={mediaUrl(mediaBase, c.posterKey)} first={firstClip && i === 0} />
        ))}
      </div>,
    );
    firstClip = false;
  };
  blocks.forEach((b, i) => {
    if (b.kind === "clip") {
      run.push(b);
      return;
    }
    flush();
    if (b.kind === "text") {
      out.push(
        <p key={`t-${i}`} className="report-note text-body text-foreground">
          {b.text}
        </p>,
      );
    } else if (b.kind === "keys") {
      out.push(<KeysList key={`k-${i}`} items={b.items} />);
    } else if (b.kind === "profile") {
      out.push(<ProfileTable key={`p-${i}`} block={b} />);
    } else if (b.kind === "games") {
      out.push(<GamesList key={`g-${i}`} block={b} />);
    } else {
      out.push(
        <div key={`s-${i}`} className="flex flex-col gap-1.5">
          <h3 className="text-headline text-foreground">{b.heading}</h3>
          <StatsRow stats={b.stats} />
        </div>,
      );
    }
  });
  flush();
  return <>{out}</>;
}

/** The player's photo in the section header, in CSS pixels. */
const PHOTO_PX = 56;

function Section({ section, report, mediaBase, bare }: { section: ReportSection; report: ScoutingReport; mediaBase: string | null; bare?: boolean }) {
  const { header } = report;
  const p = section.player;
  const label = [header.title, header.opponent, formatCardDate(header.preparedAt)].filter(Boolean).join(" · ");
  const photo = p ? playerPhotoSources(mediaBase, p.photoKey, PHOTO_PX) : null;
  return (
    <section id={section.id} aria-labelledby={`${section.id}-h`} className={cn("report-section flex flex-col gap-5 print:border-t-0 print:pt-0", bare ? "pt-0" : "border-t border-separator pt-8")}>
      <p className="report-print-only text-footnote text-muted-foreground">{label}</p>
      <div className="report-intro flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {photo ? (
            <span aria-hidden className="relative shrink-0" style={{ width: PHOTO_PX, height: PHOTO_PX }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size photo from our media host */}
              <img
                src={photo.src}
                srcSet={photo.srcSet}
                alt=""
                width={PHOTO_PX}
                height={PHOTO_PX}
                loading="lazy"
                decoding="async"
                className="size-full rounded-full bg-fill-1 object-cover object-top ring-1 ring-foreground/10"
              />
              {p?.number && (
                <span className="absolute -bottom-0.5 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-background px-1 text-caption font-semibold text-foreground ring-1 ring-foreground/30 nums">
                  {p.number}
                </span>
              )}
            </span>
          ) : (
            p?.number && (
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full text-callout font-semibold text-foreground ring-1 ring-foreground/30 nums">
                {p.number}
              </span>
            )
          )}
          <div className="min-w-0">
            <h2 id={`${section.id}-h`} aria-label={p?.number ? `${p.name}, number ${p.number}` : undefined} className="text-title-2 text-foreground">
              {p ? p.name : reportSectionTitle(section.kind, section.title)}
            </h2>
            {p?.teamName && <p className="text-subheadline text-muted-foreground">{p.teamName}</p>}
          </div>
          {/* Print only: a QR that opens this player's clips. */}
          {p && <PrintQr anchor={section.id} />}
        </div>
        {section.stats && <StatsRow stats={section.stats} />}
        {section.note && <p className="report-note text-body text-foreground">{section.note}</p>}
      </div>
      <Blocks blocks={section.blocks} mediaBase={mediaBase} />
    </section>
  );
}

export function ReportDocument({ report, mediaBase }: { report: ScoutingReport; mediaBase: string | null }) {
  const { header, sections } = report;
  // A chip per section, the Team section's first, once the page is long enough to need them.
  const jump: JumpItem[] = reportJumpItems(sections);
  const showJump = jump.length >= JUMP_BAR_MIN_SECTIONS;
  const meta = [
    `Prepared ${formatCardDate(header.preparedAt)}`,
    `${header.players} ${header.players === 1 ? "player" : "players"}`,
    `${header.clips} ${header.clips === 1 ? "clip" : "clips"}`,
  ].join(" · ");

  return (
    <main className="report mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 bg-background px-5 pt-[calc(2rem+var(--safe-top))] pb-[calc(2rem+var(--safe-bottom))] text-foreground">
      <header className="report-header flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <p className="text-callout text-muted-foreground">
            Scouting report{header.opponent ? ` · ${header.opponent}` : ""}
          </p>
          <SaveAsPdf />
        </div>
        <h1 className="text-large-title font-semibold text-foreground [text-wrap:balance]">{header.title}</h1>
        <p className="text-callout text-muted-foreground nums">{meta}</p>
        {header.intro && <p className="report-note mt-2 text-body text-foreground">{header.intro}</p>}
      </header>

      {showJump && <JumpBar items={jump} />}

      {sections.length === 0 && <p className="text-body text-muted-foreground">This report is empty so far.</p>}
      {sections.map((s, i) => (
        // With the jump bar, its own rule already separates the header from the first section.
        <Section key={s.id} section={s} report={report} mediaBase={mediaBase} bare={i === 0 && showJump} />
      ))}

      <FooterMark />
    </main>
  );
}
