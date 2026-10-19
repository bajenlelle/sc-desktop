import { describe, expect, it } from "vitest";
import {
  EXPORT_SILENCE,
  POSTER_SEEKS,
  cardSegmentArgs,
  clipSegmentArgs,
  concatArgs,
  cropXExpr,
  posterArgs,
  rustFixed,
} from "../export-args";

// The golden strings below are copied verbatim from the tests in
// apps/desktop/src-tauri/src/lib.rs (each block names its Rust test). A Rust
// string's trailing `\` joins it with the next line minus the indentation, so
// those goldens appear here as one line.

/** What the server puts after the desktop's leading `-y` on every list. */
const QUIET = ["-hide_banner", "-loglevel", "error"];
/** The desktop's list with QUIET after its `-y`. */
const quiet = (desktop: string[]) => [desktop[0], ...QUIET, ...desktop.slice(1)];
const argAfter = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) throw new Error(`${flag} missing`);
  return args[i + 1];
};

describe("cropXExpr (lib.rs build_crop_x_expr)", () => {
  it("crop_expr_no_keyframes_is_static_center", () => {
    expect(cropXExpr([])).toBe("2*trunc(clip(0.5*iw-ow/2\\,0\\,iw-ow)/2)");
  });

  it("crop_expr_single_keyframe_is_constant", () => {
    expect(cropXExpr([{ t: 3.0, cx: 0.25 }])).toBe("2*trunc(clip(0.2500*iw-ow/2\\,0\\,iw-ow)/2)");
  });

  it("crop_expr_two_keyframes_lerp", () => {
    expect(cropXExpr([{ t: 0.0, cx: 0.3 }, { t: 5.0, cx: 0.7 }])).toBe(
      "2*trunc(clip(if(lt(t\\,5.000)\\,lerp(0.3000\\,0.7000\\,(t-0.000)/5.000)\\,0.7000)*iw-ow/2\\,0\\,iw-ow)/2)",
    );
  });

  it("crop_expr_three_keyframes_nest_and_hold_last", () => {
    expect(
      cropXExpr([
        { t: 0.0, cx: 0.5 },
        { t: 2.0, cx: 0.2 },
        { t: 6.0, cx: 0.8 },
      ]),
    ).toBe(
      "2*trunc(clip(if(lt(t\\,2.000)\\,lerp(0.5000\\,0.2000\\,(t-0.000)/2.000)\\,if(lt(t\\,6.000)\\,lerp(0.2000\\,0.8000\\,(t-2.000)/4.000)\\,0.8000))*iw-ow/2\\,0\\,iw-ow)/2)",
    );
  });

  it("crop_expr_sorts_and_dedupes_near_duplicate_times", () => {
    // Unsorted input + a duplicate time within 1ms: must not emit a
    // zero-span lerp (division by ~zero in the ffmpeg evaluator).
    expect(
      cropXExpr([
        { t: 4.0, cx: 0.9 },
        { t: 0.0, cx: 0.1 },
        { t: 4.0005, cx: 0.6 },
      ]),
    ).toBe("2*trunc(clip(if(lt(t\\,4.000)\\,lerp(0.1000\\,0.9000\\,(t-0.000)/4.000)\\,0.9000)*iw-ow/2\\,0\\,iw-ow)/2)");
  });

  it("dedupes against the keyframe kept before, as Vec::dedup_by does", () => {
    // 0.0006 is within 1 ms of 0 and goes; 0.0012 is 1.2 ms from the kept 0 and stays.
    expect(
      cropXExpr([
        { t: 0, cx: 0.1 },
        { t: 0.0006, cx: 0.2 },
        { t: 0.0012, cx: 0.3 },
      ]),
    ).toBe("2*trunc(clip(if(lt(t\\,0.001)\\,lerp(0.1000\\,0.3000\\,(t-0.000)/0.001)\\,0.3000)*iw-ow/2\\,0\\,iw-ow)/2)");
  });

  it("leaves its input alone", () => {
    const kfs = [{ t: 4, cx: 0.9 }, { t: 0, cx: 0.1 }];
    cropXExpr(kfs);
    expect(kfs).toEqual([{ t: 4, cx: 0.9 }, { t: 0, cx: 0.1 }]);
  });
});

describe("clipSegmentArgs (lib.rs clip_segment_args)", () => {
  // clip_segment_16x9_resamples_to_the_export_rate
  const VF_16x9 =
    "setpts=PTS-STARTPTS,fps=30000/1001,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=0.25,fade=t=out:st=3.750:d=0.25";
  // clip_segment_9x16_resamples_before_cropping
  const VF_9x16 =
    "setpts=PTS-STARTPTS,fps=25,crop=w=min(iw\\,2*trunc(ih*9/32)):h=ih:x=2*trunc(clip(0.5*iw-ow/2\\,0\\,iw-ow)/2):y=0,scale=1080:1920:flags=lanczos,setsar=1,fade=t=in:st=0:d=0.25,fade=t=out:st=1.750:d=0.25";

  const clip16x9 = (over: Partial<Parameters<typeof clipSegmentArgs>[0]> = {}) =>
    clipSegmentArgs({ input: "/v/game.mp4", start: 10.0, end: 14.0, aspect: "16:9", rate: "30000/1001", keyframes: null, hasAudio: true, output: "/tmp/seg.mp4", ...over });

  it("clip_segment_16x9_resamples_to_the_export_rate", () => {
    const args = clip16x9();
    // Rust checks &args[..7]; here the quiet flags sit between -y and the rest.
    const desktopView = [args[0], ...args.slice(1 + QUIET.length)];
    expect(desktopView.slice(0, 7)).toEqual(["-y", "-ss", "10.000", "-to", "14.000", "-i", "/v/game.mp4"]);
    expect(argAfter(args, "-vf")).toBe(VF_16x9);
    expect(args).not.toContain("-pix_fmt"); // 16:9 path keeps the source pixel format
    expect(args[args.length - 1]).toBe("/tmp/seg.mp4");
  });

  it("is the desktop's whole 16:9 list with the quiet flags after -y", () => {
    expect(clip16x9()).toEqual(
      quiet([
        "-y",
        "-ss", "10.000",
        "-to", "14.000",
        "-i", "/v/game.mp4",
        "-vf", VF_16x9,
        "-af", "asetpts=PTS-STARTPTS",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "/tmp/seg.mp4",
      ]),
    );
  });

  it("clip_segment_9x16_resamples_before_cropping", () => {
    const args = clipSegmentArgs({ input: "/v/game.mp4", start: 0.0, end: 2.0, aspect: "9:16", rate: "25", keyframes: [], hasAudio: true, output: "/tmp/seg.mp4" });
    expect(argAfter(args, "-vf")).toBe(VF_9x16);
    expect(argAfter(args, "-pix_fmt")).toBe("yuv420p");
    expect(args).toEqual(
      quiet([
        "-y",
        "-ss", "0.000",
        "-to", "2.000",
        "-i", "/v/game.mp4",
        "-vf", VF_9x16,
        "-af", "asetpts=PTS-STARTPTS",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "/tmp/seg.mp4",
      ]),
    );
  });

  it("puts the pan's expression in the 9:16 crop and ignores keyframes for 16:9", () => {
    const keyframes = [{ t: 0, cx: 0.3 }, { t: 5, cx: 0.7 }];
    const vertical = clipSegmentArgs({ input: "/v/game.mp4", start: 0, end: 5, aspect: "9:16", rate: "25", keyframes, hasAudio: true, output: "/o.mp4" });
    expect(argAfter(vertical, "-vf")).toContain(`:x=${cropXExpr(keyframes)}:y=0,`);
    expect(argAfter(clip16x9({ keyframes }), "-vf")).toBe(VF_16x9);
    // null centres the window, like Some(&[]) does.
    const centred = clipSegmentArgs({ input: "/v/game.mp4", start: 0, end: 2, aspect: "9:16", rate: "25", keyframes: null, hasAudio: true, output: "/tmp/seg.mp4" });
    expect(argAfter(centred, "-vf")).toBe(VF_9x16);
  });

  it("holds the duration at 1 ms and the fade-out at 0 for an empty window, as lib.rs does", () => {
    const args = clip16x9({ start: 5, end: 5, hasAudio: false });
    expect(argAfter(args, "-vf")).toContain("fade=t=out:st=0.000:d=0.25");
    expect(argAfter(args, "-t")).toBe("0.001");
  });

  it("adds ffmpeg's reconnect flags before -ss for an https copy, as shipClipArgs does", () => {
    const url = "https://videos.example/copy.mp4?X-Amz-Signature=abc";
    const args = clip16x9({ input: url });
    expect(args.slice(0, 15)).toEqual([
      "-y", "-hide_banner", "-loglevel", "error",
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      "-ss", "10.000", "-to", "14.000", "-i",
    ]);
    expect(argAfter(args, "-i")).toBe(url);
    expect(clip16x9({ input: "HTTP://videos.example/copy.mp4" })).toContain("-reconnect");
    expect(clip16x9()).not.toContain("-reconnect");
  });

  it("gives a clip whose copy has no audio the cards' silence, as long as the clip, mapped as its audio", () => {
    const args = clip16x9({ hasAudio: false });
    expect(args).toEqual([
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", "10.000", "-to", "14.000", "-i", "/v/game.mp4",
      "-f", "lavfi", "-t", "4.000", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-map", "0:v:0", "-map", "1:a:0",
      "-vf", VF_16x9,
      "-af", "asetpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "/tmp/seg.mp4",
    ]);
    expect(EXPORT_SILENCE).toBe("anullsrc=channel_layout=stereo:sample_rate=44100");
    // With audio the desktop's default stream selection stands: no -map at all.
    expect(clip16x9()).not.toContain("-map");
  });

  it("formats times as Rust's {:.3} does (an exact binary tie goes to the even digit)", () => {
    const args = clip16x9({ start: 10.0625, end: 14.4375 });
    expect(argAfter(args, "-ss")).toBe("10.062");
    expect(argAfter(args, "-to")).toBe("14.438");
  });

  it("never adds faststart: only the final pass does", () => {
    expect(clip16x9()).not.toContain("-movflags");
    const vertical = clipSegmentArgs({ input: "/v/game.mp4", start: 0, end: 2, aspect: "9:16", rate: "25", keyframes: [], hasAudio: false, output: "/o.mp4" });
    expect(vertical).not.toContain("-movflags");
    expect(vertical.filter((a) => a === "-pix_fmt")).toHaveLength(1);
  });
});

describe("cardSegmentArgs (lib.rs text_card_args)", () => {
  it("text_card_is_rendered_at_the_export_rate", () => {
    const args = cardSegmentArgs({ png: "/tmp/card.png", durationSeconds: 3.0, rate: "25", output: "/tmp/t.mp4" });
    expect(argAfter(args, "-framerate")).toBe("25");
    expect(args).not.toContain("30"); // no hard-coded 30 fps left
    expect(argAfter(args, "-t")).toBe("3.000");
    expect(args[args.length - 1]).toBe("/tmp/t.mp4");
  });

  it("is the desktop's whole list with the quiet flags after -y", () => {
    expect(cardSegmentArgs({ png: "/tmp/card.png", durationSeconds: 5, rate: "30000/1001", output: "/tmp/t.mp4" })).toEqual(
      quiet([
        "-y",
        "-framerate", "30000/1001",
        "-loop", "1",
        "-i", "/tmp/card.png",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf", "fade=t=in:st=0:d=0.25,fade=t=out:st=4.750:d=0.25",
        "-af", "asetpts=PTS-STARTPTS",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-t", "5.000",
        "/tmp/t.mp4",
      ]),
    );
  });

  it("starts the fade-out at 0 for a card shorter than the fade", () => {
    const args = cardSegmentArgs({ png: "/c.png", durationSeconds: 0.2, rate: "25", output: "/t.mp4" });
    expect(argAfter(args, "-vf")).toBe("fade=t=in:st=0:d=0.25,fade=t=out:st=0.000:d=0.25");
    expect(args).not.toContain("-movflags");
  });
});

describe("concatArgs (lib.rs concat_args)", () => {
  const inputs = ["/tmp/a.mp4", "/tmp/b.mp4"];

  it("concat_pass_forces_a_constant_output_rate", () => {
    for (const watermarkPng of [null, "/tmp/wm.png"]) {
      const args = concatArgs({ inputs, watermarkPng, aspect: "16:9", rate: "30000/1001", output: "/out.mp4" });
      expect(args.slice(-3)).toEqual(["-r", "30000/1001", "/out.mp4"]);
    }
  });

  /** The desktop's list, then the final pass's additions before `-r`. */
  const withAdditions = (desktop: string[]) => {
    const r = desktop.indexOf("-r");
    return quiet([...desktop.slice(0, r), "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...desktop.slice(r)]);
  };
  const tail = ["-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-r", "30000/1001", "/out.mp4"];

  it("joins the segments with the concat filter, no watermark", () => {
    expect(concatArgs({ inputs, watermarkPng: null, aspect: "16:9", rate: "30000/1001", output: "/out.mp4" })).toEqual(
      withAdditions(["-y", "-i", "/tmp/a.mp4", "-i", "/tmp/b.mp4", "-filter_complex", "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[outv][outa]", ...tail]),
    );
  });

  it("overlays the wordmark bottom right in 16:9", () => {
    expect(concatArgs({ inputs, watermarkPng: "/tmp/wm.png", aspect: "16:9", rate: "30000/1001", output: "/out.mp4" })).toEqual(
      withAdditions([
        "-y", "-i", "/tmp/a.mp4", "-i", "/tmp/b.mp4", "-i", "/tmp/wm.png",
        "-filter_complex", "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[cv][outa];[cv][2:v]overlay=W-w-24:H-h-48[outv]",
        ...tail,
      ]),
    );
  });

  it("overlays the wordmark centred, 700 px up, in 9:16", () => {
    const args = concatArgs({ inputs: ["/a.mp4", "/b.mp4", "/c.mp4"], watermarkPng: "/wm.png", aspect: "9:16", rate: "25", output: "/out.mp4" });
    expect(argAfter(args, "-filter_complex")).toBe(
      "[0:v:0][0:a:0][1:v:0][1:a:0][2:v:0][2:a:0]concat=n=3:v=1:a=1[cv][outa];[cv][3:v]overlay=(W-w)/2:H-h-700[outv]",
    );
    expect(args.slice(0, 12)).toEqual(["-y", "-hide_banner", "-loglevel", "error", "-i", "/a.mp4", "-i", "/b.mp4", "-i", "/c.mp4", "-i", "/wm.png"]);
    expect(args.slice(-7)).toEqual(["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "25", "/out.mp4"]);
  });

  it("has the web-playback additions exactly once", () => {
    const args = concatArgs({ inputs, watermarkPng: null, aspect: "9:16", rate: "25", output: "/out.mp4" });
    expect(args.filter((a) => a === "-movflags")).toHaveLength(1);
    expect(args.filter((a) => a === "-pix_fmt")).toHaveLength(1);
  });
});

describe("posterArgs (lib.rs extract_poster_frame)", () => {
  it("is the desktop's list at 0.6 s, then at 0", () => {
    expect(POSTER_SEEKS).toEqual([0.6, 0]);
    expect(posterArgs("/tmp/v.mp4", "/tmp/p.jpg", POSTER_SEEKS[0])).toEqual(quiet(["-y", "-ss", "0.6", "-i", "/tmp/v.mp4", "-frames:v", "1", "-q:v", "3", "/tmp/p.jpg"]));
    expect(posterArgs("/tmp/v.mp4", "/tmp/p.jpg", POSTER_SEEKS[1])).toEqual(quiet(["-y", "-ss", "0", "-i", "/tmp/v.mp4", "-frames:v", "1", "-q:v", "3", "/tmp/p.jpg"]));
  });
});

describe("rustFixed (Rust's {:.N})", () => {
  it("agrees with toFixed off a tie", () => {
    for (const x of [0, 1, 3.75, 10.0005, 0.0005, 123.4565, 0.1, 0.7, 4.0005, 7199.999]) {
      for (const n of [0, 1, 3, 4]) expect(rustFixed(x, n)).toBe(x.toFixed(n));
    }
  });

  it("rounds an exact binary tie to the even digit, where toFixed rounds it up (values checked against rustc)", () => {
    expect(rustFixed(0.0625, 3)).toBe("0.062");
    expect((0.0625).toFixed(3)).toBe("0.063");
    expect(rustFixed(10.0625, 3)).toBe("10.062");
    expect(rustFixed(1.4375, 3)).toBe("1.438");
    expect(rustFixed(0.9375, 3)).toBe("0.938");
    expect(rustFixed(0.03125, 4)).toBe("0.0312");
    expect(rustFixed(0.15625, 4)).toBe("0.1562");
    expect(rustFixed(0.96875, 4)).toBe("0.9688");
    expect(rustFixed(0.5, 0)).toBe("0");
    expect(rustFixed(1.5, 0)).toBe("2");
    expect(rustFixed(2.5, 0)).toBe("2");
    expect(rustFixed(-0.0625, 3)).toBe("-0.062");
  });

  it("keeps the sign of negative zero, as Rust does", () => {
    expect(rustFixed(-0, 3)).toBe("-0.000");
    expect(rustFixed(-0.0001, 3)).toBe("-0.000");
    expect(rustFixed(0, 3)).toBe("0.000");
  });

  it("is what the crop expression prints", () => {
    expect(cropXExpr([{ t: 0.0625, cx: 0.03125 }])).toBe("2*trunc(clip(0.0312*iw-ow/2\\,0\\,iw-ow)/2)");
  });
});
