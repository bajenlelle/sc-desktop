/**
 * The Highlights page (pages/highlights.tsx) against the test account's real games on staging, with nothing
 * written and no model called:
 *   - "Who are you?" lists the players of the account's games; picking one is intercepted (no my_players write);
 *   - the games' videos read as present (their Range probes answered 206), so the best game is picked and its
 *     plays are suggested;
 *   - framing runs on plain stills (grab_frames and probe_video answered in the page) with the positions of a
 *     real Claude answer from the 2026-11-27 staging run (the highlight-frame call answered here).
 * Screenshots: highlights-<browser>-picker, -games, -tiles.
 */
import { expect, shot, test } from "../helpers";

/** A small plain JPEG: every frame the page asks for. */
const FRAME_JPEG = "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABMAAEBAAAAAAAAAAAAAAAAAAAABQEBAQAAAAAAAAAAAAAAAAAAAAQQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAA2AGADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCWAjUgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/Z";
const ANSWER = {
  observation: {
    frames: [0.665, 0.635, 0.61, 0.568, 0.533, 0.488, 0.44, 0.4, 0.345, 0.298, 0.262, 0.218, 0.178].map((x, i) => ({ image: i + 1, x, cameraCut: false })),
    releaseImage: 10,
    rimX: 0.265,
    madeImage: 11,
    identity: "likely",
    note: "Followed the shooter from the top of the key to the layup.",
  },
  usage: { model: "claude-opus-5-5", inputTokens: 10764, outputTokens: 1232, latencyMs: 14297, fallback: false },
};

test("highlights: pick yourself, your games, framed tiles", async ({ page, browserName }) => {
  const name = (step: string) => `highlights-${browserName}-${step}`;
  const frames = [FRAME_JPEG];

  let savedPlayer = false;
  await page.route("**/rest/v1/my_players*", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    savedPlayer = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  });
  // The games' own videos aren't on this machine: answer their Range probes as present.
  await page.route((url) => /\.(mp4|mov|mkv|m4v)$/i.test(url.pathname) && !url.pathname.includes("/headless/fixtures/"), (route) =>
    route.fulfill({ status: 206, headers: { "Content-Range": "bytes 0-0/1000000", "Content-Type": "video/mp4" }, body: "0" }));
  let framed = 0;
  await page.route("**/functions/v1/highlight-frame", (route) => {
    framed++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANSWER) });
  });

  await page.goto("/highlights");
  // Frames and video probes for the stubbed videos, answered in the page instead of the sidecar.
  await page.evaluate((jpegs) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>, opts?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internals.invoke.bind(internals);
    internals.invoke = (cmd, args, opts) => {
      if (cmd === "probe_video") return Promise.resolve({ durationMs: 7_200_000, width: 1920, height: 1080, fps: 25 });
      if (cmd === "export_playlist") {
        // Record what the render was asked for, and keep it running: the dialog's working state is what's checked.
        (window as unknown as { __exports: unknown[] }).__exports = [...((window as unknown as { __exports?: unknown[] }).__exports ?? []), args];
        return new Promise(() => {});
      }
      if (cmd === "grab_frames") {
        const req = (args?.req ?? {}) as { at?: { kind: string; times?: number[] } };
        const times = req.at?.times ?? [0];
        return Promise.resolve(times.map((t, i) => ({ t, dataBase64: jpegs[i % jpegs.length], width: 960, height: 540 })));
      }
      return original(cmd, args, opts);
    };
  }, frames);

  await expect(page.getByRole("heading", { level: 1, name: "Highlights" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Who are you?" })).toBeVisible({ timeout: 30_000 });
  await shot(page, name("picker"));

  // The player with the most games is first.
  await page.locator("section").filter({ has: page.getByRole("heading") }).getByRole("button").first().click();
  await expect.poll(() => savedPlayer, { message: "picking a player saves it", timeout: 15_000 }).toBe(true);
  await expect(page.getByRole("heading", { name: "Your video" })).toBeVisible({ timeout: 30_000 });
  await shot(page, name("games"));

  const strip = page.getByRole("region", { name: "Your video" });
  await expect(strip.getByText("Framing…")).toHaveCount(0, { timeout: 30_000 });
  expect(framed, "the plays in the video were framed").toBeGreaterThan(0);
  await page.waitForTimeout(800); // the stills settle in
  await shot(page, name("tiles"));

  // Send to phone: no earlier link for these plays, so it renders at once, 9:16, with hard cuts and the watermark.
  await page.route("**/rest/v1/highlight_shares*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.getByRole("button", { name: "Send to phone" }).click();
  const dialog = page.getByRole("dialog", { name: "Send to your phone" });
  await expect(dialog.getByText("Rendering your highlight…")).toBeVisible({ timeout: 15_000 });
  const exports = () => page.evaluate(() => (window as unknown as { __exports?: Array<Record<string, unknown>> }).__exports ?? []);
  await expect.poll(async () => (await exports()).length, { message: "the render starts", timeout: 15_000 }).toBe(1);
  const asked = await exports();
  expect(asked[0]).toMatchObject({ vertical: true, watermark: true, hardCuts: true });
  const segs = asked[0].segments as Array<Record<string, unknown>>;
  expect(segs.at(-1), "the video ends on the end card").toMatchObject({ kind: "image" });
  await shot(page, name("send"));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});
