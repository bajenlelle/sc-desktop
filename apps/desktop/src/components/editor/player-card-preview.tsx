import { Play } from "lucide-react";
import type { PlayerCardSpec } from "@scoutable/shared/lib/player-card";
import { cardContent } from "@scoutable/shared/lib/stats-card";
import { cn } from "@/lib/utils";

/** One clip of the section, as the page will show it. */
export interface PreviewClip {
  key: string;
  label: string;
  /** "Q2 · 4:31" */
  when: string;
  note?: string;
  badge: string;
}

/**
 * The stage while a player card is selected: this player's section of the
 * report as it will read, in a phone-width column. It updates with every
 * keystroke and doesn't animate: the coach is writing, not watching. Clip
 * tiles show the play and its time, no footage; the page has the real thing.
 */
export function PlayerCardPreview({ spec, clips }: { spec: PlayerCardSpec; clips: PreviewClip[] }) {
  const { player } = spec;
  const stats = spec.stats ? cardContent(spec.stats) : null;
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-5 py-6" aria-label="Report preview">
        <div className="flex items-center gap-3">
          {player.number && (
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full text-callout font-semibold ring-1 ring-foreground/30 nums">
              {player.number}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-title-2 text-foreground">{player.name}</p>
            {player.teamName && <p className="truncate text-subheadline text-muted-foreground">{player.teamName}</p>}
          </div>
        </div>
        {stats && stats.cells.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <dl className="flex flex-wrap gap-x-5 gap-y-2">
              {stats.cells.map((c) => (
                <div key={c.label} className="flex flex-col">
                  <dd className="order-1 text-title-3 text-foreground nums">{c.value}</dd>
                  <dt className="order-2 text-caption text-muted-foreground">{c.label}</dt>
                </div>
              ))}
            </dl>
            <p className="text-footnote text-muted-foreground">{stats.context}</p>
          </div>
        )}
        {spec.note ? (
          <p className="whitespace-pre-wrap text-body text-foreground [text-wrap:pretty]">{spec.note}</p>
        ) : (
          <p className="text-body text-muted-foreground">Your note shows here.</p>
        )}
        {clips.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {clips.map((c) => (
              <div key={c.key} className="flex flex-col gap-1">
                <div className="flex aspect-video items-center justify-center rounded-md bg-fill-2 ring-1 ring-separator">
                  <Play className="size-5 fill-current text-muted-foreground" aria-hidden />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-px text-[11px] font-medium", c.badge)}>{c.label}</span>
                  <span className="text-footnote text-muted-foreground nums">{c.when}</span>
                </div>
                {c.note && <p className="text-footnote text-foreground">{c.note}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-callout text-muted-foreground">Clips you put below this card show here.</p>
        )}
      </div>
    </div>
  );
}
