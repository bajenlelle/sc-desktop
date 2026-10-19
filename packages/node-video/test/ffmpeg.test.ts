import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStreamProbe } from "../lib/ffmpeg.ts";

// `ffmpeg -hide_banner -i <file>` stderr, captured from ffmpeg 8.0 (the
// desktop's sidecar) unless noted.

const WITH_AUDIO = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'copy.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf62.3.100
  Duration: 00:00:52.06, start: 0.000000, bitrate: 2693 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1280x720 [SAR 1:1 DAR 16:9], 2568 kb/s, 25.26 fps, 25 tbr, 1000k tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : [0][0][0][0]
      encoder         : Lavc62.11.100 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 22050 Hz, stereo, fltp, 118 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
      vendor_id       : [0][0][0][0]
At least one output file must be specified
`;

const NO_AUDIO = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'noaudio.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf62.3.100
  Duration: 00:00:03.00, start: 0.000000, bitrate: 6495 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 6492 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : [0][0][0][0]
      encoder         : Lavc62.11.100 libx264
At least one output file must be specified
`;

/** In the layout of Debian bookworm's ffmpeg 5.1 (the container's), written out by hand: a 29.97 fps copy, 48 kHz audio. */
const FFMPEG_5_1 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://videos.example/copy.mp4?X-Amz-Signature=abc':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf59.27.100
  Duration: 01:32:10.04, start: 0.000000, bitrate: 2101 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 1995 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : [0][0][0][0]
  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 96 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
      vendor_id       : [0][0][0][0]
At least one output file must be specified
`;

test("parseStreamProbe: a copy with audio", () => {
  assert.deepEqual(parseStreamProbe(WITH_AUDIO), { hasAudio: true, fps: 25.26, durationSeconds: 52.06, width: 1280, height: 720 });
});

test("parseStreamProbe: a copy without an audio stream", () => {
  assert.deepEqual(parseStreamProbe(NO_AUDIO), { hasAudio: false, fps: 25, durationSeconds: 3, width: 1280, height: 720 });
});

test("parseStreamProbe: ffmpeg 5.1's layout, hours in the duration", () => {
  const p = parseStreamProbe(FFMPEG_5_1)!;
  assert.equal(p.hasAudio, true);
  assert.equal(p.fps, 29.97);
  assert.equal(p.width, 1280);
  assert.equal(p.height, 720);
  assert.ok(Math.abs(p.durationSeconds! - 5530.04) < 1e-9);
});

test("parseStreamProbe: an input ffmpeg could not open is null", () => {
  const refused = `[tcp @ 0x7fab920041c0] Connection to tcp://127.0.0.1:9 failed: Connection refused
[in#0 @ 0x7fab91713900] Error opening input: Connection refused
Error opening input file http://127.0.0.1:9/copy.mp4.
Error opening input files: Connection refused
`;
  const missing = `[in#0 @ 0x7fd435f13900] Error opening input: No such file or directory
Error opening input file /nonexistent/copy.mp4.
Error opening input files: No such file or directory
`;
  const garbage = `[mov,mp4,m4a,3gp,3g2,mj2 @ 0x7fd949713bc0] Format mov,mp4,m4a,3gp,3g2,mj2 detected only with low score of 1, misdetection possible!
[mov,mp4,m4a,3gp,3g2,mj2 @ 0x7fd949713bc0] moov atom not found
[in#0 @ 0x7fd949713900] Error opening input: Invalid data found when processing input
Error opening input file /tmp/garbage.mp4.
Error opening input files: Invalid data found when processing input
`;
  const forbidden = `[https @ 0x55d0c1e0] HTTP error 403 Forbidden
https://videos.example/copy.mp4?X-Amz-Signature=abc: Server returned 403 Forbidden (access denied)
`;
  for (const stderr of [refused, missing, garbage, forbidden, ""]) assert.equal(parseStreamProbe(stderr), null);
});

test("parseStreamProbe: no duration, or no video stream, still reads what is there", () => {
  const live = WITH_AUDIO.replace("Duration: 00:00:52.06", "Duration: N/A");
  assert.equal(parseStreamProbe(live)!.durationSeconds, null);
  const audioOnly = WITH_AUDIO.split("\n").filter((l) => !l.includes("Video:")).join("\n");
  assert.deepEqual(parseStreamProbe(audioOnly), { hasAudio: true, fps: 0, durationSeconds: 52.06, width: 0, height: 0 });
});

test("parseStreamProbe: a video stream whose line prints only tbr has fps 0, as the desktop's parser reads it", () => {
  const tbrOnly = NO_AUDIO.replace("25 fps, ", "");
  assert.equal(parseStreamProbe(tbrOnly)!.fps, 0);
});
