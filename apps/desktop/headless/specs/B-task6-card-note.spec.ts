/**
 * Task 6: a note on a stats card. The inspector's Note field (Return does
 * nothing, a pasted newline becomes a space, 140 at most, "N characters left"
 * from 20), the note drawn under the numbers on the stage (the stage is an
 * <img> painted by the app's card painter; its alt is the card's fallback
 * line), the fallback line saved to text_content, the Vertical (9:16) frame
 * through the same painter, and the note surviving a change of player and of
 * Game/Season. Creates "headless-<port> card" and deletes it. The numbers come
 * from Genius' hosted pages through the browser's fetch.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { deletePlaylistsNamed, expect, newPlaylistWithClips, OUT_DIR, PORT, selectRows, shot, test } from "../helpers";

const NAME = `headless-${PORT} card`;
/** 106 characters: two or three lines under the numbers (shared card-layout tests). */
const NOTE = "Great closeouts all game and smart help from the weak side, keep talking on every switch and box out early";

test.beforeEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

test.afterEach(async ({ page }) => {
  await deletePlaylistsNamed(page, NAME);
});

/** The open playlist's id, from its row in the playlist list. */
async function playlistId(page: Page): Promise<string> {
  const id = await page.locator("[data-playlist-id]").filter({ hasText: NAME }).first().getAttribute("data-playlist-id");
  expect(id).toBeTruthy();
  return id!;
}

/** The card's saved row: its spec and its fallback line. */
async function savedCard(page: Page, id: string) {
  const rows = await selectRows<{ card: { note?: string; player: { name: string }; scope: string } | null; text_content: string | null }>(
    page, "playlist_clips", "card, text_content", { playlist_id: id, item_type: "text" },
  );
  return rows[0] ?? null;
}

/** The card painted at a size by the app's painter (export and send to phone use it), as a data URL. */
async function paint(page: Page, source: { text: string; card: unknown }, aspect: "16:9" | "9:16"): Promise<string> {
  return page.evaluate(
    async ({ source, aspect }) => {
      const modulePath = "/src/lib/card-painter.ts";
      const painter = await import(/* @vite-ignore */ modulePath);
      await painter.loadCardFonts();
      return painter.paintCard(source, aspect).toDataURL("image/png");
    },
    { source, aspect },
  );
}

function savePng(dataUrl: string, name: string): void {
  writeFileSync(path.join(OUT_DIR, `${PORT}-${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
}

test("a stats card takes a note: inspector, stage, fallback line, cap, and it survives player and scope changes", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-B-task6-${step}`;
  await newPlaylistWithClips(page, NAME, { count: 2 });
  const id = await playlistId(page);

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

  // Manual check (1): type the note; Return in the middle adds nothing.
  await note.click();
  const half = NOTE.indexOf(" smart");
  await note.pressSequentially(NOTE.slice(0, half));
  await note.press("Enter");
  await note.pressSequentially(NOTE.slice(half));
  await expect(note, "Return does nothing in the note").toHaveValue(NOTE);
  await expect(page.getByText(/characters? left$/), "no counter while more than 20 remain").toHaveCount(0);
  await expect(stage, "the stage's card carries the note at the end of its line").toHaveAttribute("alt", `${altBefore} · ${NOTE}`);
  await expect(stage, "the stage repainted").not.toHaveAttribute("src", srcBefore);
  await expect
    .poll(async () => {
      const row = await savedCard(page, id);
      return [row?.card?.note, row?.text_content];
    }, { timeout: 10_000, message: "the note and the fallback line are saved" })
    .toEqual([NOTE, `${saved0.text_content} · ${NOTE}`]);
  await shot(page, name("card-note-16x9"));

  // The 16:9 stage and the Vertical frame through the app's painter: the note changes both.
  const saved1 = (await savedCard(page, id))!;
  const withNote = { text: saved1.text_content!, card: saved1.card };
  const without = { text: saved0.text_content!, card: saved0.card };
  for (const aspect of ["16:9", "9:16"] as const) {
    const a = await paint(page, without, aspect);
    const b = await paint(page, withNote, aspect);
    expect(b, `the ${aspect} card draws the note`).not.toBe(a);
    savePng(b, name(`painted-${aspect === "16:9" ? "16x9" : "9x16"}`));
  }

  // A pasted newline becomes a space.
  await note.fill("Box out\nearly");
  await expect(note).toHaveValue("Box out early");

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
  await expect(stage).toHaveAttribute("alt", new RegExp(` · ${NOTE}$`));
  const player = page.getByRole("button", { name: "Player" });
  const firstPlayer = (await player.innerText()).trim();
  await player.click();
  const other = page.getByRole("menuitemradio").filter({ hasNotText: firstPlayer }).first();
  const otherName = (await other.innerText()).split("\n")[0].trim();
  await other.click();
  await expect(player, "the card shows the new player").toContainText(otherName, { timeout: 30_000 });
  await expect(page.getByLabel("Reading the stats")).toHaveCount(0, { timeout: 30_000 });
  await expect(note, "the note stays with a new player").toHaveValue(NOTE);
  await expect(stage).toHaveAttribute("alt", new RegExp(`^${otherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.* · ${NOTE}$`));
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
  await expect(stage).toHaveAttribute("alt", new RegExp(` · ${NOTE}$`));
  await expect
    .poll(async () => (await savedCard(page, id))?.card?.scope, { timeout: 10_000, message: "the season card is saved" })
    .toBe("season");
  await shot(page, name("season"));
  await expect
    .poll(async () => (await savedCard(page, id))?.card?.note, { timeout: 10_000 })
    .toBe(NOTE);
});
