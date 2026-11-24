/**
 * Group A, Task 3: ⌘Z / ⇧⌘Z take back a sidebar rename or move. A playlist
 * rename undone and redone by key, undone by the toast's Undo; a folder rename
 * undone; a playlist moved into a folder and a folder moved into a folder
 * (both through their context menus), each undone; a rename of a playlist
 * deleted since undoes nothing and says so; ⌘Z in the rename field is the
 * field's own. Every step is checked on screen and in what's stored.
 *
 * Keys: the page's handler (pages/playlists.tsx, useHotkeys "editor") takes
 * ⌘ or Ctrl with Z, so on macOS both projects press Meta+z / Meta+Shift+z.
 * Creates `headless-<port>-<slot> …` rows and deletes them, pass or fail.
 */
import type { Locator, Page } from "@playwright/test";
import {
  createInSidebar,
  deleteSidebarRowsNamed,
  expect,
  focusedField,
  folderRow,
  openPlaylistsSidebar,
  sidebarRowsNamed,
  playlistRow,
  OWNER,
  shot,
  test,
  toastWith,
} from "../helpers";

const PREFIX = `${OWNER} `;
const PL = `${PREFIX}undo`;
const PL_RENAMED = `${PREFIX}undo renamed`;
const PL_TOAST = `${PREFIX}undo by toast`;
const PL_DOOMED = `${PREFIX}undo doomed`;
const FOLDER = `${PREFIX}undo folder`;
const FOLDER_RENAMED = `${PREFIX}undo folder renamed`;
const FOLDER_2 = `${PREFIX}undo folder two`;

const UNDO = "Meta+z";
const REDO = "Meta+Shift+z";

/** What's stored for one of the spec's rows, by exact name (undefined when there is none). */
async function stored(page: Page, table: "playlists" | "playlist_folders", name: string) {
  return (await sidebarRowsNamed(page, table, PREFIX)).find((r) => r.name === name);
}

/** Renames a sidebar row by double-click and Enter, and waits for the rename toast (the edit is recorded once it shows). */
async function rename(page: Page, row: Locator, from: string, to: string, toast: string) {
  await row.getByText(from, { exact: true }).dblclick();
  await expect.poll(() => focusedField(page)).toMatchObject({ value: from });
  await page.keyboard.type(to);
  await page.keyboard.press("Enter");
  await expect(toastWith(page, toast)).toBeVisible();
}

/** The playlist's row is drawn inside the folder's subtree. */
function rowInFolder(page: Page, playlistName: string, folderName: string) {
  return page.evaluate(([pl, folder]) => {
    const header = [...document.querySelectorAll<HTMLElement>("[data-folder-id]")].find((r) => r.innerText.split("\n")[0] === folder);
    const row = [...document.querySelectorAll<HTMLElement>("[data-playlist-id]")].find((r) => r.innerText.split("\n")[0] === pl);
    return !!header && !!row && header.parentElement!.contains(row);
  }, [playlistName, folderName] as const);
}

test.afterEach(async ({ page }) => {
  await deleteSidebarRowsNamed(page, PREFIX);
});

test("A task 3: ⌘Z / ⇧⌘Z and the toast's Undo take back sidebar renames and moves", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-A-task3-${step}`;
  // Leftovers of an earlier, killed run, cleared before the list loads.
  await deleteSidebarRowsNamed(page, PREFIX);
  await openPlaylistsSidebar(page);

  const folder = await createInSidebar(page, "folder", FOLDER);
  const folderId = await folder.getAttribute("data-folder-id");
  // The New Playlist button inherits the selected playlist's folder; nothing is selected yet, so it lands at the top level.
  const playlistId = await (await createInSidebar(page, "playlist", PL)).getAttribute("data-playlist-id");
  const playlist = page.locator(`[data-playlist-id="${playlistId}"]`).first();

  // ── Rename, then ⌘Z: the old name returns, "Undo: Rename playlist" (no leftover Undo button); ⇧⌘Z: the new name.
  await rename(page, playlist, PL, PL_RENAMED, "Playlist renamed");
  await page.keyboard.press(UNDO);
  await expect(playlistRow(page, PL), "⌘Z: the old name is back").toBeVisible();
  const undoToast = toastWith(page, "Undo: Rename playlist");
  await expect(undoToast).toBeVisible();
  await expect(undoToast.getByRole("button"), "the step toast carries no leftover Undo").toHaveCount(0);
  await expect.poll(async () => (await stored(page, "playlists", PL))?.id, { message: "⌘Z saved the old name" }).toBe(playlistId);
  await shot(page, name("cmdz-rename"));
  await page.keyboard.press(REDO);
  await expect(playlistRow(page, PL_RENAMED), "⇧⌘Z: the new name is back").toBeVisible();
  await expect(toastWith(page, "Redo: Rename playlist")).toBeVisible();
  await expect.poll(async () => (await stored(page, "playlists", PL_RENAMED))?.id, { message: "⇧⌘Z saved the new name" }).toBe(playlistId);
  await shot(page, name("shift-cmdz-redo"));

  // ── ⌘Z while the rename field is focused is the field's own, not the page's.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  await playlist.getByText(PL_RENAMED, { exact: true }).dblclick();
  await expect.poll(() => focusedField(page)).toMatchObject({ value: PL_RENAMED });
  await page.keyboard.press("End");
  await page.keyboard.type(" x");
  await page.keyboard.press(UNDO);
  await expect.poll(() => focusedField(page), { message: "the field keeps focus, and its own undo takes back the typing" }).toMatchObject({ value: PL_RENAMED });
  await page.waitForTimeout(800);
  await expect(page.locator("[data-sonner-toast]"), "⌘Z in the field doesn't step the page's history (no toast at all)").toHaveCount(0);
  await page.locator("input:focus").fill(PL_RENAMED);
  await page.keyboard.press("Enter");
  await expect(playlistRow(page, PL_RENAMED), "the name is untouched").toBeVisible();
  expect((await stored(page, "playlists", PL_RENAMED))?.id, "and so is what's stored").toBe(playlistId);

  // ── Rename, then the toast's Undo: the old name is back.
  await rename(page, playlist, PL_RENAMED, PL_TOAST, "Playlist renamed");
  await shot(page, name("rename-toast"));
  await toastWith(page, "Playlist renamed").getByRole("button", { name: "Undo" }).click();
  await expect(playlistRow(page, PL_RENAMED), "the toast's Undo: the old name is back").toBeVisible();
  await expect(toastWith(page, "Undo: Rename playlist")).toBeVisible();
  await expect.poll(async () => (await stored(page, "playlists", PL_RENAMED))?.id, { message: "the toast's Undo saved the old name" }).toBe(playlistId);

  // ── Rename a folder, ⌘Z.
  await rename(page, folder, FOLDER, FOLDER_RENAMED, "Folder renamed");
  await page.keyboard.press(UNDO);
  await expect(folderRow(page, FOLDER), "⌘Z: the folder's old name is back").toBeVisible();
  await expect(toastWith(page, "Undo: Rename folder")).toBeVisible();
  await expect.poll(async () => (await stored(page, "playlist_folders", FOLDER))?.id, { message: "⌘Z saved the folder's old name" }).toBe(folderId);
  await shot(page, name("cmdz-folder-rename"));

  // ── Move the playlist into the folder (its right-click "Move to folder"), ⌘Z: back at the top level.
  await playlist.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to folder" }).hover();
  await page.getByRole("menuitem", { name: FOLDER, exact: true }).click();
  await expect.poll(async () => (await stored(page, "playlists", PL_RENAMED))?.folder_id, { message: "the playlist is stored in the folder" }).toBe(folderId);
  await expect.poll(() => rowInFolder(page, PL_RENAMED, FOLDER), { message: "the row is drawn in the folder" }).toBe(true);
  await shot(page, name("moved-into-folder"));
  await page.keyboard.press(UNDO);
  await expect(toastWith(page, "Undo: Move playlist")).toBeVisible();
  await expect.poll(() => rowInFolder(page, PL_RENAMED, FOLDER), { message: "⌘Z: the row is back at the top level" }).toBe(false);
  await expect(playlistRow(page, PL_RENAMED)).toBeVisible();
  await expect
    .poll(async () => {
      const row = await stored(page, "playlists", PL_RENAMED);
      return row && { id: row.id, folder: row.folder_id ?? null };
    }, { message: "⌘Z stored the top level (the row still exists)" })
    .toEqual({ id: playlistId, folder: null });
  await shot(page, name("cmdz-move-playlist"));

  // ── Move a second folder into the first (its right-click "Move to"), ⌘Z: back at the top level.
  const folder2 = await createInSidebar(page, "folder", FOLDER_2);
  const folder2Id = await folder2.getAttribute("data-folder-id");
  await folder2.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to", exact: true }).hover();
  await page.getByRole("menuitem", { name: FOLDER, exact: true }).click();
  await expect.poll(async () => (await stored(page, "playlist_folders", FOLDER_2))?.parent_id, { message: "the folder is stored inside the first" }).toBe(folderId);
  await page.keyboard.press(UNDO);
  await expect(toastWith(page, "Undo: Move folder")).toBeVisible();
  await expect
    .poll(async () => {
      const row = await stored(page, "playlist_folders", FOLDER_2);
      return row && { id: row.id, parent: row.parent_id ?? null };
    }, { message: "⌘Z stored the folder back at the top level (the row still exists)" })
    .toEqual({ id: folder2Id, parent: null });

  // ── Rename, delete the playlist, ⌘Z: nothing is undone, and the toast says why.
  await rename(page, playlist, PL_RENAMED, PL_DOOMED, "Playlist renamed");
  await playlistRow(page, PL_DOOMED).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Delete "${PL_DOOMED}"?`);
  await dialog.getByRole("button", { name: "Delete playlist" }).click();
  await expect(dialog).toBeHidden();
  await expect(playlistRow(page, PL_DOOMED)).toHaveCount(0);
  await expect.poll(async () => await stored(page, "playlists", PL_DOOMED), { message: "the playlist is deleted" }).toBeUndefined();
  await page.keyboard.press(UNDO);
  await expect(toastWith(page, "The playlist was deleted, so nothing was undone"), "⌘Z on a deleted playlist's rename").toBeVisible();
  await expect(toastWith(page, "The playlist was deleted, so nothing was undone").getByRole("button"), "no leftover Undo").toHaveCount(0);
  await shot(page, name("cmdz-deleted"));
  expect(await stored(page, "playlists", PL_RENAMED), "nothing came back").toBeUndefined();
});
