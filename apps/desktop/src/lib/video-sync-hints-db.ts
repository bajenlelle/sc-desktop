/** Desktop binding of the shared video sync hint helpers (same pattern as lib/matches-db.ts). */
import {
  findVideoSyncHints as sharedFind,
  pickBestHint,
  saveVideoSyncHint as sharedSave,
  type HintMethod,
  type VideoSyncHintCandidate,
} from "@scoutable/shared/lib/video-sync-hints-db";
import type { VideoFingerprint } from "@scoutable/shared/lib/video-fingerprint";
import { createClient } from "@/lib/supabase/client";

export type { VideoSyncHintCandidate, HintMethod };
export { pickBestHint };

export function findVideoSyncHints(fp: VideoFingerprint, sourceGameId?: string): Promise<VideoSyncHintCandidate[]> {
  return sharedFind(createClient(), fp, sourceGameId);
}

export function saveVideoSyncHint(input: {
  fp: VideoFingerprint;
  sourceGameId?: string;
  tipoffVideoTime: number;
  method: HintMethod;
  confidence?: number;
}): Promise<string> {
  return sharedSave(createClient(), input);
}
