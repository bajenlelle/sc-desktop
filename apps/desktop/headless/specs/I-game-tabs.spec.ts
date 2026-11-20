/**
 * The open games (docs/game-view.md, "Open games"): rows in the sidebar under
 * "Open games", there from any page, with a + that opens a game picker, rows
 * that drag into another order, Close Tab, New Tab and Reopen Closed Tab, the
 * keys of a list, a row's menu, ⌃Tab from any page, the title's menu with the
 * sidebar hidden, the Library and Home marking the games that are open, and
 * the open games back after the app is quit. No tab bar over the game page.
 * It opens the test account's games and writes nothing: the open games live
 * in the browser's storage.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, goViaSidebar, openLibraryGame, shot, test } from "../helpers";

const nav = (page: Page) => page.getByRole("navigation", { name: "Open games" });
const rows = (page: Page) => nav(page).locator("button[data-open-game]");
const row = (page: Page, title: string) => nav(page).getByRole("button", { name: title, exact: true });
const closeOf = (page: Page, title: string) => page.getByRole("button", { name: `Close ${title}`, exact: true });
const plus = (page: Page) => nav(page).getByRole("button", { name: "Open another game" });
const picker = (page: Page) => page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search games") });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const libraryRow = (page: Page, id: string) => page.locator(`main a[href="/matches/${id}"]`);
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

type Game = { id: string; title: string };

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} is on the page`).not.toBeNull();
  return box!;
}

/** Opens the Library's first `n` games one after the other, as a coach does; each is an open game. */
async function openGames(page: Page, n: number): Promise<Game[]> {
  const games: Game[] = [];
  for (let i = 0; i < n; i++) games.push(await openLibraryGame(page, i));
  return games;
}

const titles = (page: Page) => rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
const opacityOf = (locator: Locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));

/** From here on, notes whether the game page's spinner ("Loading the game…") is ever put on the page. */
async function watchForSpinner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sawSpinner: boolean; __spinnerWatch?: MutationObserver };
    w.__sawSpinner = false;
    w.__spinnerWatch?.disconnect();
    w.__spinnerWatch = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.textContent?.includes("Loading the game")) w.__sawSpinner = true;
    });
    w.__spinnerWatch.observe(document.body, { childList: true, subtree: true });
  });
}
const sawSpinner = (page: Page) => page.evaluate(() => (window as unknown as { __sawSpinner: boolean }).__sawSpinner);

/** What the menu bar's items send to the page (components/menu-handler.tsx). */
const menu = (page: Page, event: "menu-new-game-tab" | "menu-reopen-game-tab" | "menu-close-game-tab") =>
  page.evaluate((name) => window.dispatchEvent(new CustomEvent(name)), event);
/** The open game the keyboard's focus is on; null when it is elsewhere. */
const focusedRow = (page: Page) =>
  page.evaluate(() => (document.activeElement?.hasAttribute("data-open-game") ? (document.activeElement.getAttribute("aria-label") ?? "") : null));

test("the open games are sidebar rows, the game on screen selected, with no tab bar over the page", async ({ page, browserName }) => {
  const [g0] = await openGames(page, 1);
  await expect(heading(page)).toHaveText(g0.title);
  await expect(rows(page), "one game is one row").toHaveCount(1);
  await expect(row(page, g0.title)).toHaveAttribute("aria-current", "page");
  await expect(mainNav(page).getByRole("link", { name: "Library", exact: true }), "the game's row is selected, not the Library").not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tablist"), "no tab bar over the game").toHaveCount(0);
  // The game on screen is the only one: there is no game to give the page to, so nothing closes it.
  await row(page, g0.title).hover();
  await expect(closeOf(page, g0.title), "a lone shown game has no ×").toHaveCount(0);

  const g1 = await openLibraryGame(page, 1);
  await expect(rows(page)).toHaveCount(2);
  expect(await titles(page), "new games go last").toEqual([g0.title, g1.title]);
  await expect(row(page, g1.title)).toHaveAttribute("aria-current", "page");
  await expect(row(page, g0.title)).not.toHaveAttribute("aria-current", "page");
  // The rows are in the sidebar, under its pages.
  const pages = await boxOf(mainNav(page), "the sidebar's pages");
  const open = await boxOf(nav(page), "the open games");
  expect(open.y, "under the sidebar's pages").toBeGreaterThanOrEqual(pages.y + pages.height);
  expect(open.x + open.width, "in the sidebar").toBeLessThanOrEqual(240);
  // Another game's × waits for the pointer.
  await page.mouse.move(800, 400);
  expect(await opacityOf(closeOf(page, g0.title))).toBe(0);
  await row(page, g0.title).hover();
  await expect.poll(() => opacityOf(closeOf(page, g0.title)), { message: "pointed at, the row shows its ×" }).toBe(1);

  await page.mouse.move(800, 400);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-I-open-games-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
});

test("leaving the game keeps the rows, and a row goes back to the game as it was left", async ({ page, browserName }) => {
  const [g0, g1] = await openGames(page, 2);
  await goViaSidebar(page, "Playlists");
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(rows(page), "the open games are still there on another page").toHaveCount(2);
  for (const title of [g0.title, g1.title]) await expect(row(page, title)).not.toHaveAttribute("aria-current", "page");
  await shot(page, `${browserName}-I-open-games-on-playlists`);

  await watchForSpinner(page);
  await row(page, g0.title).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${g0.id}`));
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(row(page, g0.title)).toHaveAttribute("aria-current", "page");
  expect(await sawSpinner(page), "an open game comes back with no \"Loading the game…\"").toBe(false);
  // From another page the row was a step like any link: Back returns to it.
  await page.goBack();
  await expect(page).toHaveURL(/\/playlists$/);

  // Off the game page any row closes, the last one too.
  await row(page, g1.title).hover();
  await closeOf(page, g1.title).click();
  await row(page, g0.title).hover();
  await closeOf(page, g0.title).click();
  await expect(nav(page), "no open games, no section").toHaveCount(0);
});

test("⌃Tab steps through the open games on the game page, and from another page goes back to the game shown last", async ({ page }) => {
  const [g0, g1] = await openGames(page, 2);
  await expect(heading(page)).toHaveText(g1.title);
  await page.keyboard.press("Control+Tab");
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await page.keyboard.press("Control+Shift+Tab");
  await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });

  await goViaSidebar(page, "Playlists");
  await expect(page).toHaveURL(/\/playlists$/);
  await page.keyboard.press("Control+Tab");
  await expect(page, "back to the game shown last").toHaveURL(new RegExp(`/matches/${g1.id}`));
  await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });
});

test("the + opens a picker of the Library's games: a new one opens as a new row, an open one goes to it", async ({ page, browserName }) => {
  const [g0, g1] = await openGames(page, 2);
  await page.locator("header").getByRole("button", { name: "Library", exact: true }).click();
  const third = page.locator('main a[href^="/matches/"]').nth(2);
  await expect(third).toBeVisible({ timeout: 30_000 });
  const g2: Game = { id: (await third.getAttribute("href"))!.replace("/matches/", ""), title: (await third.locator("span").first().innerText()).trim() };
  await openLibraryGame(page, 1);

  await plus(page).click();
  await expect(picker(page)).toBeVisible();
  await expect(page.getByPlaceholder("Search games")).toBeFocused();
  const option = (game: Game) => picker(page).getByRole("button").filter({ hasText: game.title });
  await expect(option(g2), "a game not open is offered").toBeVisible({ timeout: 30_000 });
  await expect(option(g0).getByText("Open", { exact: true }), "an open game says so").toBeVisible();
  await expect(option(g1).getByText("Open", { exact: true })).toBeVisible();
  await expect(option(g2).getByText("Open", { exact: true })).toHaveCount(0);
  await shot(page, `${browserName}-I-open-games-picker`);

  await page.getByPlaceholder("Search games").fill(g2.title.toLowerCase());
  await expect(option(g0)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText(g2.title, { timeout: 30_000 });
  expect(await titles(page), "the new game goes last").toEqual([g0.title, g1.title, g2.title]);

  await plus(page).click();
  await option(g0).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(rows(page)).toHaveCount(3);
});

test("a row dragged past its neighbour changes places with it, and the order stays", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  expect(await titles(page)).toEqual([g0.title, g1.title, g2.title]);

  /** Presses a row and drags it until its middle is `past` px beyond the middle of another. */
  const drag = async (from: Game, to: Game, past: number) => {
    const a = await boxOf(row(page, from.title), "the dragged row");
    const b = await boxOf(row(page, to.title), "the row it passes");
    const x = a.x + a.width / 3;
    const startY = a.y + a.height / 2;
    const endY = b.y + b.height / 2 + past;
    await page.mouse.move(x, startY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x, startY + ((endY - startY) * i) / 12);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
  };

  await drag(g0, g1, 12);
  await expect.poll(() => titles(page), { message: "the first row is now the second" }).toEqual([g1.title, g0.title, g2.title]);
  // A drag only moves the row: the game on screen stays (a row opens on a click, not on the press).
  await expect(heading(page)).toHaveText(g2.title);

  await drag(g2, g1, -12);
  await expect.poll(() => titles(page), { message: "the last row is now the first" }).toEqual([g2.title, g1.title, g0.title]);

  await goViaSidebar(page, "Home");
  expect(await titles(page), "the order after leaving the games").toEqual([g2.title, g1.title, g0.title]);
});

test("Close Tab closes the game on screen, and leaves the last one", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await expect(heading(page)).toHaveText(g2.title);
  await menu(page, "menu-close-game-tab");
  await expect.poll(() => titles(page), { message: "the closed row leaves" }).toEqual([g0.title, g1.title]);
  await expect(heading(page), "the neighbour's game is shown").toHaveText(g1.title, { timeout: 10_000 });
  await menu(page, "menu-close-game-tab");
  await expect(rows(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  // With one game Close Tab is not in the menu (⌘W is the window's); if it arrives all the same, the game stays.
  await menu(page, "menu-close-game-tab");
  await expect(rows(page)).toHaveCount(1);
  await expect(heading(page)).toHaveText(g0.title);
});

test.describe("where there is no menu bar", () => {
  // The app's Windows build: the same chords are read from the keyboard.
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("Ctrl+W closes the game on screen while another is open, Ctrl+Shift+T brings it back, Ctrl+T opens the picker", async ({ page }) => {
    const [g0, g1] = await openGames(page, 2);
    await page.keyboard.press("Control+w");
    await expect(rows(page)).toHaveCount(1);
    await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
    await page.keyboard.press("Control+w");
    await expect(heading(page)).toHaveText(g0.title);
    await expect(page).toHaveURL(new RegExp(`/matches/${g0.id}`));
    await page.keyboard.press("Control+Shift+t");
    await expect(rows(page)).toHaveCount(2);
    await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });
    await page.keyboard.press("Control+t");
    await expect(picker(page)).toBeVisible();
  });
});

test("the Library and Home mark the games that are open, from one", async ({ page, browserName }) => {
  const [g0] = await openGames(page, 1);
  await page.locator("header").getByRole("button", { name: "Library", exact: true }).click();
  await expect(libraryRow(page, g0.id).getByText("Open", { exact: true }), "one open game is marked").toBeVisible({ timeout: 30_000 });
  const other = page.locator('main a[href^="/matches/"]').nth(1);
  await expect(other.getByText("Open", { exact: true }), "a game not open isn't").toHaveCount(0);
  await shot(page, `${browserName}-I-open-games-library`);

  await goViaSidebar(page, "Home");
  const homeRow = libraryRow(page, g0.id);
  if (await homeRow.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await expect(homeRow.getByText("Open", { exact: true }), "Home's Recent imports marks it too").toBeVisible();
  }
});

test("the keyboard works the rows as a list: one stop, ↓ and ↑ to move, Return to open, Delete to close", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await expect(heading(page)).toHaveText(g2.title);
  expect(await rows(page).evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).map((el) => el.getAttribute("aria-label"))), "only the shown game's row is a Tab stop").toEqual([g2.title]);
  expect(
    await nav(page).getByRole("button", { name: /^Close / }).evaluateAll((els) => els.every((el) => (el as HTMLElement).tabIndex === -1)),
    "the close buttons aren't Tab stops",
  ).toBe(true);

  await row(page, g2.title).focus();
  await page.keyboard.press("ArrowUp");
  expect(await focusedRow(page)).toBe(g1.title);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await focusedRow(page), "↑ from the first row goes round to the last").toBe(g2.title);
  await page.keyboard.press("Home");
  expect(await focusedRow(page)).toBe(g0.title);
  await page.keyboard.press("End");
  expect(await focusedRow(page)).toBe(g2.title);
  await page.keyboard.press("ArrowDown");
  expect(await focusedRow(page), "↓ from the last row goes round to the first").toBe(g0.title);
  await expect(heading(page), "moving the focus hasn't changed the game").toHaveText(g2.title);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });
  expect(await focusedRow(page), "the focus stays on the row that was chosen").toBe(g1.title);

  await page.keyboard.press("Delete");
  await expect(rows(page)).toHaveCount(2);
  expect(await titles(page)).toEqual([g0.title, g2.title]);
  await expect.poll(() => focusedRow(page), { message: "the focus is on the row that followed" }).toBe(g2.title);
});

test("a click on a row leaves the keyboard with the page", async ({ page }) => {
  const [g0] = await openGames(page, 2);
  await row(page, g0.title).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  expect(await focusedRow(page), "the clicked row doesn't hold the keyboard's focus").toBeNull();
});

test("New Tab opens the picker, a row's menu closes others, and closed games come back in their places", async ({ page }) => {
  const [g0] = await openGames(page, 1);
  await menu(page, "menu-new-game-tab");
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);

  const g1 = await openLibraryGame(page, 1);
  const g2 = await openLibraryGame(page, 2);
  await row(page, g1.title).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close Other Tabs", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(heading(page), "the row kept is the game shown").toHaveText(g1.title, { timeout: 10_000 });
  await menu(page, "menu-reopen-game-tab");
  await expect(rows(page)).toHaveCount(2);
  await menu(page, "menu-reopen-game-tab");
  expect(await titles(page), "both are back in their places").toEqual([g0.title, g1.title, g2.title]);
});

test("a seventh game says which it closed, and can bring it back", async ({ page }) => {
  const [g0] = await openGames(page, 1);
  await page.evaluate((game) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("scoutable_game_tabs:"))!;
    const fakes = [1, 2, 3, 4, 5].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `Stand-in ${n}`, date: null }));
    localStorage.setItem(key, JSON.stringify({ tabs: [{ id: game.id, title: game.title, date: null }, ...fakes], recent: [...fakes.map((f) => f.id).reverse(), game.id] }));
  }, g0);
  // A fresh load reads them, and checks them against the database: the stand-ins aren't games, so it closes them.
  // Hold that check back so the six stay for this test.
  await page.route("**/rest/v1/matches*", async (route) => {
    const url = route.request().url();
    if (url.includes("00000000-0000-4000-8000")) await route.fulfill({ status: 500, body: "{}" });
    else await route.continue();
  });
  await page.goto("/matches");
  const g1 = await openLibraryGame(page, 1);
  await expect(heading(page)).toHaveText(g1.title);
  await expect(rows(page)).toHaveCount(6);
  const notice = page.locator("[data-sonner-toast]").filter({ hasText: g0.title });
  await expect(notice, "the game that made room is named").toBeVisible();
  await page.waitForTimeout(6000);
  await expect(notice, "the notice is still there six seconds on").toBeVisible();
  await notice.getByRole("button", { name: "Reopen" }).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(rows(page)).toHaveCount(6);
  expect((await titles(page))[0], "it is back in its place").toBe(g0.title);
});

test("a row cuts each team short by itself, so both stay in sight", async ({ page }) => {
  const games = await openGames(page, 5);
  const game = games.find((g) => g.title.includes(" vs "));
  expect(game, "the account has a game titled Home vs Away").toBeTruthy();
  const [home, away] = game!.title.split(" vs ");
  const the = row(page, game!.title);
  const box = await boxOf(the, "the row");
  for (const [team, what] of [
    [home, "the home team"],
    [away, "the away team"],
  ] as const) {
    const part = await boxOf(the.getByText(team, { exact: true }), what);
    expect(part.width, `${what} keeps some room`).toBeGreaterThanOrEqual(20);
    expect(part.x + part.width, `${what} stays inside the row`).toBeLessThanOrEqual(box.x + box.width);
  }
});

test("with the sidebar hidden, the game's title is the open games' menu, and New Tab opens the picker there", async ({ page, browserName }) => {
  const [g0, g1] = await openGames(page, 2);
  await page.locator("header").getByRole("button", { name: "Hide sidebar" }).click();
  const title = page.locator("header h1").getByRole("button");
  await expect(title, "the title is a menu once the sidebar is hidden").toBeVisible({ timeout: 5_000 });
  await title.click();
  const titleMenu = page.getByRole("menu");
  await expect(titleMenu.getByRole("menuitem", { name: g0.title })).toBeVisible();
  await shot(page, `${browserName}-I-open-games-title-menu`);
  await titleMenu.getByRole("menuitem", { name: g0.title }).click();
  await expect(heading(page)).toContainText(g0.title, { timeout: 10_000 });

  await menu(page, "menu-new-game-tab");
  await expect(picker(page), "the picker opens at the title").toBeVisible();
  await page.keyboard.press("Escape");
  // The sidebar back for the specs after this one (it is remembered).
  await page.locator("header").getByRole("button", { name: "Show sidebar" }).click();
});

test("the open games come back after the app is quit, and a game deleted meanwhile doesn't", async ({ page, context }) => {
  const [g0, g1] = await openGames(page, 2);
  // A game that is gone: it was open, and isn't there any more.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("scoutable_game_tabs:"))!;
    const state = JSON.parse(localStorage.getItem(key)!) as { tabs: unknown[]; recent: string[] };
    const gone = "00000000-0000-4000-8000-0000000000cc";
    state.tabs.push({ id: gone, title: "Deleted game", date: null });
    state.recent.push(gone);
    localStorage.setItem(key, JSON.stringify(state));
  });
  // A new window of the app: its session storage is empty, its local storage is the computer's.
  const again = await context.newPage();
  await again.goto("/");
  await expect(again.getByRole("navigation", { name: "Open games" }).locator("button[data-open-game]"), "the two games are back, the deleted one isn't").toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(again.getByRole("navigation", { name: "Open games" }).getByRole("button", { name: g0.title, exact: true })).toBeVisible();
  await expect(again.getByRole("navigation", { name: "Open games" }).getByRole("button", { name: g1.title, exact: true })).toBeVisible();
  await again.close();
});
