/**
 * Task 6: a note on a stats card. The inspector's Note field (Return starts a
 * new line, a pasted run of newlines collapses to one empty line, 140 at most,
 * "N characters left" from 20), the note drawn under the numbers on the stage
 * (the stage is an <img> painted by the app's card painter; its alt is the
 * card's fallback line, the note's lines joined with " / "), the fallback line
 * saved to text_content, the Vertical (9:16) frame
 * through the same painter, and the note surviving a change of player and of
 * Game/Season. Creates "headless-<port>-<slot> card" and deletes it. The numbers come
 * from Genius' hosted pages through the browser's fetch.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { deletePlaylistsNamed, expect, inScratchPage, newPlaylistWithClips, OUT_DIR, playlistIdNamed, PORT, selectRows, shot, test, owned } from "../helpers";

const NAME = owned("card");
/** 106 characters, typed with one Return: two or three lines under the numbers (shared card-layout tests). */
const NOTE = "Great closeouts all game and\nsmart help from the weak side, keep talking on every switch and box out early";
/** The note as the fallback line carries it: one line, the break as " / ". */
const NOTE_LINE = NOTE.replace("\n", " / ");

// Genius' hosted pages can be slow on a cold read (the card's numbers, then the season's).
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  // A crashed run's playlist, swept in a scratch page so the test's page starts clean.
  await inScratchPage(page, (scratch) => deletePlaylistsNamed(scratch, NAME));
});

test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

/** The card's saved row: its spec and its fallback line. */
async function savedCard(page: Page, id: string) {
  const rows = await selectRows<{ card: { note?: string; player: { name: string }; scope: string } | null; text_content: string | null }>(
    page, "playlist_clips", "card, text_content", { playlist_id: id, item_type: "text" },
  );
  return rows[0] ?? null;
}

/**
 * The card painted at an aspect by the app's painter (export and send to phone
 * use it), without and with the note, read as bands of ink rows (one band per
 * line of text) in the page. The layout centres its block and rounds each
 * baseline, so the note moves the name and numbers up and may shift a line by
 * a pixel: bands are compared by height, not pixel for pixel. Returns both
 * cards' bands, the horizontal extent of the with-note card's extra bands, and
 * the with-note PNG.
 */
async function paintBoth(page: Page, without: { text: string; card: unknown }, withNote: { text: string; card: unknown }, aspect: "16:9" | "9:16") {
  return page.evaluate(
    async ({ without, withNote, aspect }) => {
      const modulePath = "/src/lib/card-painter.ts";
      const painter = await import(/* @vite-ignore */ modulePath);
      await painter.loadCardFonts();
      const read = (c: HTMLCanvasElement) => {
        const { width, height } = c;
        const p = c.getContext("2d")!.getImageData(0, 0, width, height).data;
        const ink = (x: number, y: number) => {
          const i = (y * width + x) * 4;
          return p[i] !== p[0] || p[i + 1] !== p[1] || p[i + 2] !== p[2] || p[i + 3] !== p[3]; // not the corner's colour
        };
        const bands: { top: number; bottom: number; minX: number; maxX: number }[] = [];
        let open: (typeof bands)[number] | null = null;
        for (let y = 0; y < height; y++) {
          let minX = Infinity;
          let maxX = -1;
          for (let x = 0; x < width; x++) {
            if (ink(x, y)) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
            }
          }
          if (maxX < 0) {
            open = null;
            continue;
          }
          if (!open) bands.push((open = { top: y, bottom: y, minX, maxX }));
          open.bottom = y;
          open.minX = Math.min(open.minX, minX);
          open.maxX = Math.max(open.maxX, maxX);
        }
        return { size: [width, height], bands };
      };
      const a = read(painter.paintCard(without, aspect));
      const canvas: HTMLCanvasElement = painter.paintCard(withNote, aspect);
      const b = read(canvas);
      return { a, b, png: canvas.toDataURL("image/png") };
    },
    { without, withNote, aspect },
  );
}

function savePng(dataUrl: string, name: string): void {
  writeFileSync(path.join(OUT_DIR, `${PORT}-${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
}

test("a stats card takes a note: inspector, stage, fallback line, cap, and it survives player and scope changes", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-B-task6-${step}`;
  await newPlaylistWithClips(page, NAME, { count: 2 });
  const id = await playlistIdNamed(page, NAME);

  // The toolbar's add-card menu: Add stats card reads the official numbers, then holds the card on the stage.
  await page.getByRole("button", { name: "Add a card" }).click();
  await page.getByRole("menuitem", { name: /Add stats card/ }).click();
  const note = page.getByRole("textbox", { name: "Note" });
  await expect(note, "the stats card's inspector opens (Genius' hosted stats were read)").toBeVisible({ timeout: 30_000 });
  await expect(note).toHaveAttribute("placeholder", "Add a note to the card");
  await expect(note).toHaveValue("");
  const stage = page.locator('img[alt*=" · "]').first();
  await expect(stage, "the card is on the stage").toBeVisible();
  const altBefore = (await stage.getAttribute("alt"))!;
  const srcBefore = (await stage.getAttribute("src"))!;
  await expect.poll(async () => (await savedCard(page, id))?.card?.player.name, { timeout: 10_000 }).toBeTruthy();
  const saved0 = (await savedCard(page, id))!;
  expect("note" in saved0.card!, "a new card has no note").toBe(false);
  await shot(page, name("card-no-note"));

  // Manual check (1): type the note; Return in the middle starts a new line.
  await note.click();
  const [first, second] = NOTE.split("\n");
  await note.pressSequentially(first);
  await note.press("Enter");
  await note.pressSequentially(second);
  await expect(note, "Return starts a new line in the note").toHaveValue(NOTE);
  await expect(page.getByText(/characters? left$/), "no counter while more than 20 remain").toHaveCount(0);
  await expect(stage, "the stage's card carries the note at the end of its line, the break as a slash").toHaveAttribute("alt", `${altBefore} · ${NOTE_LINE}`);
  await expect(stage, "the stage repainted").not.toHaveAttribute("src", srcBefore);
  await expect
    .poll(async () => {
      const row = await savedCard(page, id);
      return [row?.card?.note, row?.text_content];
    }, { timeout: 10_000, message: "the note keeps its line break and the fallback line joins it with a slash" })
    .toEqual([NOTE, `${saved0.text_content} · ${NOTE_LINE}`]);
  await shot(page, name("card-note-16x9"));

  // Manual check (1), 16:9 and Vertical, through the app's painter: the card's own lines keep their
  // heights, and the note adds two or three lines under the numbers, inside the frame.
  const saved1 = (await savedCard(page, id))!;
  const withNote = { text: saved1.text_content!, card: saved1.card };
  const without = { text: saved0.text_content!, card: saved0.card };
  for (const [aspect, frame] of [["16:9", [1280, 720]], ["9:16", [1080, 1920]]] as const) {
    const r = await paintBoth(page, without, withNote, aspect);
    expect([...r.a.size, ...r.b.size], `the ${aspect} frame`).toEqual([...frame, ...frame]);
    const n = r.a.bands.length;
    expect(n, `the ${aspect} card without a note has its lines`).toBeGreaterThanOrEqual(4);
    // The name, details and numbers come first, each band as tall as before (±1 px for rounding)…
    r.a.bands.forEach((band, i) => {
      const height = r.b.bands[i].bottom - r.b.bands[i].top;
      expect(Math.abs(height - (band.bottom - band.top)), `the ${aspect} card's line ${i + 1} is unchanged`).toBeLessThanOrEqual(1);
    });
    // …and the note adds two or three lines under the last one, inside the frame.
    const noteBands = r.b.bands.slice(n);
    expect(noteBands.length, `the ${aspect} note wraps to two or three lines under the numbers`).toBeGreaterThanOrEqual(2);
    expect(noteBands.length).toBeLessThanOrEqual(3);
    expect(noteBands[0].top, `the ${aspect} note starts below the numbers`).toBeGreaterThan(r.b.bands[n - 1].bottom);
    expect(Math.min(...noteBands.map((band) => band.minX)), `the ${aspect} note is inside the frame`).toBeGreaterThan(0);
    expect(Math.max(...noteBands.map((band) => band.maxX)), `the ${aspect} note is inside the frame`).toBeLessThan(frame[0] - 1);
    expect(noteBands[noteBands.length - 1].bottom, `the ${aspect} note is inside the frame`).toBeLessThan(frame[1] - 1);
    savePng(r.png, name(`painted-${aspect === "16:9" ? "16x9" : "9x16"}`));
  }

  // A pasted run of newlines collapses to one empty line; a trailing Return is typed but not stored.
  await note.fill("Box out\n\n\n\nearly\n");
  await expect(note).toHaveValue("Box out\n\nearly\n");
  await expect.poll(async () => (await savedCard(page, id))?.card?.note, { timeout: 10_000 }).toBe("Box out\n\nearly");

  // Manual check (3): the counter from 20 left, and typing stops at 140.
  await note.fill("x".repeat(119));
  await expect(page.getByText(/characters? left$/)).toHaveCount(0);
  await note.press("End");
  await note.pressSequentially("y");
  await expect(page.getByText("20 characters left", { exact: true })).toBeVisible();
  await note.pressSequentially("y".repeat(19));
  await expect(page.getByText("1 character left", { exact: true })).toBeVisible();
  await note.pressSequentially("zzzzz");
  await expect(page.getByText("0 characters left", { exact: true })).toBeVisible();
  await expect(note, "typing stops at 140").toHaveValue(`${"x".repeat(119)}${"y".repeat(20)}z`);
  await shot(page, name("cap"));

  // Back to the note, then manual check (2): a new player keeps it.
  await note.fill(NOTE);
  await expect(stage).toHaveAttribute("alt", new RegExp(` · ${NOTE_LINE}$`));
  const player = page.getByRole("button", { name: "Player" });
  const firstPlayer = (await player.innerText()).trim();
  await player.click();
  const other = page.getByRole("menuitemradio").filter({ hasNotText: firstPlayer }).first();
  const otherName = (await other.innerText()).split("\n")[0].trim();
  await other.click();
  await expect(player, "the card shows the new player").toContainText(otherName, { timeout: 30_000 });
  await expect(page.getByLabel("Reading the stats")).toHaveCount(0, { timeout: 30_000 });
  await expect(note, "the note stays with a new player").toHaveValue(NOTE);
  await expect(stage).toHaveAttribute("alt", new RegExp(`^${otherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.* · ${NOTE_LINE}$`));
  await shot(page, name("other-player"));

  // Game: the playlist's clips are from one game, so the Game pop-up has nothing to switch to.
  await expect(page.getByRole("button", { name: "Game", exact: true }), "one game: nothing to switch to").toBeDisabled();

  // Season averages keep the note.
  const season = page.getByRole("radio", { name: "Season", exact: true });
  await season.click();
  await expect(season).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Reading the stats")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Season", exact: true }), "the card shows a season").toBeVisible();
  await expect(note, "the note stays on season averages").toHaveValue(NOTE);
  await expect(stage).toHaveAttribute("alt", new RegExp(` · ${NOTE_LINE}$`));
  await expect
    .poll(async () => (await savedCard(page, id))?.card?.scope, { timeout: 10_000, message: "the season card is saved" })
    .toBe("season");
  await shot(page, name("season"));
  await expect
    .poll(async () => (await savedCard(page, id))?.card?.note, { timeout: 10_000 })
    .toBe(NOTE);
});
