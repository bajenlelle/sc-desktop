import assert from "node:assert/strict";
import { test } from "node:test";
import { WATERMARK_PNG } from "@scoutable/node-video/lib/assets";
import { ProbeFailure, type StreamProbe } from "@scoutable/node-video/lib/ffmpeg";
import { cardSegmentArgs, clipSegmentArgs, concatArgs, posterArgs } from "@scoutable/shared/lib/export-args";
import type { ExportAspect, RenderExportPlan, RenderExportSegment, RenderPhase } from "@scoutable/shared/lib/game-video-wire";
import { Aborted } from "../src/errors.ts";
import {
  CARD_MIN_SEGMENT_BYTES,
  ExportFailure,
  checkExportPlan,
  parseDryRunExport,
  renderExport,
  type CardSource,
  type ExportDeps,
  type ExportOptions,
} from "../src/export.ts";
import type { FfmpegRun } from "../src/ship.ts";

const URL_1 = "https://videos.example/v1.mp4?X-Amz-Signature=one";
const URL_2 = "https://videos.example/v2.mp4?X-Amz-Signature=two";
const copies = { v1: { url: URL_1 }, v2: { url: URL_2 } };
const W = "/work";

const clip = (videoId: string, start: number, end: number, keyframes: { t: number; cx: number }[] | null = null): RenderExportSegment => ({
  kind: "clip",
  matchId: "m1",
  eventId: Math.round(start),
  videoId,
  start,
  end,
  keyframes,
});
const card = (durationSeconds: number, text: string, spec: unknown | null = null): RenderExportSegment => ({ kind: "card", durationSeconds, text, card: spec });

function plan(segments: RenderExportSegment[], over: Partial<RenderExportPlan> = {}): RenderExportPlan {
  return {
    aspect: "16:9",
    purpose: "download",
    watermark: false,
    rate: "30000/1001",
    title: "Playlist",
    segments,
    put: { video: "https://private.example/exports/x.mp4?sig=v" },
    keys: { video: "ref/exports/u/j.mp4" },
    ...over,
  };
}

const sharePut = { video: "https://media.example/highlights/u/s.mp4?sig=v", poster: "https://media.example/highlights/u/s.jpg?sig=p" };

interface Run {
  args: string[];
  progress: boolean;
}

interface World {
  deps: ExportDeps;
  runs: Run[];
  probes: string[];
  puts: { url: string; contentType: string; timeoutMs: number }[];
  painted: { source: CardSource; aspect: ExportAspect }[];
  written: string[];
  removed: string[];
  /** The fake disk: path → size. */
  files: Map<string, number>;
}

const outputOf = (args: string[]) => args[args.length - 1];
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/**
 * A world where ffmpeg "writes" its output with a size the test picks, a
 * probe answers for copies and for what ffmpeg wrote, and PUTs answer from
 * a script.
 */
function world(o: {
  ffmpeg?: (args: string[], call: number, onProgressUs?: (us: number) => void) => FfmpegRun | Error | undefined;
  size?: (path: string) => number | undefined;
  copy?: (url: string) => StreamProbe | Error;
  duration?: (path: string) => number | null | undefined;
  put?: (url: string, n: number) => number | Error;
  paint?: (source: CardSource) => Buffer | Error;
} = {}): World {
  const w: World = { deps: undefined as unknown as ExportDeps, runs: [], probes: [], puts: [], painted: [], written: [], removed: [], files: new Map() };
  const argsByOutput = new Map<string, string[]>();
  const putsByUrl = new Map<string, number>();
  let call = 0;
  w.deps = {
    runFfmpeg: async (args, _signal, onProgressUs) => {
      w.runs.push({ args, progress: onProgressUs !== undefined });
      call++;
      const scripted = o.ffmpeg?.(args, call, onProgressUs);
      if (scripted instanceof Error) throw scripted;
      const run = scripted ?? { code: 0, signal: null, stderr: "" };
      if (run.code === 0) {
        const out = outputOf(args);
        argsByOutput.set(out, args);
        w.files.set(out, o.size?.(out) ?? (out.endsWith(".jpg") ? 12_000 : 50_000));
      }
      return run;
    },
    probe: async (input) => {
      w.probes.push(input);
      if (!input.startsWith(W)) {
        const p = o.copy?.(input) ?? { hasAudio: true, fps: 29.97, durationSeconds: 600, width: 1280, height: 720 };
        if (p instanceof Error) throw p;
        return p;
      }
      const override = o.duration?.(input);
      const args = argsByOutput.get(input) ?? [];
      const fromArgs = args.includes("-to") ? Number(argAfter(args, "-to")) - Number(argAfter(args, "-ss")) : args.includes("-t") ? Number(argAfter(args, "-t")) : 42;
      return { hasAudio: true, fps: 29.97, durationSeconds: override === undefined ? fromArgs : override, width: 1280, height: 720 };
    },
    paintCard: async (source, aspect) => {
      w.painted.push({ source, aspect });
      const out = o.paint?.(source) ?? Buffer.from("png");
      if (out instanceof Error) throw out;
      return out;
    },
    writeFile: async (path, bytes) => {
      w.written.push(path);
      w.files.set(path, bytes.length);
    },
    fileSize: async (path) => {
      const size = w.files.get(path);
      if (size === undefined) throw new Error(`ENOENT ${path}`);
      return size;
    },
    readFile: async (path) => Buffer.from(`bytes of ${path}`),
    put: async (url, _body, contentType, _signal, timeoutMs) => {
      const n = (putsByUrl.get(url) ?? 0) + 1;
      putsByUrl.set(url, n);
      w.puts.push({ url, contentType, timeoutMs });
      const out = o.put ? o.put(url, n) : 200;
      if (out instanceof Error) throw out;
      return out;
    },
    remove: async (path) => {
      w.removed.push(path);
      w.files.delete(path);
    },
  };
  return w;
}

const run = (w: World, p: RenderExportPlan, extra: Partial<ExportOptions> = {}) =>
  renderExport({ plan: p, copies, workDir: W, signal: new AbortController().signal, deps: w.deps, retryDelayMs: 1, ...extra });

const rejectsWith = (token: string, retryable: boolean, segment?: number) => (e: unknown) => {
  assert.ok(e instanceof ExportFailure, `expected ExportFailure, got ${String(e)}`);
  assert.equal(e.token, token);
  assert.equal(e.retryable, retryable);
  if (segment !== undefined) assert.equal(e.segment, segment);
  return true;
};

// ── the pipeline, in order ────────────────────────────────────────────────────

test("a download: each segment with the desktop's arguments in order, the concat pass, one PUT, and every file removed", async () => {
  const w = world();
  const p = plan([clip("v1", 10, 14), card(3, "Q2"), clip("v2", 20, 26)]);
  const out = await run(w, p);

  assert.deepEqual(w.runs, [
    { args: clipSegmentArgs({ input: URL_1, start: 10, end: 14, aspect: "16:9", rate: "30000/1001", keyframes: null, hasAudio: true, output: `${W}/seg_0.mp4` }), progress: false },
    { args: cardSegmentArgs({ png: `${W}/card_1.png`, durationSeconds: 3, rate: "30000/1001", output: `${W}/seg_1.mp4` }), progress: false },
    { args: clipSegmentArgs({ input: URL_2, start: 20, end: 26, aspect: "16:9", rate: "30000/1001", keyframes: null, hasAudio: true, output: `${W}/seg_2.mp4` }), progress: false },
    {
      args: concatArgs({ inputs: [`${W}/seg_0.mp4`, `${W}/seg_1.mp4`, `${W}/seg_2.mp4`], watermarkPng: null, aspect: "16:9", rate: "30000/1001", output: `${W}/export.mp4` }),
      progress: true,
    },
  ]);
  // Each copy once, then every clip segment, then the export.
  assert.deepEqual(w.probes, [URL_1, URL_2, `${W}/seg_0.mp4`, `${W}/seg_2.mp4`, `${W}/export.mp4`]);
  assert.deepEqual(w.painted, [{ source: { text: "Q2", card: null }, aspect: "16:9" }]);
  assert.deepEqual(w.written, [`${W}/card_1.png`]);
  assert.deepEqual(w.puts.map((x) => [x.url, x.contentType]), [[p.put.video, "video/mp4"]]);
  assert.deepEqual(out.segments.map((s) => [s.kind, s.seconds]), [["clip", 4], ["card", 3], ["clip", 6]]);
  assert.equal(out.sizeBytes, 50_000);
  assert.equal(out.durationSeconds, 42);
  assert.equal(out.posterOk, false);
  assert.equal(out.posterPath, null);
  assert.equal(w.files.size, 0, `left behind: ${[...w.files.keys()].join(", ")}`);
});

test("a plan without a rate takes it from the first clip's probed copy, as the desktop takes its first source's", async () => {
  const w = world({ copy: () => ({ hasAudio: true, fps: 25, durationSeconds: 600, width: 1280, height: 720 }) });
  await run(w, plan([clip("v1", 10, 14), card(3, "Second half")], { rate: "" }));
  assert.deepEqual(w.runs[0].args, clipSegmentArgs({ input: URL_1, start: 10, end: 14, aspect: "16:9", rate: "25", keyframes: null, hasAudio: true, output: `${W}/seg_0.mp4` }));
  assert.equal(argAfter(w.runs[w.runs.length - 1].args, "-r"), "25");
});

test("each copy is probed once, however many clips are cut from it", async () => {
  const w = world();
  await run(w, plan([clip("v1", 10, 14), clip("v1", 30, 33), clip("v1", 50, 55)]));
  assert.equal(w.probes.filter((x) => x === URL_1).length, 1);
});

test("a clip from a copy without audio gets the cards' silence; one from a copy with audio does not", async () => {
  const w = world({ copy: (url) => ({ hasAudio: url !== URL_1, fps: 25, durationSeconds: 600, width: 1280, height: 720 }) });
  await run(w, plan([clip("v1", 10, 14), clip("v2", 20, 24)]));
  assert.deepEqual(w.runs[0].args, clipSegmentArgs({ input: URL_1, start: 10, end: 14, aspect: "16:9", rate: "30000/1001", hasAudio: false, output: `${W}/seg_0.mp4` }));
  assert.ok(w.runs[0].args.includes("anullsrc=channel_layout=stereo:sample_rate=44100"));
  assert.equal(argAfter(w.runs[0].args, "-t"), "4.000");
  assert.ok(!w.runs[1].args.includes("-map"));
});

test("the watermark: the wordmark rides as the concat pass's last input, the asset's twin by default", async () => {
  const on = world();
  await run(on, plan([clip("v1", 10, 14), card(2, "x")], { watermark: true, aspect: "9:16" }));
  const concat = on.runs[on.runs.length - 1].args;
  assert.deepEqual(concat, concatArgs({ inputs: [`${W}/seg_0.mp4`, `${W}/seg_1.mp4`], watermarkPng: WATERMARK_PNG, aspect: "9:16", rate: "30000/1001", output: `${W}/export.mp4` }));
  assert.ok(WATERMARK_PNG.endsWith("packages/node-video/assets/watermark.png"), WATERMARK_PNG);
  assert.ok(argAfter(concat, "-filter_complex").endsWith("overlay=(W-w)/2:H-h-700[outv]"));

  const given = world();
  await run(given, plan([clip("v1", 10, 14)], { watermark: true }), { watermarkPng: "/assets/wm.png" });
  assert.ok(given.runs[given.runs.length - 1].args.includes("/assets/wm.png"));

  const off = world();
  await run(off, plan([clip("v1", 10, 14)], { watermark: false }));
  assert.ok(!off.runs[off.runs.length - 1].args.some((a) => a.endsWith(".png")));
});

test("9:16 puts the clip's pan in the crop; 16:9 leaves a pan out", async () => {
  const keyframes = [{ t: 0, cx: 0.3 }, { t: 4, cx: 0.7 }];
  const vertical = world();
  await run(vertical, plan([clip("v1", 10, 14, keyframes)], { aspect: "9:16" }));
  assert.deepEqual(vertical.runs[0].args, clipSegmentArgs({ input: URL_1, start: 10, end: 14, aspect: "9:16", rate: "30000/1001", keyframes, hasAudio: true, output: `${W}/seg_0.mp4` }));
  assert.ok(argAfter(vertical.runs[0].args, "-vf").includes("lerp(0.3000\\,0.7000"));

  const wide = world();
  await run(wide, plan([clip("v1", 10, 14, keyframes)], { aspect: "16:9" }));
  assert.ok(!argAfter(wide.runs[0].args, "-vf").includes("lerp"));
});

test("a stats card's spec goes to the painter with its text", async () => {
  const spec = { type: "stats", v: 1 };
  const w = world();
  await run(w, plan([card(5, "Alva Berg · 24 PTS", spec)], { aspect: "9:16" }));
  assert.deepEqual(w.painted, [{ source: { text: "Alva Berg · 24 PTS", card: spec }, aspect: "9:16" }]);
  assert.ok(w.removed.includes(`${W}/card_0.png`), "the card's PNG goes once its segment is made");
});

// ── a share's poster ──────────────────────────────────────────────────────────

test("a share: the poster at 0.6 s, PUT as image/jpeg after the video", async () => {
  const w = world();
  const out = await run(w, plan([clip("v1", 10, 14)], { purpose: "share", watermark: true, put: sharePut }));
  const poster = w.runs[w.runs.length - 1];
  assert.deepEqual(poster, { args: posterArgs(`${W}/export.mp4`, `${W}/poster.jpg`, 0.6), progress: false });
  assert.deepEqual(w.puts.map((x) => [x.url, x.contentType]), [[sharePut.video, "video/mp4"], [sharePut.poster, "image/jpeg"]]);
  assert.equal(out.posterOk, true);
  assert.equal(w.files.size, 0);
});

test("a poster frame retried at 0 s when 0.6 s gives none (a video shorter than the seek)", async () => {
  let posterRuns = 0;
  const w = world({ size: (path) => (path.endsWith(".jpg") ? (++posterRuns === 1 ? 0 : 9000) : undefined) });
  const out = await run(w, plan([card(1, "short")], { purpose: "share", put: sharePut }));
  const seeks = w.runs.filter((r) => outputOf(r.args).endsWith("poster.jpg")).map((r) => argAfter(r.args, "-ss"));
  assert.deepEqual(seeks, ["0.6", "0"]);
  assert.equal(out.posterOk, true);
});

test("no poster (no frame, a refused PUT, no URL for it): posterOk false and the export still goes up", async () => {
  const noFrame = world({ ffmpeg: (args) => (outputOf(args).endsWith(".jpg") ? { code: 1, signal: null, stderr: "Output file is empty" } : undefined) });
  const a = await run(noFrame, plan([clip("v1", 10, 14)], { purpose: "share", put: sharePut }));
  assert.equal(a.posterOk, false);
  assert.deepEqual(noFrame.puts.map((x) => x.contentType), ["video/mp4"]);

  const refused = world({ put: (url) => (url === sharePut.poster ? 403 : 200) });
  const b = await run(refused, plan([clip("v1", 10, 14)], { purpose: "share", put: sharePut }));
  assert.equal(b.posterOk, false);

  const unsigned = world();
  const c = await run(unsigned, plan([clip("v1", 10, 14)], { purpose: "share", put: { video: sharePut.video } }));
  assert.equal(c.posterOk, false);
  assert.equal(unsigned.puts.length, 1);
});

test("a download makes no poster", async () => {
  const w = world();
  await run(w, plan([clip("v1", 10, 14)], { purpose: "download" }));
  assert.ok(!w.runs.some((r) => outputOf(r.args).endsWith(".jpg")));
});

// ── failures ──────────────────────────────────────────────────────────────────

test("a segment that fails on its own account is segment_failed:<n>, not retried, nothing uploaded, every file removed", async () => {
  const cut = world({ ffmpeg: (args) => (outputOf(args).endsWith("seg_2.mp4") ? { code: 1, signal: null, stderr: "Error while decoding stream\nConversion failed!" } : undefined) });
  await assert.rejects(run(cut, plan([clip("v1", 10, 14), card(2, "x"), clip("v1", 30, 34)])), rejectsWith("segment_failed:3", false, 3));
  assert.equal(cut.puts.length, 0);
  assert.equal(cut.files.size, 0, `left behind: ${[...cut.files.keys()].join(", ")}`);

  const empty = world({ size: (path) => (path.endsWith("seg_0.mp4") ? 261 : undefined) });
  await assert.rejects(run(empty, plan([clip("v1", 590, 594)])), rejectsWith("segment_failed:1", false, 1));

  const short = world({ duration: (path) => (path.endsWith("seg_0.mp4") ? 3.2 : undefined) });
  await assert.rejects(run(short, plan([clip("v1", 10, 14)])), rejectsWith("segment_failed:1", false));
  const unreadable = world({ duration: (path) => (path.endsWith("seg_0.mp4") ? null : undefined) });
  await assert.rejects(run(unreadable, plan([clip("v1", 10, 14)])), rejectsWith("segment_failed:1", false));

  const badCard = world({ paint: () => new Error("canvas exploded") });
  await assert.rejects(run(badCard, plan([clip("v1", 10, 14), card(2, "x")])), rejectsWith("segment_failed:2", false, 2));
  assert.equal(badCard.files.size, 0);
});

test("a card is held to its own floor: a blank one-second card is a few KB, a track-less file is not", async () => {
  const blank = world({ size: (path) => (path.endsWith("seg_0.mp4") ? 3418 : undefined) });
  await run(blank, plan([card(1, "")]));
  const trackless = world({ size: (path) => (path.endsWith("seg_0.mp4") ? CARD_MIN_SEGMENT_BYTES - 1 : undefined) });
  await assert.rejects(run(trackless, plan([card(1, "")])), rejectsWith("segment_failed:1", false));
  // A clip of that size is a failed cut.
  const clipSmall = world({ size: (path) => (path.endsWith("seg_0.mp4") ? 3418 : undefined) });
  await assert.rejects(run(clipSmall, plan([clip("v1", 10, 14)])), rejectsWith("segment_failed:1", false));
});

test("a clip running past its copy's end holds what the copy has, as on the desktop", async () => {
  const w = world({ copy: () => ({ hasAudio: true, fps: 25, durationSeconds: 100, width: 1280, height: 720 }), duration: (path) => (path.endsWith("seg_0.mp4") ? 2.04 : undefined) });
  const out = await run(w, plan([clip("v1", 98, 103)]));
  assert.equal(argAfter(w.runs[0].args, "-to"), "103.000", "the desktop's -to stands");
  assert.equal(out.segments[0].seconds, 2.04);
});

test("the copy refusing the cut over HTTP is source_unreachable and retryable", async () => {
  const w = world({ ffmpeg: (args) => (outputOf(args).endsWith("seg_0.mp4") ? { code: 1, signal: null, stderr: "[https @ 0x1] HTTP error 403 Forbidden\nServer returned 403 Forbidden (access denied)" } : undefined) });
  await assert.rejects(run(w, plan([clip("v1", 10, 14)])), rejectsWith("source_unreachable", true));
});

test("infrastructure failures are retryable: no ffmpeg, a copy that can't be read or isn't in the plan, ffmpeg killed from outside", async () => {
  const noFfmpeg = world({ ffmpeg: () => Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }) });
  await assert.rejects(run(noFfmpeg, plan([clip("v1", 10, 14)])), rejectsWith("ffmpeg_unavailable", true));

  const probeNoFfmpeg = world({ copy: () => new ProbeFailure("ffmpeg_unavailable", "", "ffmpeg could not start") });
  await assert.rejects(run(probeNoFfmpeg, plan([clip("v1", 10, 14)])), rejectsWith("ffmpeg_unavailable", true));

  const gone = world({ copy: () => new ProbeFailure("unreadable", "Server returned 404 Not Found", "ffmpeg could not open the input") });
  await assert.rejects(run(gone, plan([clip("v1", 10, 14)])), rejectsWith("source_unreachable", true));

  const notInPlan = world();
  await assert.rejects(run(notInPlan, plan([clip("v9", 10, 14)])), rejectsWith("source_unreachable", true));
  assert.equal(notInPlan.runs.length, 0);

  const killed = world({ ffmpeg: () => ({ code: null, signal: "SIGKILL", stderr: "" }) });
  await assert.rejects(run(killed, plan([clip("v1", 10, 14)])), rejectsWith("ffmpeg_killed", true));

  const full = world({ ffmpeg: (args) => (outputOf(args).endsWith("export.mp4") ? { code: 1, signal: null, stderr: "Error writing trailer: No space left on device" } : undefined) });
  await assert.rejects(run(full, plan([clip("v1", 10, 14)])), rejectsWith("disk_full", false));
});

test("the upload: three tries on 5xx and network failures, one on a refused signature, then upload_failed (retryable)", async () => {
  const flaky = world({ put: (_url, n) => (n === 1 ? 503 : n === 2 ? new TypeError("fetch failed") : 200) });
  await run(flaky, plan([clip("v1", 10, 14)]));
  assert.equal(flaky.puts.length, 3);

  const down = world({ put: () => 503 });
  await assert.rejects(run(down, plan([clip("v1", 10, 14)])), rejectsWith("upload_failed", true));
  assert.equal(down.puts.length, 3);
  assert.equal(down.files.size, 0);

  const refused = world({ put: () => 403 });
  await assert.rejects(run(refused, plan([clip("v1", 10, 14)])), rejectsWith("upload_failed", true));
  assert.equal(refused.puts.length, 1);
});

test("the concat pass failing, or an export that can't be read back, is stitch_failed (not retried)", async () => {
  const failed = world({ ffmpeg: (args) => (outputOf(args).endsWith("export.mp4") ? { code: 1, signal: null, stderr: "Input link parameters do not match" } : undefined) });
  await assert.rejects(run(failed, plan([clip("v1", 10, 14), card(2, "x")])), rejectsWith("stitch_failed", false));
  assert.equal(failed.files.size, 0);

  const tiny = world({ size: (path) => (path.endsWith("export.mp4") ? 300 : undefined) });
  await assert.rejects(run(tiny, plan([clip("v1", 10, 14)])), rejectsWith("stitch_failed", false));

  const unreadable = world({ duration: (path) => (path.endsWith("export.mp4") ? null : undefined) });
  await assert.rejects(run(unreadable, plan([clip("v1", 10, 14)])), rejectsWith("stitch_failed", false));
});

test("a malformed plan is invalid_plan, before anything runs", () => {
  const ok = plan([clip("v1", 10, 14)]);
  const bad = (p: unknown, upload = true) => assert.throws(() => checkExportPlan(p as RenderExportPlan, upload), rejectsWith("invalid_plan", false));
  bad(undefined);
  bad({ ...ok, aspect: "4:3" });
  bad({ ...ok, purpose: "print" });
  bad({ ...ok, rate: "30,drawtext=text=x" });
  bad({ ...ok, segments: [] });
  bad({ ...ok, segments: [clip("v1", 14, 14)] });
  bad({ ...ok, segments: [card(0, "x")] });
  bad({ ...ok, segments: [{ kind: "video" }] });
  bad({ ...ok, put: {} });
  // A dry run uploads nothing, so it needs no URL.
  assert.equal(checkExportPlan({ ...ok, put: { video: "" } }, false).segments.length, 1);
  // A keyframe that isn't two numbers is left out; the rest of the pan stands.
  const checked = checkExportPlan({ ...ok, aspect: "9:16", segments: [clip("v1", 10, 14, [{ t: 0, cx: 0.2 }, { t: null, cx: 0.5 } as never, { t: 4, cx: 0.8 }])] }, true);
  assert.deepEqual((checked.segments[0] as Extract<RenderExportSegment, { kind: "clip" }>).keyframes, [{ t: 0, cx: 0.2 }, { t: 4, cx: 0.8 }]);
});

// ── progress and cancel ───────────────────────────────────────────────────────

test("progress: clips per segment over (segments + 1), the stitch from ffmpeg's -progress over the expected length, then upload", async () => {
  const seen: [RenderPhase, number][] = [];
  const w = world({
    ffmpeg: (args, _call, onProgressUs) => {
      if (outputOf(args).endsWith("export.mp4")) {
        onProgressUs?.(3_500_000); // half of the 4 s clip + 3 s card
        onProgressUs?.(99_000_000); // past the end is held at the end
      }
      return undefined;
    },
  });
  await run(w, plan([clip("v1", 10, 14), card(3, "x")]), { onProgress: (phase, value) => seen.push([phase, Number(value.toFixed(4))]) });
  assert.deepEqual(seen, [
    ["clips", 0],
    ["clips", Number((1 / 3).toFixed(4))],
    ["clips", Number((2 / 3).toFixed(4))],
    ["stitch", Number((2 / 3).toFixed(4))],
    ["stitch", Number((2.5 / 3).toFixed(4))],
    ["stitch", 1],
    ["upload", 1],
  ]);
});

test("cancel: the signal stops ffmpeg where it is, every temp file goes, nothing is PUT", async () => {
  const ctrl = new AbortController();
  const w = world({
    ffmpeg: (args) => {
      if (outputOf(args).endsWith("seg_1.mp4")) {
        ctrl.abort("cancelled");
        return { code: null, signal: "SIGTERM", stderr: "" };
      }
      return undefined;
    },
  });
  await assert.rejects(
    renderExport({ plan: plan([clip("v1", 10, 14), card(2, "x"), clip("v1", 30, 34)]), copies, workDir: W, signal: ctrl.signal, deps: w.deps }),
    (e) => e instanceof Aborted && e.reason === "cancelled",
  );
  assert.equal(w.runs.length, 2);
  assert.equal(w.puts.length, 0);
  assert.equal(w.files.size, 0, `left behind: ${[...w.files.keys()].join(", ")}`);
  assert.ok(w.removed.includes(`${W}/seg_0.mp4`));

  // Stopped during the upload: the PUT's abort is the stop, not an upload failure.
  const during = new AbortController();
  const up = world({
    put: () => {
      during.abort("cancelled");
      return new DOMException("aborted", "AbortError") as unknown as Error;
    },
  });
  await assert.rejects(
    renderExport({ plan: plan([clip("v1", 10, 14)]), copies, workDir: W, signal: during.signal, deps: up.deps }),
    (e) => e instanceof Aborted && e.reason === "cancelled",
  );
  assert.equal(up.files.size, 0);
});

test("a dry run keeps the export and the poster and PUTs nothing", async () => {
  const w = world();
  const out = await run(w, plan([clip("v1", 10, 14)], { purpose: "share", put: { video: "" } }), { upload: false });
  assert.equal(w.puts.length, 0);
  assert.deepEqual([...w.files.keys()].sort(), [`${W}/export.mp4`, `${W}/poster.jpg`]);
  assert.equal(out.videoPath, `${W}/export.mp4`);
  assert.equal(out.posterPath, `${W}/poster.jpg`);
  assert.equal(out.posterOk, true);
});

// ── DRY_RUN_EXPORT ────────────────────────────────────────────────────────────

test("parseDryRunExport: paths as copies, defaults filled, the rate left to the probe when not given", () => {
  const a = parseDryRunExport(
    JSON.stringify({ copies: { v1: "/videos/game.mp4" }, aspect: "9:16", purpose: "share", watermark: true, segments: [{ kind: "clip", videoId: "v1", start: 1, end: 5 }, { kind: "card", durationSeconds: 2 }] }),
  );
  assert.deepEqual(a.copies, { v1: { url: "/videos/game.mp4" } });
  assert.equal(a.rateGiven, false);
  assert.equal(a.plan.aspect, "9:16");
  assert.equal(a.plan.watermark, true);
  assert.deepEqual(a.plan.segments, [
    { matchId: "dry-run", eventId: 0, keyframes: null, kind: "clip", videoId: "v1", start: 1, end: 5 },
    { text: "", card: null, kind: "card", durationSeconds: 2 },
  ]);
  assert.equal(checkExportPlan(a.plan, false).segments.length, 2);

  // A render_take response as it came.
  const b = parseDryRunExport(JSON.stringify({ copies: { v1: { url: "https://videos.example/x" } }, export: { aspect: "16:9", purpose: "download", watermark: false, rate: "25", segments: [{ kind: "card", durationSeconds: 3, text: "t", card: null }] } }));
  assert.equal(b.rateGiven, true);
  assert.equal(b.plan.rate, "25");
  assert.deepEqual(b.copies, { v1: { url: "https://videos.example/x" } });

  assert.throws(() => parseDryRunExport(JSON.stringify({ copies: { v1: 7 } })), /copy v1/);
});

test("stopped while a segment is probed: Aborted, not a failed segment", async () => {
  const ctrl = new AbortController();
  const w = world();
  const probe = w.deps.probe;
  w.deps.probe = async (input, signal) => {
    if (input === `${W}/seg_0.mp4`) {
      ctrl.abort("cancelled");
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }
    return probe(input, signal);
  };
  await assert.rejects(
    renderExport({ plan: plan([clip("v1", 10, 14)]), copies, workDir: W, signal: ctrl.signal, deps: w.deps }),
    (e) => e instanceof Aborted && e.reason === "cancelled",
  );
  assert.equal(w.files.size, 0);
});
