/**
 * Group A, Task 1: double-click a playlist (or folder) in the sidebar to
 * rename it, the name selected, one commit per rename, the new name shown at
 * once, and an unchanged name writes nothing. Also the New Playlist / New
 * folder fields and the editor header's rename field start selected.
 * Creates `headless-<port>-<slot> …` rows and deletes them, pass or fail.
 */
import type { Locator, Page, Request, Route } from "@playwright/test";
import {
  listNewPlaylist,
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
const PLAYLIST = `${PREFIX}rename me`;
const PLAYLIST_RENAMED = `${PREFIX}renamed`;
const FOLDER = `${PREFIX}folder`;
const FOLDER_RENAMED = `${PREFIX}folder renamed`;

/** Every write (POST/PATCH) the page sends to a sidebar table. */
function recordWrites(page: Page): { table: string; method: string }[] {
  const writes: { table: string; method: string }[] = [];
  page.on("request", (request: Request) => {
    const match = /\/rest\/v1\/(playlists|playlist_folders)\?/.exec(request.url());
    if (match && (request.method() === "PATCH" || request.method() === "POST")) writes.push({ table: match[1], method: request.method() });
  });
  return writes;
}

/** Holds the next PATCH to `table` until `release()`, so a spec can look at the screen while the write is in flight. */
async function holdNextPatch(page: Page, table: string): Promise<{ held: Promise<void>; release: () => Promise<void> }> {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => (markHeld = resolve));
  const pattern = new RegExp(`/rest/v1/${table}\\?`);
  let markPassed!: () => void;
  const passed = new Promise<void>((resolve) => (markPassed = resolve));
  // Every request to the table passes through; the first PATCH waits at the gate. Release opens the gate,
  // waits until that PATCH has gone on, then drops the route (a stray GET can't stand in for the PATCH).
  const handler = async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    markHeld();
    await gate;
    await route.continue();
    markPassed();
  };
  await page.route(pattern, handler);
  return { held, release: async () => { open(); await passed; await page.unroute(pattern, handler); } };
}

/** The whole value is selected in the focused field. */
async function expectWholeNameSelected(page: Page, name: string, what: string) {
  await expect.poll(() => focusedField(page), { message: `${what}: the field is focused and holds the name` }).toMatchObject({ value: name });
  const field = await focusedField(page);
  expect(field, `${what}: the whole name is selected`).toEqual({ value: name, start: 0, end: name.length });
}

test.afterEach(async ({ page }) => {
  await deleteSidebarRowsNamed(page, PREFIX);
});

test("A task 1: double-click renames a playlist and a folder, name selected, written once", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-A-task1-${step}`;
  const writes = recordWrites(page);
  // Leftovers of an earlier, killed run, cleared before the list loads.
  await deleteSidebarRowsNamed(page, PREFIX);
  await openPlaylistsSidebar(page);

  // ── New Playlist: the field opens with "New Playlist" selected, so typing replaces it.
  await listNewPlaylist(page).click();
  await expectWholeNameSelected(page, "New Playlist", "New Playlist");
  await page.keyboard.type(PLAYLIST);
  await shot(page, name("new-playlist-typed"));
  await page.keyboard.press("Enter");
  const row = playlistRow(page, PLAYLIST);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => writes.filter((w) => w.table === "playlists" && w.method === "POST").length, { message: "the playlist is created once" }).toBe(1);

  // ── Double-click the sidebar name: the field opens with the whole name selected.
  await row.getByText(PLAYLIST, { exact: true }).dblclick();
  await expectWholeNameSelected(page, PLAYLIST, "sidebar playlist double-click");
  await shot(page, name("playlist-dblclick-selected"));

  // ── Type a new name, Enter: the row shows it at once, while the write is still in flight.
  const gate = await holdNextPatch(page, "playlists");
  await page.keyboard.type(PLAYLIST_RENAMED);
  await page.keyboard.press("Enter");
  await gate.held;
  await expect(playlistRow(page, PLAYLIST_RENAMED), "the new name shows before the write returns").toBeVisible();
  await expect(page.locator("input:focus"), "the field closed on Enter").toHaveCount(0);
  await expect(toastWith(page, "Playlist renamed"), "no toast until the write succeeds").toHaveCount(0);
  await shot(page, name("playlist-renamed-in-flight"));
  await gate.release();
  await expect(toastWith(page, "Playlist renamed")).toBeVisible();
  expect(writes.filter((w) => w.table === "playlists" && w.method === "PATCH"), "one write per rename").toHaveLength(1);
  await expect.poll(async () => (await sidebarRowsNamed(page, "playlists", PREFIX)).map((r) => r.name)).toEqual([PLAYLIST_RENAMED]);

  // ── Enter with the same name writes nothing and shows no toast.
  await expect(toastWith(page, "Playlist renamed")).toHaveCount(0, { timeout: 10_000 });
  const patchesBefore = writes.length;
  await playlistRow(page, PLAYLIST_RENAMED).getByText(PLAYLIST_RENAMED, { exact: true }).dblclick();
  await expectWholeNameSelected(page, PLAYLIST_RENAMED, "second double-click");
  await page.keyboard.press("Enter");
  await expect(page.locator("input:focus")).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(writes.slice(patchesBefore), "an unchanged name writes nothing").toEqual([]);
  await expect(toastWith(page, "Playlist renamed"), "an unchanged name shows no toast").toHaveCount(0);
  await shot(page, name("playlist-unchanged"));

  // ── The editor header's name: click it, the name is selected (the created playlist is open).
  const header = page.locator("button[title='Rename playlist']");
  await expect(header).toHaveText(PLAYLIST_RENAMED);
  await header.click();
  await expect(page.getByRole("textbox", { name: "Playlist name" })).toBeFocused();
  await expectWholeNameSelected(page, PLAYLIST_RENAMED, "editor header");
  await shot(page, name("header-selected"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_000);
  expect(writes.slice(patchesBefore), "the header's unchanged name writes nothing either").toEqual([]);

  // ── New folder: "New Folder" selected; Enter creates it once, no error toast.
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await expectWholeNameSelected(page, "New Folder", "New folder");
  await page.keyboard.type(FOLDER);
  await page.keyboard.press("Enter");
  const folder = folderRow(page, FOLDER);
  await expect(folder).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  expect(writes.filter((w) => w.table === "playlist_folders"), "a new folder named with Enter is saved once, and not updated under its temp id").toEqual([
    { table: "playlist_folders", method: "POST" },
  ]);
  await expect(page.locator("[data-sonner-toast][data-type='error']"), "no error toast").toHaveCount(0);
  await shot(page, name("folder-created"));

  // ── Double-click the folder: whole name selected; rename shows at once; one write.
  await folder.getByText(FOLDER, { exact: true }).dblclick();
  await expectWholeNameSelected(page, FOLDER, "sidebar folder double-click");
  await shot(page, name("folder-dblclick-selected"));
  const folderGate = await holdNextPatch(page, "playlist_folders");
  await page.keyboard.type(FOLDER_RENAMED);
  await page.keyboard.press("Enter");
  await folderGate.held;
  await expect(folderRow(page, FOLDER_RENAMED), "the folder's new name shows before the write returns").toBeVisible();
  await folderGate.release();
  await expect(toastWith(page, "Folder renamed")).toBeVisible();
  expect(writes.filter((w) => w.table === "playlist_folders" && w.method === "PATCH"), "one write per folder rename").toHaveLength(1);
  await expect.poll(async () => (await sidebarRowsNamed(page, "playlist_folders", PREFIX)).map((r) => r.name)).toEqual([FOLDER_RENAMED]);
  await shot(page, name("folder-renamed"));

  // ── Unchanged folder name: nothing written, no toast.
  await expect(toastWith(page, "Folder renamed")).toHaveCount(0, { timeout: 10_000 });
  const folderWritesBefore = writes.length;
  await folderRow(page, FOLDER_RENAMED).getByText(FOLDER_RENAMED, { exact: true }).dblclick();
  await expectWholeNameSelected(page, FOLDER_RENAMED, "second folder double-click");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_500);
  expect(writes.slice(folderWritesBefore), "an unchanged folder name writes nothing").toEqual([]);
  await expect(toastWith(page, "Folder renamed")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast][data-type='error']"), "no error toast").toHaveCount(0);
});

/**
 * Finding A-1 (fixed): a rename or a New… field opened from a menu used to open
 * unfocused, because the menu hands focus back to its trigger as it closes,
 * after the field has mounted. Every menu path now lands with the field
 * focused and the whole name selected (the folder "…" menu's Rename always did).
 */
test("A task 1 (finding A-1): a rename or new-item field opened from a menu is focused with the name selected", async ({ page, browserName }) => {
  await deleteSidebarRowsNamed(page, PREFIX);
  await openPlaylistsSidebar(page);
  const playlistId = await (await createInSidebar(page, "playlist", PLAYLIST)).getAttribute("data-playlist-id");
  const folderId = await (await createInSidebar(page, "folder", FOLDER)).getAttribute("data-folder-id");
  const playlist = page.locator(`[data-playlist-id="${playlistId}"]`);
  const folder = page.locator(`[data-folder-id="${folderId}"]`);
  // The empty strip below the sections; its right-click menu creates at the root.
  const strip = page.locator("div.h-12[data-state]").last();

  const paths: { what: string; target: Locator; via: "right-click" | "actions"; item: string; value: string }[] = [
    { what: "playlist right-click Rename", target: playlist, via: "right-click", item: "Rename", value: PLAYLIST },
    { what: "playlist … menu Rename", target: playlist, via: "actions", item: "Rename", value: PLAYLIST },
    { what: "folder right-click Rename", target: folder, via: "right-click", item: "Rename", value: FOLDER },
    { what: "folder … menu Rename", target: folder, via: "actions", item: "Rename", value: FOLDER },
    { what: "folder right-click New Subfolder", target: folder, via: "right-click", item: "New Subfolder", value: "New Folder" },
    { what: "folder right-click New Playlist", target: folder, via: "right-click", item: "New Playlist", value: "New Playlist" },
    { what: "folder … menu New Subfolder", target: folder, via: "actions", item: "New Subfolder", value: "New Folder" },
    { what: "folder … menu New Playlist", target: folder, via: "actions", item: "New Playlist", value: "New Playlist" },
    { what: "bottom strip right-click New Folder", target: strip, via: "right-click", item: "New Folder", value: "New Folder" },
    { what: "bottom strip right-click New Playlist", target: strip, via: "right-click", item: "New Playlist", value: "New Playlist" },
  ];
  for (const [i, { what, target, via, item, value }] of paths.entries()) {
    await test.step(what, async () => {
      if (via === "right-click") {
        await target.click({ button: "right" });
      } else {
        await target.hover();
        await target.getByRole("button", { name: /^(Playlist|Folder) actions$/ }).click();
      }
      await page.getByRole("menuitem", { name: item, exact: true }).click();
      await expectWholeNameSelected(page, value, what);
      if (i === 0) await shot(page, `${browserName}-A-task1-finding-menu-rename-focused`);
      // Escape closes the field (a new item's temp row goes away) and leaves the name as it was.
      await page.keyboard.press("Escape");
      await expect(page.locator("input:focus"), `${what}: Escape closed the field`).toHaveCount(0);
    });
  }
});
