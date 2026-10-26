/**
 * The scouting report, as the page draws it. A server component: the markup
 * is the report, and the few interactive parts (playing a clip, the jump bar,
 * Save as PDF, the printed QR) are the client components next to it.
 *
 * One scrolling page: the Team section when there is one, then a section per
 * player in the report's order (lib/scouting-report.ts built them from the
 * coach's draft), with a chip for each in the jump bar. It follows the
 * viewer's system theme on screen and prints light.
 */
import type { ReactNode } from "react";
import { Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import { JUMP_BAR_MIN_SECTIONS, reportJumpItems, type ReportBlock, type ReportClip, type ReportSection, type ReportStats, type ScoutingReport } from "@scoutable/shared/lib/scouting-report";
import { ClipTile } from "./clip-tile";
import { JumpBar, PrintQr, SaveAsPdf, type JumpItem } from "./report-chrome";

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

function Section({ section, report, mediaBase, bare }: { section: ReportSection; report: ScoutingReport; mediaBase: string | null; bare?: boolean }) {
  const { header } = report;
  const p = section.player;
  const label = [header.title, header.opponent, formatCardDate(header.preparedAt)].filter(Boolean).join(" · ");
  return (
    <section id={section.id} aria-labelledby={`${section.id}-h`} className={cn("report-section flex flex-col gap-5 print:border-t-0 print:pt-0", bare ? "pt-0" : "border-t border-separator pt-8")}>
      <p className="report-print-only text-footnote text-muted-foreground">{label}</p>
      <div className="report-intro flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {p?.number && (
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full text-callout font-semibold text-foreground ring-1 ring-foreground/30 nums">
              {p.number}
            </span>
          )}
          <div className="min-w-0">
            <h2 id={`${section.id}-h`} aria-label={p?.number ? `${p.name}, number ${p.number}` : undefined} className="text-title-2 text-foreground">
              {p ? p.name : "Team"}
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
      </header>

      {showJump && <JumpBar items={jump} />}

      {sections.length === 0 && <p className="text-body text-muted-foreground">This report has no players or clips yet.</p>}
      {sections.map((s, i) => (
        // With the jump bar, its own rule already separates the header from the first section.
        <Section key={s.id} section={s} report={report} mediaBase={mediaBase} bare={i === 0 && showJump} />
      ))}

      {header.attribution && (
        <footer className="report-screen-only mt-auto flex items-center justify-center gap-2 pt-6 text-callout text-muted-foreground">
          <span>Made with</span>
          <a href="https://scoutable.se" target="_blank" rel="noreferrer noopener" aria-label="scoutable.">
            <Wordmark className="h-4 w-auto" />
          </a>
        </footer>
      )}
    </main>
  );
}
