import assert from "node:assert/strict";
import { test } from "node:test";
import { Aborted, ConvertFailure, classifyFailure, ffmpegFailureToken } from "../src/errors.ts";
import { FunctionError, StaleAttempt } from "../src/function-client.ts";
import { formatFields, redact } from "../src/log.ts";
import { parseEnvFile } from "../src/env-file.ts";

test("ffmpegFailureToken: unreadable input is final, a missing stream is final, the rest is retried", () => {
  assert.equal(ffmpegFailureToken("source.mp4: Invalid data found when processing input"), "unsupported_type");
  assert.equal(ffmpegFailureToken("[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] moov atom not found"), "unsupported_type");
  assert.equal(ffmpegFailureToken("Stream map '0:v:0' matches no streams.\nTo ignore this, add a trailing '?' to the map."), "no_video_stream");
  assert.equal(ffmpegFailureToken("Error while filtering: Cannot allocate memory"), "transcode_incomplete");
  assert.equal(ffmpegFailureToken("Error opening output files: Invalid argument"), "transcode_incomplete");
  assert.equal(ffmpegFailureToken(""), "transcode_incomplete");
});

test("classifyFailure: named failures keep their token and retry flag", () => {
  assert.deepEqual(classifyFailure(new ConvertFailure("too_long")), { error: "too_long", retryable: false });
  assert.deepEqual(classifyFailure(new ConvertFailure("source_unreadable")), { error: "source_unreadable", retryable: true });
  assert.deepEqual(classifyFailure(new ConvertFailure("source_unreadable", false, "gone")), { error: "source_unreadable", retryable: false });
  assert.deepEqual(classifyFailure(new ConvertFailure("transcode_incomplete")), { error: "transcode_incomplete", retryable: true });
});

test("classifyFailure: a SIGTERM is retryable, function tokens pass through, the rest is internal_error", () => {
  assert.deepEqual(classifyFailure(new Aborted("sigterm")), { error: "sigterm", retryable: true });
  assert.deepEqual(classifyFailure(new FunctionError("size_mismatch", 409)), { error: "size_mismatch", retryable: true });
  assert.deepEqual(classifyFailure(new StaleAttempt()), { error: "stale_attempt", retryable: true });
  assert.deepEqual(classifyFailure(new Error("too_large")), { error: "too_large", retryable: false });
  assert.deepEqual(classifyFailure(new TypeError("boom")), { error: "internal_error", retryable: true });
  assert.deepEqual(classifyFailure("string"), { error: "internal_error", retryable: true });
});

test("redact: URLs and registered secrets never reach the line, which stays one bounded line", () => {
  const out = redact("GET https://x.r2.cloudflarestorage.com/a?X-Amz-Signature=abc failed\nwith secret s3cr3tvalue", ["s3cr3tvalue", "short"]);
  assert.equal(out, "GET <url> failed with secret <secret>");
  assert.equal(redact("x".repeat(500), []).length, 300);
});

test("formatFields: key=value pairs, quoted when needed, nulls skipped, numbers rounded", () => {
  assert.equal(formatFields({ phase: "encode", pct: 37, speed: "3.9x", note: "two words", skip: undefined, nothing: null, ok: true, ratio: 0.123456 }), 'phase=encode pct=37 speed=3.9x note="two words" ok=true ratio=0.123');
});

test("parseEnvFile: KEY=value lines, quotes dropped, comments and blanks skipped", () => {
  const vars = parseEnvFile('# comment\nVITE_SUPABASE_URL="https://ref.supabase.co"\n\nVITE_SUPABASE_ANON_KEY=sb_publishable_abc\nBROKEN\n=nokey\n');
  assert.deepEqual(vars, { VITE_SUPABASE_URL: "https://ref.supabase.co", VITE_SUPABASE_ANON_KEY: "sb_publishable_abc" });
});
