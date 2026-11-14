/**
 * The game page's tab bar (docs/game-view.md, "Games in tabs"): the page's
 * top row, above the game's own toolbar, with tabs at their natural width, a
 * "+" that opens a game picker, tabs that drag into another order, Close Tab,
 * and the Library marking the games that are open. It opens the test
 * account's games and writes nothing: the tabs live in the browser session.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, openLibraryGame, shot, test } from "../helpers";

const tablist = (page: Page) => page.getByRole("tablist", { name: "Open games" });
const tabs = (page: Page) => tablist(page).getByRole("tab");
const tab = (page: Page, title: string) => tablist(page).getByRole("tab", { name: title, exact: true });
const closeOf = (page: Page, title: string) => page.getByRole("button", { name: `Close ${title}`, exact: true });
const plus = (page: Page) => page.getByRole("button", { name: "Open another game" });
const picker = (page: Page) => page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search games") });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const libraryRow = (page: Page, id: string) => page.locator(`a[href="/matches/${id}"]`);

type Game = { id: string; title: string };
type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} is on the page`).not.toBeNull();
  return box!;
}

/** Opens the Library's first `n` games one after the other, as a coach does; each gets a tab. */
async function openGames(page: Page, n: number): Promise<Game[]> {
  const games: Game[] = [];
  for (let i = 0; i < n; i++) games.push(await openLibraryGame(page, i));
  return games;
}

const titles = (page: Page) => tabs(page).allInnerTexts();
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

test("the tabs are the page's top row, at their own width, with the shown game's tab leading into its toolbar", async ({ page, browserName }) => {
  // One game: no tab bar, and nothing to open another from.
  const [g0] = await openGames(page, 1);
  await expect(heading(page)).toHaveText(g0.title);
  await expect(tablist(page)).toHaveCount(0);
  await expect(plus(page)).toHaveCount(0);

  // A second game brings the bar: above the game's own toolbar, not under it.
  const g1 = await openLibraryGame(page, 1);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tab(page, g1.title)).toHaveAttribute("aria-selected", "true");
  const bar = await boxOf(tablist(page), "the tab bar");
  const title = await boxOf(heading(page), "the game's title");
  expect(bar.y + bar.height, "the tab bar is above the toolbar's title row").toBeLessThanOrEqual(title.y);

  // Tabs, not a two-way switch: each at its own width from the left, the rest of the row left empty.
  const viewport = page.viewportSize()!;
  const first = await boxOf(tab(page, g0.title), "the first tab");
  const second = await boxOf(tab(page, g1.title), "the second tab");
  for (const box of [first, second]) expect(box.width, "a tab is no wider than a tab").toBeLessThanOrEqual(220);
  expect(first.x, "the tabs start at the left of the content column").toBeLessThan(viewport.width / 2);
  expect(second.x + second.width, "two tabs leave most of the row empty").toBeLessThan(viewport.width * 0.7);
  expect(second.x, "the tabs sit side by side").toBeGreaterThanOrEqual(first.x + first.width - 1);

  // The shown game's tab can always be closed; another tab shows its × when pointed at.
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  expect(await opacityOf(closeOf(page, g1.title)), "the shown tab's × is there without pointing").toBe(1);
  expect(await opacityOf(closeOf(page, g0.title)), "another tab's × waits for the pointer").toBe(0);
  await tab(page, g0.title).hover();
  await expect.poll(() => opacityOf(closeOf(page, g0.title)), { message: "pointed at, the tab shows its ×" }).toBe(1);

  await expect(plus(page), "the + follows the last tab").toBeVisible();
  const add = await boxOf(plus(page), "the +");
  expect(add.x, "the + comes right after the last tab").toBeGreaterThanOrEqual(second.x + second.width - 1);
  expect(add.x - (second.x + second.width), "and stays close to it").toBeLessThan(24);

  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-I-tabs-two-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
});

test("the + opens a picker of the Library's games: a new one opens in a tab, an open one goes to its tab", async ({ page, browserName }) => {
  const [g0, g1] = await openGames(page, 2);
  // The third game's place in the Library, to know what the picker should offer.
  await page.locator("header").getByRole("button", { name: "Library", exact: true }).click();
  const third = page.locator('a[href^="/matches/"]').nth(2);
  await expect(third).toBeVisible({ timeout: 30_000 });
  const g2: Game = { id: (await third.getAttribute("href"))!.replace("/matches/", ""), title: (await third.locator("span").first().innerText()).trim() };
  await openLibraryGame(page, 1);
  await expect(tabs(page)).toHaveCount(2);

  await plus(page).click();
  await expect(picker(page)).toBeVisible();
  await expect(page.getByPlaceholder("Search games")).toBeFocused();
  const row = (game: Game) => picker(page).getByRole("button").filter({ hasText: game.title });
  await expect(row(g2), "a game with no tab is offered").toBeVisible({ timeout: 30_000 });
  await expect(row(g0).getByText("Open", { exact: true }), "a game with a tab says so").toBeVisible();
  await expect(row(g1).getByText("Open", { exact: true })).toBeVisible();
  await expect(row(g2).getByText("Open", { exact: true })).toHaveCount(0);
  await shot(page, `${browserName}-I-tabs-picker`);

  // What is typed narrows the list; Return opens the first game left.
  await page.getByPlaceholder("Search games").fill(g2.title.toLowerCase());
  await expect(row(g0)).toHaveCount(0);
  await expect(row(g2)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText(g2.title, { timeout: 30_000 });
  await expect(tabs(page)).toHaveCount(3);
  expect(await titles(page), "the new game's tab is on the right").toEqual([g0.title, g1.title, g2.title]);
  await expect(tab(page, g2.title)).toHaveAttribute("aria-selected", "true");

  // A game that already has a tab: the picker goes to it, and opens nothing new.
  await plus(page).click();
  await row(g0).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(tabs(page)).toHaveCount(3);
  await expect(tab(page, g0.title)).toHaveAttribute("aria-selected", "true");
});

test("a tab dragged past its neighbour changes places with it, and the order stays", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  expect(await titles(page)).toEqual([g0.title, g1.title, g2.title]);

  /** Presses a tab and drags it until its middle is `past` px beyond the middle of another. */
  const drag = async (from: Game, to: Game, past: number) => {
    const a = await boxOf(tab(page, from.title), "the dragged tab");
    const b = await boxOf(tab(page, to.title), "the tab it passes");
    const y = a.y + a.height / 2;
    const startX = a.x + a.width / 2;
    const endX = b.x + b.width / 2 + past;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(startX + ((endX - startX) * i) / 12, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
  };

  // The first tab to the right, past the second: the press also shows that game, as a press on a tab does.
  await drag(g0, g1, 30);
  await expect.poll(() => titles(page), { message: "the first tab is now the second" }).toEqual([g1.title, g0.title, g2.title]);
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(tab(page, g0.title)).toHaveAttribute("aria-selected", "true");

  // The last tab to the left, past the first.
  await drag(g2, g1, -30);
  await expect.poll(() => titles(page), { message: "the last tab is now the first" }).toEqual([g2.title, g1.title, g0.title]);

  // The order is the tabs' own: it is there after a visit to the Library.
  await openLibraryGame(page, 1);
  expect(await titles(page), "the order after leaving the games and coming back").toEqual([g2.title, g1.title, g0.title]);
});

test("Close Tab closes the shown game's tab, and the last one left takes the bar with it", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await expect(heading(page)).toHaveText(g2.title);

  // The File menu's Close Tab arrives in the page as this event (components/menu-handler.tsx).
  const closeTab = () => page.evaluate(() => window.dispatchEvent(new CustomEvent("menu-close-game-tab")));
  await closeTab();
  await expect(tabs(page)).toHaveCount(2);
  expect(await titles(page)).toEqual([g0.title, g1.title]);
  await expect(heading(page), "the neighbour's game is shown").toHaveText(g1.title, { timeout: 10_000 });

  await closeTab();
  await expect(tablist(page), "one game left: no tab bar").toHaveCount(0);
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
});

test.describe("where there is no menu bar", () => {
  // The app's Windows build: the same chords are read from the keyboard.
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("Ctrl+W closes the shown game's tab while the tabs are there, and is left alone otherwise", async ({ page }) => {
    const [g0, g1] = await openGames(page, 2);
    await expect(tabs(page)).toHaveCount(2);
    await page.keyboard.press("Control+w");
    await expect(tablist(page)).toHaveCount(0);
    await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });

    // One game, no tabs: the chord does nothing to the page.
    await page.keyboard.press("Control+w");
    await expect(heading(page)).toHaveText(g0.title);
    await expect(page).toHaveURL(new RegExp(`/matches/${g0.id}`));
    expect(g1.id).not.toBe(g0.id);
  });
});

test("the Library marks the games that are open, and a click on one goes back to its tab without loading", async ({ page, browserName }) => {
  // One game open: there are no tabs yet, so nothing is marked.
  const [g0] = await openGames(page, 1);
  const library = page.locator("header").getByRole("button", { name: "Library", exact: true });
  await library.click();
  await expect(libraryRow(page, g0.id)).toBeVisible({ timeout: 30_000 });
  await expect(libraryRow(page, g0.id).getByText("Open", { exact: true })).toHaveCount(0);

  const g1 = await openLibraryGame(page, 1);
  await expect(tabs(page)).toHaveCount(2);
  await library.click();
  await expect(libraryRow(page, g0.id).getByText("Open", { exact: true }), "the first open game is marked").toBeVisible({ timeout: 30_000 });
  await expect(libraryRow(page, g1.id).getByText("Open", { exact: true }), "so is the second").toBeVisible();
  const other = page.locator('a[href^="/matches/"]').nth(2);
  await expect(other.getByText("Open", { exact: true }), "a game with no tab isn't").toHaveCount(0);
  await shot(page, `${browserName}-I-tabs-library`);

  await watchForSpinner(page);
  await libraryRow(page, g0.id).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  await expect(tab(page, g0.title)).toHaveAttribute("aria-selected", "true");
  expect(await sawSpinner(page), "an open game comes back as a tab does, with no \"Loading the game…\"").toBe(false);
});

test("five tabs and the + fit the smallest window", async ({ page, browserName }) => {
  const games = await openGames(page, 5);
  await expect(tabs(page)).toHaveCount(5);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(400);

  const boxes = await tabs(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, width: r.width })));
  for (const [i, box] of boxes.entries()) {
    expect(box.width, `tab ${i + 1} keeps room for its title`).toBeGreaterThanOrEqual(100);
    expect(box.right, `tab ${i + 1} is inside the window`).toBeLessThanOrEqual(1024);
    if (i > 0) expect(box.left, `tab ${i + 1} doesn't overlap the one before`).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
  }
  const add = await boxOf(plus(page), "the +");
  expect(add.x + add.width, "the + is inside the window").toBeLessThanOrEqual(1024);
  expect(add.x, "the + is after the last tab").toBeGreaterThanOrEqual(boxes[4].right - 1);
  expect(games).toHaveLength(5);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(page, `${browserName}-I-tabs-five-1024-${scheme}`);
  }
});
