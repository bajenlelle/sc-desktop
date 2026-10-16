/**
 * Content fingerprint of a local recording: duration plus dHashes of 9×8 grey
 * thumbnails that the sidecar renders at fixed offsets. Only these hashes and
 * the duration ever leave the machine (to look up shared sync hints).
 */
import {
  FINGERPRINT_VERSION,
  dhashFromGray9x8,
  fingerprintKey,
  fingerprintOffsetsFor,
  type VideoFingerprint,
} from "@scoutable/shared/lib/video-fingerprint";
import { base64ToBytes, grabFrames, probeVideo, type VideoProbe } from "./video-frames";

export interface FingerprintedVideo {
  probe: VideoProbe;
  fingerprint: VideoFingerprint;
}

export async function computeVideoFingerprint(path: string): Promise<FingerprintedVideo> {
  const probe = await probeVideo(path);
  const durationS = probe.durationMs / 1000;
  const offsetsS = fingerprintOffsetsFor(durationS);
  const frames = await grabFrames(path, { kind: "times", times: offsetsS }, { kind: "gray_thumb", width: 9, height: 8 });
  if (frames.length !== offsetsS.length) throw new Error(`fingerprint: got ${frames.length} thumbnails for ${offsetsS.length} offsets`);
  const hashes = frames.map((f) => dhashFromGray9x8(base64ToBytes(f.dataBase64)));
  const key = await fingerprintKey(probe.durationMs, hashes);
  return { probe, fingerprint: { version: FINGERPRINT_VERSION, durationMs: probe.durationMs, offsetsS, hashes, key } };
}
