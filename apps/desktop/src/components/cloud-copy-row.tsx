import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudUpload, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  gameVideoBlock,
  gameVideoQuotaLabel,
  getGameVideoForMatch,
  getGameVideoQuota,
  type GameVideo,
  type GameVideoQuota,
} from "@scoutable/shared/lib/game-videos-db";
import { Button } from "@/components/ui/button";
import {
  GAME_VIDEO_CHANGED,
  WEB_APP_URL,
  cancelCloudCopy,
  cloudCopyLabel,
  removeCloudCopy,
  startCloudCopy,
  useCloudCopyJob,
} from "@/lib/game-video";
import { createClient } from "@/lib/supabase/client";
import type { StoredMatch } from "@/types/match";

/**
 * The game page's "Cloud copy" row, under the video file: what the game's
 * copy in the cloud is up to, and the one action that fits. Not in the
 * cloud → upload (within the plan's cap); running → progress and Cancel;
 * ready → Watch on web and Remove; interrupted or failed → resume or retry.
 */
export function CloudCopyRow({ match }: { match: StoredMatch }) {
  const job = useCloudCopyJob(match.id);
  const [copy, setCopy] = useState<GameVideo | null | undefined>(undefined);
  const [quota, setQuota] = useState<GameVideoQuota | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    const supabase = createClient();
    void getGameVideoForMatch(supabase, match.id).then(setCopy);
    void getGameVideoQuota(supabase, match.orgId ?? null).then(setQuota);
  }, [match.id, match.orgId]);

  useEffect(() => {
    reload();
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ matchId: string }>).detail?.matchId === match.id) reload();
    };
    window.addEventListener(GAME_VIDEO_CHANGED, onChange);
    return () => window.removeEventListener(GAME_VIDEO_CHANGED, onChange);
  }, [reload, match.id]);

  async function remove() {
    setBusy(true);
    try {
      await removeCloudCopy(match.id);
    } finally {
      setBusy(false);
    }
  }

  const block = gameVideoBlock(quota);
  const size = copy?.sizeBytes ? `${(copy.sizeBytes / 1e9).toFixed(1)} GB` : null;
  const row = "flex min-h-11 items-center gap-3 px-4 py-2";

  if (job) {
    return (
      <div className={row}>
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm nums">{cloudCopyLabel(job)}</span>
        <Button size="xs" variant="outline" onClick={() => void cancelCloudCopy(match.id)}>
          Cancel
        </Button>
      </div>
    );
  }

  if (copy?.status === "ready") {
    return (
      <div className={row}>
        <Cloud className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm nums">In the cloud{size && ` · ${size}`}</span>
        <Button size="xs" variant="outline" onClick={() => void openUrl(`${WEB_APP_URL}/games/${encodeURIComponent(match.id)}`)}>
          Watch on web
        </Button>
        <Button size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>
          Remove
        </Button>
      </div>
    );
  }

  if (copy?.status === "uploading" || copy?.status === "failed") {
    const interrupted = copy.status === "uploading";
    return (
      <div className={row}>
        <CloudUpload className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{interrupted ? "Upload interrupted" : "The upload didn't finish"}</span>
        <Button size="xs" onClick={() => void startCloudCopy(match, { replace: true })}>
          {interrupted ? "Resume" : "Try again"}
        </Button>
        <Button size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className={row}>
      <CloudUpload className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">Keep a copy in the cloud</span>
        <span className="text-callout text-muted-foreground">
          {quota ? gameVideoQuotaLabel(quota) : "A 720p copy, so the game plays on the web."}
        </span>
      </span>
      <Button size="xs" disabled={copy === undefined || block !== null} onClick={() => void startCloudCopy(match)}>
        Upload
      </Button>
    </div>
  );
}
