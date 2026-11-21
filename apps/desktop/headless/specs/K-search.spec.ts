/**
 * The search over a space (docs/search.md): the panel the sidebar's Search and
 * ⌘K / Ctrl+K open, what it offers before and while one types, and where a
 * choice goes. Creates playlists named `headless-<port> search …` and deletes
 * them; everything else is read.
 *
 * The native menu's ⌘K can't fire here (the menu is mocked): the Mac runs go
 * through the sidebar, and the keyboard is driven as the Windows build reads it.
 */
import type { Locator, Page } from "@playwright/test";
import {
  createPlaylist,
  deleteOwnRowsNamed,
  expect,
  goViaSidebar,
  openAddClips,
  openLibraryGame,
  openSampleGame,
  owned,
  recordAnalytics,
  shot,
  showGameView,
  test,
  toastWith,
  videoTime,
  waitForQuiet,
  withAppModule,
} from "../helpers";

const PREFIX = owned("search");
const ALPHA = `${PREFIX} alpha`;
const BETA = `${PREFIX} beta`;
const GAMMA = `${PREFIX} gamma`;
const REPORT = `${PREFIX} report`;

const searchButton = (page: Page) => page.locator("aside").getByRole("button", { name: "Search", exact: true });
const panel = (page: Page) => page.getByRole("dialog", { name: "Search", exact: true });
const field = (page: Page) => panel(page).getByRole("combobox");
const options = (page: Page) => panel(page).getByRole("option");
const group = (page: Page, name: string) => panel(page).getByRole("group", { name, exact: true });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const gameTabs = (page: Page) => page.getByRole("navigation", { name: "Open games" }).locator("button[data-open-game]");
const viewRadio = (page: Page, name: "Clips" | "Report") => page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name, exact: true });

/** The select of each read only the search makes: its index of playlists, games and report drafts. */
const INDEX_SELECTS = [
  "id,name,folder_id,created_at",
  "id,title,game_date,home_team,away_team,created_at,archived_at",
  "playlist_id,updated_at,title:content->>title",
];
const isRest = (url: string) => url.includes(".supabase.co/rest/v1/");
const selectOf = (url: string) => new URL(url).searchParams.get("select") ?? "";

/** Lowercase without accents, as someone types a Swedish name on any keyboard. */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function openSearch(page: Page): Promise<void> {
  await searchButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}

/** Moves to the option with the keys and presses Enter. */
async function chooseWithKeys(page: Page, option: Locator): Promise<void> {
  await expect(option).toBeVisible();
  const id = await option.getAttribute("id");
  const at = await options(page).evaluateAll((all, id) => all.findIndex((o) => o.id === id), id);
  expect(at, "the option is in the list").toBeGreaterThanOrEqual(0);
  for (let i = 0; i < at; i++) await page.keyboard.press("ArrowDown");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
}

/** Two of the Library's games whose titles no other listed game has, without opening them. */
async function twoGames(page: Page): Promise<{ id: string; title: string }[]> {
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  const rows = page.locator('a[href^="/matches/"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const all = await rows.evaluateAll((as) =>
    as.map((a) => ({ id: a.getAttribute("href")!.replace("/matches/", ""), title: (a.querySelector("span")?.textContent ?? "").trim() })),
  );
  const unique = all.filter((g) => g.title && all.filter((o) => o.title === g.title).length === 1);
  expect(unique.length, "the test account has two games with titles of their own").toBeGreaterThanOrEqual(2);
  return unique.slice(0, 2);
}

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, "playlists", PREFIX);
});

test("Search in the sidebar opens on what was opened last, and Esc gives the focus back", async ({ page, browserName }) => {
  const tracked = await recordAnalytics(page);
  const alphaId = await createPlaylist(page, ALPHA);
  const [game] = await twoGames(page);
  await page.locator(`a[href="/matches/${game.id}"]`).click();
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
  await goViaSidebar(page, "Playlists");
  await page.locator(`[data-playlist-id="${alphaId}"]`).first().click();
  await expect(heading(page)).toHaveText(ALPHA);

  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  // With the keyboard, so the button holds the focus in WebKit too (a click doesn't focus a button there).
  await searchButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute("placeholder", "Search playlists, reports and games");
  const recent = group(page, "Recent").getByRole("option");
  // The game is still open (the sidebar's Open games): open games come first, marked Open, then the rest by
  // when they were opened.
  await expect(recent.nth(0), "the open game comes first").toContainText(game.title);
  await expect(recent.nth(0).getByText("Open", { exact: true })).toBeVisible();
  await expect(recent.nth(1), "then the playlist opened last").toContainText(ALPHA);
  await expect(recent.nth(0)).toHaveAttribute("aria-selected", "true");
  await shot(page, `${browserName}-K-search-recent`);

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(searchButton(page), "the focus is back where it was").toBeFocused();
  const opened = (await tracked()).filter((e) => e.event === "search_opened");
  expect(opened.map((e) => e.properties?.via)).toEqual(["sidebar"]);
});

test("typing finds games and playlists by name in the sidebar's order, and never asks the server", async ({ page, browserName }) => {
  await createPlaylist(page, ALPHA);
  await createPlaylist(page, BETA);
  const reads: string[] = [];
  const sizes: Promise<number>[] = [];
  page.on("request", (r) => {
    if (isRest(r.url())) reads.push(r.url());
  });
  page.on("response", (r) => {
    if (isRest(r.url()) && INDEX_SELECTS.includes(selectOf(r.url()))) sizes.push(r.body().then((b) => b.length, () => 0));
  });
  const [game] = await twoGames(page);
  await waitForQuiet(page);
  expect(reads.filter((u) => INDEX_SELECTS.includes(selectOf(u))), "nothing is read for the search before it opens").toEqual([]);

  const before = reads.length;
  await openSearch(page);
  await expect(options(page).first(), "the panel offers something before a query").toBeVisible({ timeout: 15_000 });
  await waitForQuiet(page);
  const forIndex = reads.slice(before);
  // Five for the space, and the team catalogue, read once a session (lib/my-team.tsx teamCatalog).
  expect(forIndex.length, `the first open reads the index in at most six requests (${forIndex.map((u) => new URL(u).pathname).join(", ")})`).toBeLessThanOrEqual(6);
  for (const select of INDEX_SELECTS) expect(forIndex.map(selectOf), "the index is read with its own light selects").toContain(select);
  const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
  console.log(`K-search (${browserName}): the index came in ${forIndex.length} reads; playlists, games and drafts weigh ${bytes} bytes`);

  // A team's name, typed without its accents.
  const typed = reads.length;
  const word = plain(game.title).split(/[^a-z0-9]+/).find((w) => w.length >= 4) ?? plain(game.title);
  await field(page).pressSequentially(word);
  await expect(group(page, "Games").getByRole("option").filter({ hasText: game.title }).first(), `"${word}" finds ${game.title}`).toBeVisible();
  const order = await panel(page).getByRole("group").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
  expect(order, "the groups come in the sidebar's order").toEqual(["Playlists", "Reports", "Games", "Teams"].filter((g) => order.includes(g)));

  await field(page).fill("");
  await field(page).pressSequentially(PREFIX);
  const lists = group(page, "Playlists").getByRole("option");
  await expect(lists.filter({ hasText: ALPHA })).toHaveCount(1);
  await expect(lists.filter({ hasText: BETA })).toHaveCount(1);
  await shot(page, `${browserName}-K-search-results`);

  await field(page).fill("");
  await field(page).pressSequentially("zzqqxxzz");
  await expect(options(page)).toHaveCount(0);
  await expect(panel(page).getByText("No results for “zzqqxxzz”")).toBeVisible();
  expect(reads.length - typed, "typing reads nothing").toBe(0);
});

test("Enter opens a playlist from Library, and another one in place on the Playlists page", async ({ page }) => {
  const tracked = await recordAnalytics(page);
  await createPlaylist(page, ALPHA);
  await createPlaylist(page, BETA);
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });

  await openSearch(page);
  await field(page).pressSequentially(ALPHA);
  await chooseWithKeys(page, group(page, "Playlists").getByRole("option").filter({ hasText: ALPHA }));
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(heading(page)).toHaveText(ALPHA, { timeout: 30_000 });
  await expect(panel(page)).toBeHidden();

  // Already on the page: the other playlist opens without leaving it.
  await openSearch(page);
  await field(page).pressSequentially(BETA);
  await chooseWithKeys(page, group(page, "Playlists").getByRole("option").filter({ hasText: BETA }));
  await expect(heading(page)).toHaveText(BETA);
  await expect(page).toHaveURL(/\/playlists$/);

  // And back through what was opened last: the first is where one is, the second where one was.
  await openSearch(page);
  const recent = group(page, "Recent").getByRole("option");
  await expect(recent.nth(0)).toContainText(BETA);
  await expect(recent.nth(1)).toContainText(ALPHA);
  await recent.nth(1).click();
  await expect(heading(page)).toHaveText(ALPHA);

  // A playlist made since the page read its list (from a game, say): found at once, and the page reads its list again to open it.
  await createPlaylist(page, GAMMA);
  await openSearch(page);
  await field(page).pressSequentially(GAMMA);
  await chooseWithKeys(page, group(page, "Playlists").getByRole("option").filter({ hasText: GAMMA }));
  await expect(heading(page)).toHaveText(GAMMA, { timeout: 15_000 });

  const picks = (await tracked()).filter((e) => e.event === "search_result_opened").map((e) => e.properties);
  expect(picks).toHaveLength(4);
  expect(picks[0]).toMatchObject({ kind: "playlist", from: "results", query_length: ALPHA.length });
  expect(picks[2]).toMatchObject({ kind: "playlist", from: "recent", position: 1, query_length: 0 });
});

test("a report opens in its Report view, from Library and in place, and its playlist opens on the clips", async ({ page }) => {
  const id = await createPlaylist(page, ALPHA);
  // A draft of the spec's own, under a title of its own; it goes with its playlist.
  await withAppModule(
    page,
    "/src/lib/report-drafts-db.ts",
    `await mod.saveReportDraft(arg.id, { v: 1, title: arg.title, opponent: null, intro: "", sections: [], placements: {}, order: [] });`,
    { id, title: REPORT },
  );
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });

  await openSearch(page);
  await field(page).pressSequentially(REPORT);
  const found = group(page, "Reports").getByRole("option").filter({ hasText: REPORT });
  await expect(found, "the draft is found by its title, with its status").toContainText("Draft");
  await chooseWithKeys(page, found);
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(viewRadio(page, "Report"), "the report opens in the Report view").toBeChecked({ timeout: 30_000 });

  // In place: the playlist itself is its clips.
  await openSearch(page);
  await field(page).pressSequentially(ALPHA);
  await chooseWithKeys(page, group(page, "Playlists").getByRole("option").filter({ hasText: ALPHA }));
  await expect(viewRadio(page, "Clips")).toBeChecked();
  await expect(heading(page)).toHaveText(ALPHA);

  // And its report again, from what was opened last: the playlist first, the report before it.
  await openSearch(page);
  const recent = group(page, "Recent").getByRole("option");
  await expect(recent.nth(0)).toContainText("Playlist");
  await expect(recent.nth(1)).toContainText(REPORT);
  await recent.nth(1).click();
  await expect(viewRadio(page, "Report")).toBeChecked();
});

test("Enter opens a game from the Library, and on the game page another one in a tab", async ({ page }) => {
  const [g0, g1] = await twoGames(page);
  await openSearch(page);
  await field(page).pressSequentially(g0.title);
  await chooseWithKeys(page, group(page, "Games").getByRole("option").filter({ hasText: g0.title }).first());
  await expect(page).toHaveURL(new RegExp(`/matches/${g0.id}`));
  await expect(page.getByRole("radiogroup", { name: "View" })).toBeVisible({ timeout: 30_000 });
  await expect(gameTabs(page)).toHaveCount(1);

  await openSearch(page);
  await field(page).pressSequentially(g1.title);
  await chooseWithKeys(page, group(page, "Games").getByRole("option").filter({ hasText: g1.title }).first());
  await expect(page).toHaveURL(new RegExp(`/matches/${g1.id}`));
  await expect(gameTabs(page), "the second game has a tab of its own").toHaveCount(2);

  // A game that has a tab: the search goes to it, and no third tab appears.
  await openSearch(page);
  await field(page).pressSequentially(g0.title);
  await chooseWithKeys(page, group(page, "Games").getByRole("option").filter({ hasText: g0.title }).first());
  await expect(page).toHaveURL(new RegExp(`/matches/${g0.id}`));
  await expect(gameTabs(page)).toHaveCount(2);
  await expect(gameTabs(page).filter({ hasText: g0.title })).toHaveAttribute("aria-current", "page");
});

test("the panel's keys stay in the panel: the game behind it neither plays nor seeks", async ({ page }) => {
  await openSampleGame(page);
  const paused = () => page.evaluate(() => document.querySelector("video")?.paused ?? null);
  const wasPaused = await paused();
  const at = await videoTime(page);
  await openSearch(page);
  await field(page).pressSequentially("a b");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(field(page)).toHaveValue("a b");
  expect(await paused(), "Space was typed, not played").toBe(wasPaused);
  if (wasPaused) expect(await videoTime(page), "the arrows moved the list, not the video").toBe(at);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("the panel fits the smallest window, light and dark", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  await openSearch(page);
  await field(page).pressSequentially("a");
  await expect(options(page).first()).toBeVisible({ timeout: 15_000 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const box = await panel(page).boundingBox();
    expect(box, "the panel is on the page").not.toBeNull();
    expect(box!.x, "inside the left edge").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "inside the right edge").toBeLessThanOrEqual(1024);
    expect(box!.y, "below the top edge").toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, "above the bottom edge").toBeLessThanOrEqual(640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page doesn't scroll sideways").toBeLessThanOrEqual(1024);
    await shot(page, `${browserName}-K-search-1024-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
});

test("a pointer at rest leaves the highlight to the keys when they scroll the list", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  for (const name of [ALPHA, BETA, GAMMA]) await createPlaylist(page, name);
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  await openSearch(page);
  await expect(options(page).first()).toBeVisible({ timeout: 15_000 });
  // The letter that finds the most: a list longer than the panel.
  let most = { letter: "", count: 0 };
  for (const letter of ["a", "e", "s", "o", "i"]) {
    await field(page).fill(letter);
    await page.waitForTimeout(150);
    const count = await options(page).count();
    if (count > most.count) most = { letter, count };
  }
  await field(page).fill(most.letter);
  await page.waitForTimeout(150);
  const sizes = await panel(page).getByRole("listbox").evaluate((el) => ({ all: el.scrollHeight, shown: el.clientHeight }));
  expect(sizes.all, `"${most.letter}" finds a list longer than the panel (${most.count} rows)`).toBeGreaterThan(sizes.shown);

  // The pointer comes to rest on the third row and takes the highlight there.
  const third = (await options(page).nth(2).boundingBox())!;
  await page.mouse.move(third.x + 80, third.y + third.height / 2 - 3);
  await page.mouse.move(third.x + 90, third.y + third.height / 2);
  await expect(options(page).nth(2)).toHaveAttribute("aria-selected", "true");
  for (let at = 3; at < most.count; at++) {
    await page.keyboard.press("ArrowDown");
    // WebKit tells a resting pointer of the rows that scrolled under it a moment later.
    await page.waitForTimeout(250);
    await expect(options(page).nth(at), `the keys moved the highlight to row ${at + 1} of ${most.count}`).toHaveAttribute("aria-selected", "true");
  }

  // A pointer that moves still takes it.
  const other = (await options(page).nth(most.count - 2).boundingBox())!;
  await page.mouse.move(other.x + 80, other.y + other.height / 2 - 3);
  await page.mouse.move(other.x + 90, other.y + other.height / 2);
  await expect(options(page).nth(most.count - 2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
});

test("a press on the panel beside its rows leaves the keys in the field", async ({ page }) => {
  await goViaSidebar(page, "Library");
  await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
  await openSearch(page);
  await expect(options(page).first()).toBeVisible({ timeout: 15_000 });
  // A group's heading.
  await panel(page).getByRole("group").first().locator('[role="presentation"]').click();
  await expect(field(page), "the field keeps the keys after a press on a heading").toBeFocused();
  await page.keyboard.type("q");
  await expect(field(page)).toHaveValue("q");
  // The hints at the foot.
  const box = (await panel(page).boundingBox())!;
  await page.mouse.click(box.x + box.width - 60, box.y + box.height - 12);
  await expect(field(page), "and after a press on the hints").toBeFocused();
  await page.keyboard.type("w");
  await expect(field(page)).toHaveValue("qw");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("a playlist the page can't read leaves its list as it was", async ({ page }) => {
  const alphaId = await createPlaylist(page, ALPHA);
  await goViaSidebar(page, "Playlists");
  const listed = page.locator(`[data-playlist-id="${alphaId}"]`).first();
  await expect(listed).toBeVisible({ timeout: 30_000 });
  // Made since the page read its list: the search finds it, the page has to read for it.
  await createPlaylist(page, GAMMA);
  await openSearch(page);
  await field(page).pressSequentially(GAMMA);
  const found = group(page, "Playlists").getByRole("option").filter({ hasText: GAMMA });
  await expect(found).toBeVisible({ timeout: 15_000 });
  await waitForQuiet(page);

  // The page's own read of its playlists fails (the search's light reads are let through).
  const pageReads = /\/rest\/v1\/playlists\?/;
  await page.route(pageReads, (route) => {
    const light = ["id,name,folder_id,created_at", "id,name"].includes(selectOf(route.request().url()));
    if (route.request().method() !== "GET" || light) return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the read fails" }) });
  });
  await chooseWithKeys(page, found);
  await expect(toastWith(page, "Couldn’t open that playlist")).toBeVisible({ timeout: 15_000 });
  await expect(listed, "the playlists the page had are still listed").toBeVisible();
  await page.unroute(pageReads);
});

test("a team is found by name and opens its page", async ({ page }) => {
  await goViaSidebar(page, "Library");
  const teams = await withAppModule<null, { id: string; name: string }[]>(
    page,
    "/src/lib/my-team.tsx",
    "return (await mod.teamCatalog()).slice(0, 1).map((t) => ({ id: t.id, name: t.name }));",
    null,
  );
  expect(teams.length, "the catalogue has a current team").toBe(1);
  const name = teams[0].name;
  await openSearch(page);
  await field(page).pressSequentially(plain(name));
  const option = group(page, "Teams").getByRole("option").filter({ hasText: name }).first();
  await chooseWithKeys(page, option);
  await expect(page).toHaveURL(/\/teams\/\d+\/\d+$/, { timeout: 30_000 });
  await openSearch(page);
  await expect(group(page, "Recent").getByRole("option").filter({ hasText: name }).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test.describe("where there is no menu bar", () => {
  // The app's Windows build: the chord is read from the keyboard.
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("Ctrl+K opens and closes the search, from a text field too, and is left alone over a sheet", async ({ page }) => {
    const tracked = await recordAnalytics(page);
    const alphaId = await createPlaylist(page, ALPHA);
    await goViaSidebar(page, "Library");
    await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
    await page.keyboard.press("Control+k");
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(panel(page)).toBeHidden();

    // From the Library's own search field.
    const own = page.getByPlaceholder("Search games");
    await own.click();
    await page.keyboard.press("Control+k");
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(own, "the focus is back in the field it was taken from").toBeFocused();
    expect((await tracked()).filter((e) => e.event === "search_opened").map((e) => e.properties?.via)).toEqual(["shortcut", "shortcut"]);

    // Over the Add clips sheet the chord does nothing.
    const sheet = await openAddClips(page, alphaId);
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
    await expect(panel(page)).toHaveCount(0);
    await expect(sheet).toBeVisible();
  });
  test("the chord pressed again while the panel is leaving opens a new one that has the keys", async ({ page }) => {
    await goViaSidebar(page, "Library");
    await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
    const own = page.getByPlaceholder("Search games");
    await own.click();
    await page.keyboard.press("Control+k");
    await expect(field(page)).toBeFocused();
    await field(page).pressSequentially("abc");
    // Closed, and asked for again before it has left.
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Control+k");
    await expect(panel(page)).toBeVisible();
    await expect(field(page), "a new panel starts empty").toHaveValue("");
    await expect(field(page), "and has the keys").toBeFocused();
    await page.keyboard.type("z");
    await expect(field(page)).toHaveValue("z");
    await expect(own, "nothing was typed into the page behind it").toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(own, "the focus is back in the field it was first taken from").toBeFocused();

    // A chord held down opens the panel once: its repeats don't close it again.
    await page.keyboard.down("Control");
    await page.keyboard.down("k");
    await page.keyboard.down("k");
    await page.keyboard.up("k");
    await page.keyboard.up("Control");
    await page.waitForTimeout(400);
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test("a number key under the open panel goes to its page, and the panel closes", async ({ page }) => {
    await goViaSidebar(page, "Library");
    await expect(heading(page)).toHaveText("Library", { timeout: 30_000 });
    await page.keyboard.press("Control+k");
    await expect(field(page)).toBeFocused();
    await field(page).pressSequentially("ab");
    await page.keyboard.press("Control+1");
    // The first row: Playlists (which may reopen the playlist opened last, so its URL, not its title).
    await expect(page).toHaveURL(/\/playlists$/, { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]')).toHaveText("Playlists");
    await expect(panel(page), "the panel doesn't stay over the page that opened").toBeHidden();
  });

  test("with the game's filter open, the chord and the sidebar's Search close it and open the search", async ({ page }) => {
    await openLibraryGame(page, 0);
    await showGameView(page);
    const filterButton = page.getByRole("button", { name: /^Filters/ });
    const filter = page.getByRole("dialog").filter({ has: page.getByPlaceholder("Player name or number") });
    await filterButton.click();
    await expect(filter).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(filter, "the filter closed, as on any press outside it").toBeHidden();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();

    await filterButton.click();
    await expect(filter).toBeVisible();
    await searchButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(filter).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });
});
