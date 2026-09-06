import { ChevronRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  initials,
  relativeTimeShort as relativeTime,
  type FeedPlaylist,
} from "@scoutable/shared/lib/playlist-feed";

/** The card's view-model — the shared feed type under its established local name. */
export type PlaylistCardData = FeedPlaylist;

export function PlaylistCard({
  playlist,
  onOpen,
  onResume,
}: {
  playlist: PlaylistCardData;
  onOpen: () => void;
  /** Only passed for partially-watched playlists — jumps to the first unwatched clip. */
  onResume?: () => void;
}) {
  const { name, clipCount, watchedCount, sharedAt, sharerName, sharerAvatarUrl, teamNames } = playlist;
  const isNew = watchedCount === 0;
  const isComplete = clipCount > 0 && watchedCount >= clipCount;
  const pct = clipCount > 0 ? Math.round((watchedCount / clipCount) * 100) : 0;
  const when = relativeTime(sharedAt);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40",
        isNew && "border-primary/40",
      )}
    >
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left">
        {isNew && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            New
          </span>
        )}
        <h3 className="text-base font-semibold text-foreground line-clamp-2">
          {name}
          {teamNames && teamNames.length > 0 && (
            // Which team this came through — muted so the title stays the headline.
            <span className="text-xs font-normal text-muted-foreground"> · {teamNames.join(", ")}</span>
          )}
        </h3>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {/* Desktop has no Avatar primitive — same initials treatment the
              profile and share dialogs already use. */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
            {sharerAvatarUrl
              ? <img src={sharerAvatarUrl} alt="" className="h-full w-full object-cover" />
              : initials(sharerName)}
          </span>
          <span className="truncate">
            {sharerName ?? "A coach"}
            {when && ` · ${when}`}
          </span>
        </div>
      </button>

      {/* Progress only earns its space once there's progress to show. */}
      {!isNew && !isComplete && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {watchedCount} of {clipCount} watched
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {isComplete ? `${clipCount} clips · watched` : `${clipCount} clip${clipCount === 1 ? "" : "s"}`}
        </span>
        {onResume && !isNew && !isComplete ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {isNew ? "Watch" : "Open"}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
