"use client";

/**
 * One clip on the report page: the poster, and on a tap the clip plays in the
 * browser's own controls (they bring AirPlay, picture in picture and saving).
 * Nothing autoplays and one clip plays at a time. The video is `preload="none"`
 * when there is a poster, so a long report doesn't download every clip up
 * front. In print the poster stands in for the video (a video doesn't print).
 */
import { useState } from "react";
import { eventColors } from "@scoutable/shared/lib/events";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import type { ReportClip } from "@scoutable/shared/lib/scouting-report";
import { cn } from "@/lib/utils";

export function ClipTile({ clip, src, poster, first }: { clip: ReportClip; src: string | null; poster: string | null; first?: boolean }) {
  const [failed, setFailed] = useState(false);
  // The badge colours are the apps': the play's type and result decide them.
  const badge = eventColors({ type: clip.type, subType: clip.subType, isSuccessful: clip.made ? 1 : 0 } as PlayByPlayEvent).badge;
  const when = [clip.period, clip.clock.replace(/^0/, "")].filter(Boolean).join(" · ");

  return (
    <figure id={clip.id} className={cn("report-clip flex flex-col gap-2", first && "report-clip-first")}>
      <div className="relative aspect-video overflow-hidden rounded-window bg-fill-2 ring-1 ring-separator">
        {src && !failed ? (
          <video
            data-report-clip
            src={src}
            poster={poster ?? undefined}
            controls
            playsInline
            preload={poster ? "none" : "metadata"}
            aria-label={`Play ${clip.label}${when ? `, ${when}` : ""}`}
            className="report-screen-only size-full bg-black object-cover"
            onPlay={(e) => {
              // One clip at a time.
              document.querySelectorAll<HTMLVideoElement>("video[data-report-clip]").forEach((v) => {
                if (v !== e.currentTarget) v.pause();
              });
            }}
            onError={() => setFailed(true)}
          />
        ) : (
          <p className="report-screen-only flex size-full items-center justify-center px-4 text-center text-callout text-muted-foreground">
            {failed ? "This clip can’t be played right now. Try again later." : "Clip unavailable"}
          </p>
        )}
        {/* Print: a video doesn't print, its poster does. */}
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" loading="lazy" className="report-print-only size-full object-cover" />
        ) : (
          <div className="report-print-only size-full bg-fill-2" />
        )}
      </div>
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("report-badge rounded-full px-2 py-0.5 text-caption", badge)}>{clip.label}</span>
          {when && <span className="text-callout text-muted-foreground nums">{when}</span>}
          {clip.game && <span className="text-callout text-muted-foreground">· {clip.game}</span>}
        </div>
        {clip.labels.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {clip.labels.map((l) => (
              <li key={l} className="rounded-full bg-fill-2 px-2 py-0.5 text-caption text-foreground">
                {l}
              </li>
            ))}
          </ul>
        )}
        {clip.note && <p className="report-note text-body text-foreground">{clip.note}</p>}
      </figcaption>
    </figure>
  );
}
