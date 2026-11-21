/**
 * Group E, Task 18: archive a game in the desktop. The Library's row button
 * moves the game to a collapsed "Archived" group with its count, the subtitle
 * drops by one, a toast offers Undo; Show/Hide open and close the group; a
 * search lists matching archived games while the group is collapsed; "Bring
 * back to Library" returns it without a toast. While it is archived, Add
 * clips' Game picker leaves it out, a playlist with its
 * clips still shows them (and its Add clips still offers the game), and
 * "Build a playlist" on the archived game's page starts Add clips on it.
 *
 * The one spec that changes a game it didn't create: it archives the LAST game
 * in the Library (the one other specs are least likely to open) and brings it
 * back in the same test, through the UI, then in `finally` and in afterEach
 * through the app's client if the UI path failed, polling the server until
 * `archived_at` reads null. Creates the playlists `headless-<port> …` and
 * deletes them afterwards.
 */
import type { Locator, Page } from "@playwright/test";
import {
  PORT,
  archiveCreatePlaylist,
  archiveDeletePlaylistsNamed,
  archivePlaylistNames,
  archiveRestoreGame,
  archiveStateOnServer,
  expect,
  libraryGameCount,
  shot,
  test,
} from "../helpers";

const PREFIX = `headless-${PORT} `;
const KEEPS_CLIPS = `${PREFIX}keeps clips`;
const ADD_CLIPS = `${PREFIX}add clips`;
const FROM_ARCHIVED = `${PREFIX}from archived`;

/** The game this spec archived and hasn't seen back on the server yet. */
let archived: { id: string } | null = null;

async function cleanUp(page: Page): Promise<void> {
  if (archived) {
    await archiveRestoreGame(page, archived.id);
    archived = null;
  }
  await archiveDeletePlaylistsNamed(page, PREFIX);
  expect(await archivePlaylistNames(page, PREFIX), `no ${PREFIX}playlists left`).toEqual([]);
}

test.afterEach(async ({ page }) => {
  await cleanUp(page);
});

interface Game {
  id: string;
  title: string;
  homeTeam: string;
  /** As the row and the Game picker print it (formatDate). */
  date: string;
  clips: number;
}

const gameRow = (page: Page, id: string) => page.locator(`a[href="/matches/${id}"]`);
const archivedHeading = (page: Page) => page.getByRole("heading", { level: 2, name: /^Archived\s*\d+$/ });
const archivedSection = (page: Page) => page.locator("section").filter({ has: archivedHeading(page) });
const archivedToggle = (page: Page) => archivedSection(page).getByRole("button", { name: /^(Show|Hide)$/ });
const archivedToast = (page: Page) => page.locator("[data-sonner-toast]").filter({ hasText: "Game archived" });
const sidebarLink = (page: Page, name: "Library" | "Playlists") =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });

/** How many games the Archived group's heading counts (0 when the group isn't there). */
async function archivedCount(page: Page): Promise<number> {
  if ((await archivedHeading(page).count()) === 0) return 0;
  return Number((await archivedHeading(page).innerText()).replace(/\D/g, ""));
}

/** The Library with its games loaded (the subtitle is there once they are). */
async function openLibrary(page: Page, via: "goto" | "sidebar"): Promise<void> {
  if (via === "goto") await page.goto("/matches");
  else await sidebarLink(page, "Library").click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(page.getByText(/^\d+ games$/), "the Library's games are loaded").toBeVisible({ timeout: 30_000 });
}

/** The last game in the Library's main list (the Archived group collapsed). */
async function lastGame(page: Page): Promise<Game> {
  const rows = page.locator('a[href^="/matches/"]');
  await expect(rows.first(), "the test account has games in its Library").toBeVisible();
  const row = rows.last();
  const id = (await row.getAttribute("href"))!.replace("/matches/", "");
  const title = (await row.locator("span").first().innerText()).trim();
  // "Home – Away · date · N clips" (components/match-row.tsx).
  const line = (await row.locator("div.truncate.text-subheadline").innerText()).trim();
  const [teams, date, clips] = line.split(" · ");
  return { id, title, homeTeam: teams.split(" – ")[0].trim(), date: date.trim(), clips: Number(clips.split(" ")[0]) };
}

/** Archives or brings back the game with its row's hover button, and waits for the server to agree. */
async function pressRowButton(page: Page, game: Game, action: "Archive game" | "Bring back to Library"): Promise<void> {
  const row = gameRow(page, game.id);
  await row.hover();
  if (action === "Archive game") archived = { id: game.id };
  await row.getByRole("button", { name: action, exact: true }).click();
  if (action === "Archive game") {
    await expect.poll(() => archiveStateOnServer(page, game.id), { message: "the server has the game archived" }).not.toBeNull();
  } else {
    await expect.poll(() => archiveStateOnServer(page, game.id), { message: "the server has the game back" }).toBeNull();
    archived = null;
  }
}

/** Opens a playlist from the Playlists sidebar and its Add clips sheet; returns the sheet. */
async function openAddClipsOn(page: Page, playlistId: string): Promise<Locator> {
  const row = page.locator(`[data-playlist-id="${playlistId}"]`).first();
  await expect(row, "the spec's playlist is listed").toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add clips", exact: true }) });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
}

const gameList = (page: Page) => page.getByRole("listbox", { name: "Games" });
/** The game's options in the open Game picker (title and date: titles repeat across seasons). */
const pickerOptions = (scope: Locator, game: Game) => scope.getByRole("option").filter({ hasText: game.title }).filter({ hasText: game.date });

async function openPicker(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole("button", { name: "Game", exact: true }).click();
  await expect(gameList(page)).toBeVisible();
  await expect(gameList(page).getByRole("option").first(), "the Game picker lists games").toBeVisible();
  return gameList(page);
}

async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(gameList(page)).toBeHidden();
}

test("Library: archive, Undo, Show and Hide, search, bring back", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-E-task18-${step}`;
  let game: Game | null = null;
  try {
    await openLibrary(page, "goto");
    const total = await libraryGameCount(page);
    const archivedBefore = await archivedCount(page);
    game = await lastGame(page);
    expect(await archiveStateOnServer(page, game.id), "the last game starts in the Library").toBeNull();
    const row = gameRow(page, game.id);

    // Archive: the row leaves the main list for the collapsed Archived group.
    await pressRowButton(page, game, "Archive game");
    await expect(row, "the archived row is out of the main list, and the group is collapsed").toHaveCount(0);
    await expect(page.getByText(/^\d+ games$/)).toHaveText(`${total - 1} games`);
    await expect(archivedHeading(page)).toHaveText(new RegExp(`^Archived\\s*${archivedBefore + 1}$`));
    await expect(archivedToggle(page)).toHaveText("Show");
    await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(archivedToast(page)).toBeVisible();
    await expect(archivedToast(page)).toContainText("Clips from it stay in your playlists.");
    await shot(page, name("archived"));

    // Undo in the toast: the row is back and the count restored.
    await archivedToast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => archiveStateOnServer(page, game!.id), { message: "Undo brought the game back on the server" }).toBeNull();
    archived = null;
    await expect(row).toBeVisible();
    await expect(page.getByText(/^\d+ games$/)).toHaveText(`${total} games`);
    if (archivedBefore === 0) await expect(archivedHeading(page), "no Archived group with nothing archived").toHaveCount(0);
    else await expect(archivedHeading(page)).toHaveText(new RegExp(`^Archived\\s*${archivedBefore}$`));
    await shot(page, name("undone"));

    // Archive again; Show lists it in the Archived group, Hide collapses it.
    await pressRowButton(page, game, "Archive game");
    await expect(row).toHaveCount(0);
    await archivedToggle(page).click();
    await expect(archivedToggle(page)).toHaveText("Hide");
    await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(archivedSection(page).locator(`a[href="/matches/${game.id}"]`), "Show lists the game in the Archived group").toBeVisible();
    await expect(archivedSection(page).getByRole("button", { name: "Bring back to Library" }).first()).toBeAttached();
    await shot(page, name("shown"));
    await archivedToggle(page).click();
    await expect(archivedToggle(page)).toHaveText("Show");
    await expect(row, "Hide collapses the group").toHaveCount(0);

    // A search lists the archived game while the group is collapsed (no Show/Hide while searching).
    const search = page.getByLabel("Search games");
    await search.fill(game.homeTeam);
    await expect(archivedSection(page).locator(`a[href="/matches/${game.id}"]`), `searching "${game.homeTeam}" lists the archived game`).toBeVisible();
    await expect(archivedToggle(page), "no Show/Hide while searching").toHaveCount(0);
    await shot(page, name("search"));
    await search.fill("");
    await expect(row, "clearing the search collapses the group again").toHaveCount(0);

    // Bring back by the row's button: back in the main list, no toast.
    await expect(archivedToast(page), "the archive toast has gone").toHaveCount(0, { timeout: 15_000 });
    await archivedToggle(page).click();
    await pressRowButton(page, game, "Bring back to Library");
    await expect(page.getByText(/^\d+ games$/)).toHaveText(`${total} games`);
    await expect(row).toBeVisible();
    if (archivedBefore === 0) await expect(archivedHeading(page)).toHaveCount(0);
    else await expect(archivedSection(page).locator(`a[href="/matches/${game.id}"]`)).toHaveCount(0);
    // The toast would show as soon as the write returns; give it that moment.
    await page.waitForTimeout(1_000);
    await expect(page.locator("[data-sonner-toast]"), "bringing a game back shows no toast").toHaveCount(0);
    await shot(page, name("back"));
  } finally {
    if (game) await archiveRestoreGame(page, game.id);
    archived = null;
  }
});

test("archived: Add clips and playlists leave it out or keep it as they should", async ({ page, browserName }) => {
  test.setTimeout(180_000);
  const name = (step: string) => `${browserName}-E-task18-${step}`;
  let game: Game | null = null;
  try {
    await archiveDeletePlaylistsNamed(page, PREFIX);
    await openLibrary(page, "goto");
    game = await lastGame(page);
    expect(await archiveStateOnServer(page, game.id), "the last game starts in the Library").toBeNull();
    expect(game.clips, `the last game ("${game.title}") has plays to put in a playlist`).toBeGreaterThan(0);
    const keepsId = await archiveCreatePlaylist(page, KEEPS_CLIPS);
    const addId = await archiveCreatePlaylist(page, ADD_CLIPS);

    // Before archiving: a playlist with two of the game's clips, and how often Add clips lists the game.
    await sidebarLink(page, "Playlists").click();
    let sheet = await openAddClipsOn(page, keepsId);
    let list = await openPicker(page, sheet);
    await page.getByRole("combobox", { name: "Search games or teams" }).fill(game.title);
    await pickerOptions(list, game).first().getByText(game.title, { exact: true }).click();
    await expect(gameList(page)).toBeHidden();
    await expect(sheet.getByRole("button", { name: "Game", exact: true })).toHaveText(game.title);
    const gameRows = sheet.getByRole("grid", { name: "Events" }).locator(`[role=row][data-row-key^="${game.id}:"]`);
    await expect(gameRows.first(), "the game's plays are listed").toBeVisible({ timeout: 30_000 });
    for (const i of [0, 1]) await gameRows.nth(i).getByRole("checkbox", { name: "Select" }).click();
    await sheet.getByRole("button", { name: "Add 2 clips" }).click();
    await closeSheet(page, sheet);
    const editorRows = page.locator("[role=row][data-row-key]");
    await expect(editorRows, "the playlist has the game's two clips").toHaveCount(2);
    const clipTexts = await editorRows.allInnerTexts();

    sheet = await openAddClipsOn(page, addId);
    list = await openPicker(page, sheet);
    const listedBefore = await pickerOptions(list, game).count();
    expect(listedBefore, "Add clips lists the game before it is archived").toBeGreaterThan(0);
    await closePicker(page);
    await closeSheet(page, sheet);

    // Archive it from the Library.
    await openLibrary(page, "sidebar");
    const archivedAt = Date.now();
    await pressRowButton(page, game, "Archive game");
    await expect(gameRow(page, game.id)).toHaveCount(0);

    // The playlist with its clips: they still show, and its Add clips still offers the game.
    await sidebarLink(page, "Playlists").click();
    sheet = await openAddClipsOn(page, keepsId);
    list = await openPicker(page, sheet);
    await expect(pickerOptions(list.getByRole("group", { name: "In this playlist" }), game), "the playlist's own archived game stays in its Add clips").toHaveCount(1);
    await closePicker(page);
    await closeSheet(page, sheet);
    await expect(editorRows, "the archived game's clips still show in the playlist").toHaveCount(2);
    expect(await editorRows.allInnerTexts()).toEqual(clipTexts);
    await shot(page, name("playlist-keeps-clips"));

    // Add clips on another playlist leaves the archived game out.
    sheet = await openAddClipsOn(page, addId);
    list = await openPicker(page, sheet);
    await expect(pickerOptions(list, game), "Add clips leaves the archived game out").toHaveCount(listedBefore - 1);
    await shot(page, name("add-clips-archived"));
    await closePicker(page);
    await closeSheet(page, sheet);

    // "Build a playlist" on the archived game's page starts Add clips on it.
    await openLibrary(page, "sidebar");
    await archivedToggle(page).click();
    await archivedSection(page).locator(`a[href="/matches/${game.id}"]`).click();
    await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
    const details = page.getByRole("radio", { name: "Details" });
    if ((await details.getAttribute("aria-checked")) !== "true") await details.click();
    await page.getByRole("button", { name: "Build a playlist" }).click();
    const nameField = page.locator("input:focus");
    await expect(nameField, "Build a playlist starts a new playlist with its name field").toBeVisible({ timeout: 30_000 });
    await nameField.fill(FROM_ARCHIVED);
    await nameField.press("Enter");
    await expect(page.locator("[data-playlist-id]").filter({ hasText: FROM_ARCHIVED }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Add clips", exact: true }).first().click();
    sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add clips", exact: true }) });
    await expect(sheet.getByRole("button", { name: "Game", exact: true }), "Add clips starts on the archived game").toHaveText(game.title, { timeout: 15_000 });
    await expect(sheet.getByRole("grid", { name: "Events" }).locator(`[role=row][data-row-key^="${game.id}:"]`).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, name("build-from-archived"));
    await closeSheet(page, sheet);

    // Bring it back; Add clips lists it again.
    await openLibrary(page, "sidebar");
    await archivedToggle(page).click();
    await pressRowButton(page, game, "Bring back to Library");
    test.info().annotations.push({ type: "archived window", description: `${((Date.now() - archivedAt) / 1000).toFixed(1)} s` });
    await expect(gameRow(page, game.id)).toBeVisible();
    await sidebarLink(page, "Playlists").click();
    sheet = await openAddClipsOn(page, addId);
    list = await openPicker(page, sheet);
    await expect(pickerOptions(list, game), "Add clips lists the game again once it is back").toHaveCount(listedBefore);
    await shot(page, name("add-clips-back"));
    await closePicker(page);
    await closeSheet(page, sheet);
  } finally {
    if (game) await archiveRestoreGame(page, game.id);
    archived = null;
  }
});
