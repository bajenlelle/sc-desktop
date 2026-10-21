"use client";

import { Loader2 } from "lucide-react";
import { libraryRowState, type LibraryRowState } from "@scoutable/shared/lib/game-library";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupRow } from "@/components/ui/group";
import { formatGameDate, formatGameLength } from "@/lib/format-game";
import { useGameUploadJob } from "@/lib/game-upload";

/** What the row says about the game's video, by state. */
function RowState({ state, match, canUpload }: { state: LibraryRowState; match: StoredMatch; canUpload: boolean }) {
  const length = formatGameLength(state.durationSeconds);
  switch (state.kind) {
    case "ready":
      return (
        <span className="flex items-center gap-1.5 text-callout text-muted-foreground nums">
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          {state.label}
          {length && <span className="hidden sm:inline">&nbsp;· {length}</span>}
        </span>
      );
    case "check-sync":
    case "needs-sync":
      return (
        <>
          {length && <span className="hidden text-callout text-muted-foreground nums md:inline">{length}</span>}
          <Badge variant="warning">{state.label}</Badge>
        </>
      );
    case "converting":
    case "uploading":
      return (
        <span className="flex items-center gap-1.5 text-callout text-muted-foreground nums">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          {state.kind === "uploading" && state.progress !== null && state.progress > 0
            ? `${state.label} · ${Math.round(state.progress * 100)}%`
            : state.label}
        </span>
      );
    case "interrupted":
      return <Badge variant="warning">{state.label}</Badge>;
    case "failed":
      return <Badge variant="destructive">{state.label}</Badge>;
    case "none":
      // The sample game has no video to upload on the web.
      if (!canUpload || match.isDemo) return <span className="text-callout text-muted-foreground">{state.label}</span>;
      return (
        // The button's own navigation, not the row's: the click stops here.
        // No prefetch: one per row (every game without a video) all render
        // the same import page on the server.
        <span onClick={(e) => e.stopPropagation()}>
          <Button asChild size="xs" variant="outline">
            <ImportEntryLink placement="library_row" matchId={match.id} prefetch={false}>
              Upload the video
            </ImportEntryLink>
          </Button>
        </span>
      );
  }
}

/**
 * One game in the Library (and in Home's recent imports): the title with
 * a "Sample game" badge for the seeded one, the date and the teams, the
 * team colours as a thin bar, and where its video stands on the right. The
 * state comes from the shared libraryRowState over the match, its cloud
 * video row and any upload running on this device.
 */
export function LibraryRow({
  match,
  video,
  canUpload,
  onOpen,
}: {
  match: StoredMatch;
  video: GameVideo | null;
  /** Whether "Upload the video" is offered for a game without one (canImportGames). */
  canUpload: boolean;
  onOpen: () => void;
}) {
  const job = useGameUploadJob(match.id);
  const state = libraryRowState(match, video, job);
  const date = formatGameDate(match.date);
  return (
    <GroupRow
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{match.title}</span>
          {match.isDemo && (
            <Badge variant="secondary" className="shrink-0 bg-primary/10 text-primary">
              Sample game
            </Badge>
          )}
        </span>
      }
      description={[date, `${match.homeTeam.name} – ${match.awayTeam.name}`].filter(Boolean).join(" · ")}
      leading={
        <span className="flex h-7 w-[3px] shrink-0 flex-col gap-px overflow-hidden rounded-full" aria-hidden>
          <span className="flex-1" style={{ backgroundColor: match.homeTeam.color }} />
          <span className="flex-1" style={{ backgroundColor: match.awayTeam.color }} />
        </span>
      }
      trailing={<RowState state={state} match={match} canUpload={canUpload} />}
      chevron
      onClick={onOpen}
    />
  );
}
