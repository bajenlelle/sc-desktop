/**
 * The 720p copy: ffmpeg with the shared arguments (the same list the
 * desktop uses), progress read from `-progress pipe:1`, killed on abort.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseProgressUs, transcodeArgs } from "@scoutable/shared/lib/game-video-convert";
import { Aborted, ConvertFailure, abortReason, ffmpegFailureToken } from "./errors.ts";

export interface EncodeProgress {
  /** 0..1 of the source's duration. */
  fraction: number;
  encodedS: number;
  /** ffmpeg's own `speed=` figure, such as "3.9x", once it has printed one. */
  speed: string | null;
}

export interface EncodeOptions {
  ffmpeg: string;
  input: string;
  output: string;
  scaleDown: boolean;
  durationS: number;
  signal: AbortSignal;
  onProgress?: (p: EncodeProgress) => void;
}

const STDERR_KEEP = 8192;
const KILL_GRACE_MS = 2000;

export async function encodeCopy(o: EncodeOptions): Promise<{ wallS: number }> {
  const t0 = Date.now();
  const child = spawn(o.ffmpeg, transcodeArgs(o.input, o.output, o.scaleDown), { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (s: string) => {
    stderr = (stderr + s).slice(-STDERR_KEEP);
  });
  let speed: string | null = null;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const us = parseProgressUs(line);
    if (us !== null) {
      const encodedS = us / 1e6;
      o.onProgress?.({ fraction: o.durationS > 0 ? Math.min(1, encodedS / o.durationS) : 0, encodedS, speed });
      return;
    }
    if (line.startsWith("speed=")) speed = line.slice("speed=".length).trim() || null;
  });
  const kill = () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, KILL_GRACE_MS).unref();
  };
  if (o.signal.aborted) kill();
  else o.signal.addEventListener("abort", kill, { once: true });
  try {
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (c, s) => resolve([c, s]));
    });
    if (o.signal.aborted) throw new Aborted(abortReason(o.signal));
    if (code !== 0) {
      const lastLine = stderr.trim().split("\n").pop() ?? "";
      throw new ConvertFailure(ffmpegFailureToken(stderr), undefined, `ffmpeg exited with ${code ?? signal}: ${lastLine}`);
    }
    return { wallS: (Date.now() - t0) / 1000 };
  } catch (e) {
    if (e instanceof ConvertFailure || e instanceof Aborted) throw e;
    // Could not spawn at all (no binary at FFMPEG, say).
    throw new ConvertFailure("transcode_incomplete", true, `ffmpeg: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    o.signal.removeEventListener("abort", kill);
    lines.close();
  }
}
