import assert from "node:assert/strict";
import { test } from "node:test";
import { shipClipArgs } from "@scoutable/shared/lib/game-video-convert";
import type { RenderShipClip } from "@scoutable/shared/lib/game-video-wire";
import { Aborted } from "../src/errors.ts";
import { ffmpegShipFailure, isInfrastructureFailure, shipClips, type FfmpegRun, type ShipDeps } from "../src/ship.ts";

const copies = { v1: { url: "https://videos.example/copy.mp4?X-Amz-Signature=abc" } };

function clip(i: number, over: Partial<RenderShipClip> = {}): RenderShipClip {
  return {
    clipId: String(i),
    matchId: "m1",
    eventId: 100 + i,
    videoId: "v1",
    start: 10 * i,
    end: 10 * i + 13,
    key: `clips/m1/${100 + i}_pre10.0_post3.0_s${(10 * i).toFixed(1)}.mp4`,
    putUrl: `https://media.example/clips/${i}?sig=${i}`,
    ...over,
  };
}

interface FakeWorld {
  deps: ShipDeps;
  ffmpegRuns: string[][];
  puts: { url: string; bytes: number; contentType: string }[];
  removed: string[];
}

/**
 * A world where ffmpeg "writes" a file whose size and duration the test
 * decides per output path (by its index), and PUTs answer from a script.
 */
function fakeWorld(o: {
  ffmpeg?: (args: string[], run: number) => FfmpegRun | Error;
  size?: (index: number, run: number) => number;
  duration?: (index: number, run: number) => number | null;
  put?: (url: string, n: number) => number | Error;
} = {}): FakeWorld {
  const ffmpegRuns: string[][] = [];
  const puts: FakeWorld["puts"] = [];
  const removed: string[] = [];
  const runsByIndex = new Map<number, number>();
  const putsByUrl = new Map<string, number>();
  const indexOf = (path: string) => Number(/(\d+)\.mp4$/.exec(path)?.[1] ?? -1);
  const deps: ShipDeps = {
    runFfmpeg: async (args) => {
      ffmpegRuns.push(args);
      const index = indexOf(args[args.length - 1]);
      const run = (runsByIndex.get(index) ?? 0) + 1;
      runsByIndex.set(index, run);
      const out = o.ffmpeg ? o.ffmpeg(args, run) : { code: 0, signal: null, stderr: "" };
      if (out instanceof Error) throw out;
      return out;
    },
    fileSize: async (path) => (o.size ? o.size(indexOf(path), runsByIndex.get(indexOf(path)) ?? 1) : 50_000),
    probeDuration: async (path) => (o.duration ? o.duration(indexOf(path), runsByIndex.get(indexOf(path)) ?? 1) : 13),
    readFile: async (path) => Buffer.from(`bytes of ${path}`),
    put: async (url, body, contentType) => {
      const n = (putsByUrl.get(url) ?? 0) + 1;
      putsByUrl.set(url, n);
      puts.push({ url, bytes: body.length, contentType });
      const out = o.put ? o.put(url, n) : 200;
      if (out instanceof Error) throw out;
      return out;
    },
    remove: async (path) => {
      removed.push(path);
    },
  };
  return { deps, ffmpegRuns, puts, removed };
}

const ship = (world: FakeWorld, clips: RenderShipClip[], extra: Partial<Parameters<typeof shipClips>[0]> = {}) =>
  shipClips({ copies, clips, workDir: "/work", signal: new AbortController().signal, deps: world.deps, retryDelayMs: 1, ...extra });

test("every clip is cut with the desktop's arguments from the copy's URL, checked, PUT as video/mp4 and removed", async () => {
  const world = fakeWorld();
  const clips = [clip(0), clip(1), clip(2)];
  const seen: number[] = [];
  const out = await ship(world, clips, { onClipDone: (done) => seen.push(done) });

  assert.equal(world.ffmpegRuns.length, 3);
  assert.deepEqual(world.ffmpegRuns[0], shipClipArgs(copies.v1.url, 0, 13, "/work/0.mp4"));
  assert.deepEqual(world.ffmpegRuns[2], shipClipArgs(copies.v1.url, 20, 33, "/work/2.mp4"));
  assert.equal(world.puts.length, 3);
  assert.deepEqual(
    world.puts.map((p) => [p.url, p.contentType]),
    clips.map((c) => [c.putUrl, "video/mp4"]),
  );
  assert.deepEqual(world.removed.sort(), ["/work/0.mp4", "/work/1.mp4", "/work/2.mp4"]);
  assert.deepEqual(out.results, clips.map((c) => ({ matchId: c.matchId, eventId: c.eventId, key: c.key, ok: true })));
  assert.equal(out.shipped, 3);
  assert.equal(out.failed, 0);
  assert.equal(out.infrastructureOnly, false);
  assert.deepEqual(seen.sort(), [1, 2, 3]);
});

test("at most three clips are in flight at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const world = fakeWorld();
  const slow = world.deps.runFfmpeg;
  world.deps.runFfmpeg = async (args, signal) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return slow(args, signal);
  };
  const out = await ship(world, Array.from({ length: 8 }, (_, i) => clip(i)));
  assert.equal(out.shipped, 8);
  assert.equal(peak, 3);
});

test("a cut that fails once is tried again in the retry pass and then counts as shipped", async () => {
  const world = fakeWorld({ ffmpeg: (args, run) => (args[args.length - 1] === "/work/1.mp4" && run === 1 ? { code: 1, signal: null, stderr: "Error while decoding\nConversion failed!" } : { code: 0, signal: null, stderr: "" }) });
  const out = await ship(world, [clip(0), clip(1)]);
  assert.equal(world.ffmpegRuns.length, 3);
  assert.equal(out.shipped, 2);
  assert.equal(out.results[1].ok, true);
});

test("a clip that keeps failing is one failed result, never the job's failure", async () => {
  const world = fakeWorld({ ffmpeg: (args) => (args[args.length - 1] === "/work/1.mp4" ? { code: 1, signal: null, stderr: "x: Invalid data found when processing input" } : { code: 0, signal: null, stderr: "" }) });
  const out = await ship(world, [clip(0), clip(1), clip(2)]);
  assert.equal(world.ffmpegRuns.length, 4);
  assert.equal(world.puts.length, 2);
  assert.deepEqual(out.results[1], { matchId: "m1", eventId: 101, key: clip(1).key, ok: false, error: "cut_failed" });
  assert.equal(out.shipped, 2);
  assert.equal(out.failed, 1);
  assert.equal(out.infrastructureOnly, false);
});

test("a tiny output or a cut of the wrong length is refused before any PUT", async () => {
  const small = fakeWorld({ size: (index) => (index === 0 ? 1024 : 50_000) });
  const a = await ship(small, [clip(0), clip(1)]);
  assert.equal(a.results[0].error, "output_too_small");
  assert.equal(a.results[1].ok, true);
  assert.equal(small.puts.length, 1);

  const short = fakeWorld({ duration: (index) => (index === 0 ? 12.2 : 13.4) });
  const b = await ship(short, [clip(0), clip(1)]);
  assert.equal(b.results[0].error, "duration_mismatch");
  assert.equal(b.results[1].ok, true);

  const unreadable = fakeWorld({ duration: () => null });
  const c = await ship(unreadable, [clip(0)]);
  assert.equal(c.results[0].error, "duration_mismatch");
  assert.equal(unreadable.puts.length, 0);
});

test("a PUT is tried three times; a 5xx and a network failure are retried, a 403 is not", async () => {
  const flaky = fakeWorld({ put: (_url, n) => (n === 1 ? 503 : n === 2 ? new TypeError("fetch failed") : 200) });
  const a = await ship(flaky, [clip(0)]);
  assert.equal(a.results[0].ok, true);
  assert.equal(flaky.puts.length, 3);

  const forbidden = fakeWorld({ put: () => 403 });
  const b = await ship(forbidden, [clip(0)]);
  assert.equal(b.results[0].error, "upload_failed");
  assert.equal(forbidden.puts.length, 2, "one PUT per pass: a refused signature is not repeated within the pass");
  assert.equal(b.infrastructureOnly, true);

  const dead = fakeWorld({ put: () => new TypeError("fetch failed") });
  const c = await ship(dead, [clip(0)]);
  assert.equal(c.results[0].error, "upload_failed");
  assert.equal(dead.puts.length, 6, "three tries in each of the two passes");
});

test("the job is handed back only when every clip failed for an infrastructure reason", async () => {
  const allUploads = fakeWorld({ put: () => 500 });
  assert.equal((await ship(allUploads, [clip(0), clip(1)])).infrastructureOnly, true);

  const noFfmpeg = fakeWorld({ ffmpeg: () => Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }) });
  const a = await ship(noFfmpeg, [clip(0), clip(1)]);
  assert.equal(a.results[0].error, "ffmpeg_unavailable");
  assert.equal(a.infrastructureOnly, true);

  const copyGone = fakeWorld({ ffmpeg: () => ({ code: 1, signal: null, stderr: "[https @ 0x1] HTTP error 403 Forbidden\nServer returned 403 Forbidden (access denied)" }) });
  const b = await ship(copyGone, [clip(0)]);
  assert.equal(b.results[0].error, "source_unreachable");
  assert.equal(b.infrastructureOnly, true);

  const mixed = fakeWorld({
    ffmpeg: (args) => (args[args.length - 1] === "/work/0.mp4" ? { code: 1, signal: null, stderr: "Conversion failed!" } : { code: 0, signal: null, stderr: "" }),
    put: () => 500,
  });
  const c = await ship(mixed, [clip(0), clip(1)]);
  assert.equal(c.failed, 2);
  assert.equal(c.infrastructureOnly, false, "a clip failing on its own account means another attempt would not help it");

  const partly = fakeWorld({ put: (url) => (url.endsWith("sig=0") ? 500 : 200) });
  assert.equal((await ship(partly, [clip(0), clip(1)])).infrastructureOnly, false);

  const empty = await ship(fakeWorld(), []);
  assert.equal(empty.infrastructureOnly, false);
  assert.deepEqual(empty.results, []);
});

test("a clip whose video has no copy in the plan is an infrastructure failure", async () => {
  const world = fakeWorld();
  const out = await ship(world, [clip(0, { videoId: "missing" })]);
  assert.equal(out.results[0].error, "source_unreachable");
  assert.equal(world.ffmpegRuns.length, 0);
});

test("an aborted run stops with Aborted and kills nothing twice", async () => {
  const ctrl = new AbortController();
  const world = fakeWorld();
  world.deps.runFfmpeg = async () => {
    ctrl.abort("sigterm");
    return { code: null, signal: "SIGTERM", stderr: "" };
  };
  await assert.rejects(shipClips({ copies, clips: [clip(0), clip(1)], workDir: "/work", signal: ctrl.signal, deps: world.deps }), (e) => e instanceof Aborted && e.reason === "sigterm");
  assert.equal(world.puts.length, 0);
});

test("ffmpegShipFailure and isInfrastructureFailure name the sides", () => {
  assert.equal(ffmpegShipFailure("Failed to resolve hostname videos.example: Name or service not known"), "source_unreachable");
  assert.equal(ffmpegShipFailure("Connection reset by peer"), "source_unreachable");
  assert.equal(ffmpegShipFailure("Output file is empty, nothing was encoded"), "cut_failed");
  assert.equal(ffmpegShipFailure(""), "cut_failed");
  assert.equal(isInfrastructureFailure("upload_failed"), true);
  assert.equal(isInfrastructureFailure("ffmpeg_unavailable"), true);
  assert.equal(isInfrastructureFailure("duration_mismatch"), false);
  assert.equal(isInfrastructureFailure("output_too_small"), false);
});
