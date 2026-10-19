import assert from "node:assert/strict";
import { test } from "node:test";
import { FunctionClient, FunctionError, RenderClient, StaleAttempt } from "../src/function-client.ts";

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that answers from a script of responses and records what it was asked. */
function fakeFetch(script: (() => Response | Error)[]): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    const next = script.shift();
    if (!next) throw new Error("no scripted response left");
    const out = next();
    if (out instanceof Error) throw out;
    return out;
  }) as typeof fetch;
  return { fetch: fetchFn, seen };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const client = (f: typeof fetch) => new FunctionClient({ url: "https://ref.supabase.co/functions/v1/", secret: "worker-secret", videoId: "vid", fetch: f, retryDelayMs: 1 });

test("every call posts to /game-video with the secret header, the action and the video id", async () => {
  const { fetch, seen } = fakeFetch([json({ videoId: "vid", attempt: 2, sourceUrl: "u", sourceSizeBytes: 1, sourceName: null, partSize: 1, match: {} })]);
  const take = await client(fetch).take();
  assert.equal(take.attempt, 2);
  assert.equal(seen[0].url, "https://ref.supabase.co/functions/v1/game-video");
  assert.equal(seen[0].headers["x-worker-secret"], "worker-secret");
  assert.deepEqual(seen[0].body, { action: "job_take", videoId: "vid" });
});

test("stale_attempt becomes StaleAttempt at once, other 4xx become FunctionError without a retry", async () => {
  const stale = fakeFetch([json({ error: "stale_attempt" }, 409)]);
  await assert.rejects(client(stale.fetch).progress(1, 0.5), (e) => e instanceof StaleAttempt);
  assert.equal(stale.seen.length, 1);

  const busy = fakeFetch([json({ error: "job_busy" }, 409), json({})]);
  await assert.rejects(client(busy.fetch).take(), (e) => e instanceof FunctionError && e.token === "job_busy" && e.status === 409);
  assert.equal(busy.seen.length, 1);
});

test("5xx answers and network failures are retried, then succeed", async () => {
  const { fetch, seen } = fakeFetch([json({ error: "storage_failed" }, 502), () => new TypeError("fetch failed"), json({ urls: [{ partNumber: 1, url: "u" }], expiresAt: "x" })]);
  const signed = await client(fetch).signParts(3, [1]);
  assert.equal(signed.urls.length, 1);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[2].body, { action: "job_sign_parts", videoId: "vid", attempt: 3, partNumbers: [1] });
});

test("after the last try the last error is thrown; a dead network is request_failed", async () => {
  const { fetch, seen } = fakeFetch([() => new TypeError("fetch failed"), () => new TypeError("fetch failed")]);
  await assert.rejects(client(fetch).progress(1, 0.1), (e) => e instanceof FunctionError && e.token === "request_failed" && e.status === 0);
  assert.equal(seen.length, 2);
});

test("failed() carries the error and the retry flag and honours per-call tries", async () => {
  const { fetch, seen } = fakeFetch([() => new TypeError("fetch failed")]);
  await assert.rejects(client(fetch).failed(4, "sigterm", true, { tries: 1 }));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].body, { action: "job_failed", videoId: "vid", attempt: 4, error: "sigterm", retryable: true });
});

const render = (f: typeof fetch) => new RenderClient({ url: "https://ref.supabase.co/functions/v1", secret: "worker-secret", jobId: "job-1", fetch: f, retryDelayMs: 1 });

test("the render client speaks render_* about a jobId, with the same header and endpoint", async () => {
  const take = { jobId: "job-1", attempt: 1, kind: "ship", copies: {}, clips: [], publicBase: "https://media.example" };
  const { fetch, seen } = fakeFetch([json(take)]);
  const got = await render(fetch).take();
  assert.deepEqual(got, take);
  assert.equal(seen[0].url, "https://ref.supabase.co/functions/v1/game-video");
  assert.equal(seen[0].headers["x-worker-secret"], "worker-secret");
  assert.deepEqual(seen[0].body, { action: "render_take", jobId: "job-1" });
});

test("render_done carries the results and render_failed the flag; stale_attempt is StaleAttempt here too", async () => {
  const results = [{ matchId: "m1", eventId: 7, key: "clips/m1/7_pre10.0_post3.0_s1.0.mp4", ok: true }];
  const done = fakeFetch([json({ jobId: "job-1", status: "done", shipped: 1, failed: 0, superseded: 0 })]);
  const got = await render(done.fetch).done(2, results);
  assert.equal(got.shipped, 1);
  assert.deepEqual(done.seen[0].body, { action: "render_done", jobId: "job-1", attempt: 2, results });

  const failed = fakeFetch([json({ jobId: "job-1", status: "queued", attempt: 2 })]);
  await render(failed.fetch).failed(2, "upload_failed", true);
  assert.deepEqual(failed.seen[0].body, { action: "render_failed", jobId: "job-1", attempt: 2, error: "upload_failed", retryable: true });

  const stale = fakeFetch([json({ error: "stale_attempt" }, 409)]);
  await assert.rejects(render(stale.fetch).progress(1, 0.5), (e) => e instanceof StaleAttempt);

  const busy = fakeFetch([json({ error: "job_busy" }, 409)]);
  await assert.rejects(render(busy.fetch).take(), (e) => e instanceof FunctionError && e.token === "job_busy");
  assert.equal(busy.seen.length, 1);
});
