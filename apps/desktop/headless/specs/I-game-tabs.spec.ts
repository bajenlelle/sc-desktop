/**
 * The game page's tab bar (docs/game-view.md, "Games in tabs"): the page's
 * top row, above the game's own toolbar, with tabs at their natural width, a
 * "+" that opens a game picker, tabs that drag into another order, Close Tab,
 * New Tab and Reopen Closed Tab, the keys of a tab list, a tab's menu, and the
 * Library marking the games that are open. It opens the test account's games
 * and writes nothing: the tabs live in the browser session.
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

const titles = (page: Page) => tabs(page).allTextContents();
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

    // Ctrl+Shift+T brings the closed tab back, and Ctrl+T opens the picker.
    await page.keyboard.press("Control+Shift+t");
    await expect(tabs(page)).toHaveCount(2);
    await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });
    await page.keyboard.press("Control+t");
    await expect(picker(page)).toBeVisible();
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

/** What the File menu's items send to the page (components/menu-handler.tsx). */
const menu = (page: Page, event: "menu-new-game-tab" | "menu-reopen-game-tab" | "menu-close-game-tab") =>
  page.evaluate((name) => window.dispatchEvent(new CustomEvent(name)), event);
/** The tab the keyboard's focus is on; null when it is elsewhere. */
const focusedTab = (page: Page) =>
  page.evaluate(() => (document.activeElement?.getAttribute("role") === "tab" ? (document.activeElement.textContent ?? "") : null));

test("the keyboard works the tabs as a tab list: one stop, arrows to move, Return to choose, Delete to close", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await expect(heading(page)).toHaveText(g2.title);

  // One stop for Tab in the whole bar's tabs: the shown game's. The ×s are for the pointer.
  expect(await tabs(page).evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).map((el) => el.textContent)), "only the shown tab is a Tab stop").toEqual([g2.title]);
  expect(
    await tablist(page).getByRole("button", { name: /^Close / }).evaluateAll((els) => els.every((el) => (el as HTMLElement).tabIndex === -1)),
    "the close buttons aren't Tab stops",
  ).toBe(true);

  // The arrows move the focus along the tabs and round the ends; the game on screen stays.
  await tab(page, g2.title).focus();
  await page.keyboard.press("ArrowLeft");
  expect(await focusedTab(page)).toBe(g1.title);
  await page.keyboard.press("ArrowLeft");
  expect(await focusedTab(page)).toBe(g0.title);
  await page.keyboard.press("ArrowLeft");
  expect(await focusedTab(page), "← from the first tab goes round to the last").toBe(g2.title);
  await page.keyboard.press("Home");
  expect(await focusedTab(page)).toBe(g0.title);
  await page.keyboard.press("End");
  expect(await focusedTab(page)).toBe(g2.title);
  await page.keyboard.press("ArrowRight");
  expect(await focusedTab(page), "→ from the last tab goes round to the first").toBe(g0.title);
  await expect(heading(page), "moving the focus hasn't changed the game").toHaveText(g2.title);

  // Return chooses the tab the focus is on.
  await page.keyboard.press("ArrowRight");
  expect(await focusedTab(page)).toBe(g1.title);
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText(g1.title, { timeout: 10_000 });
  await expect(tab(page, g1.title)).toHaveAttribute("aria-selected", "true");
  expect(await focusedTab(page), "the focus stays on the tab that was chosen").toBe(g1.title);

  // Delete closes the tab the focus is on, and the focus goes to the one after it.
  await page.keyboard.press("Delete");
  await expect(tabs(page)).toHaveCount(2);
  expect(await titles(page)).toEqual([g0.title, g2.title]);
  await expect.poll(() => focusedTab(page), { message: "the focus is on the tab that followed" }).toBe(g2.title);
});

test("a click on a tab leaves the keyboard with the page: Space and the arrows stay the game's", async ({ page }) => {
  const [g0, g1] = await openGames(page, 2);
  await tab(page, g0.title).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  expect(await focusedTab(page), "the clicked tab doesn't hold the keyboard's focus").toBeNull();
  // The tab that is already shown, too.
  await tab(page, g0.title).click();
  expect(await focusedTab(page), "nor does the shown tab when clicked").toBeNull();
  await expect(tab(page, g1.title)).toBeVisible();
});

test("New Tab opens the picker, from a single game too, and a closed tab comes back in its place", async ({ page }) => {
  // One game, no bar: New Tab brings the bar for as long as the picker is open.
  const [g0] = await openGames(page, 1);
  await expect(tablist(page)).toHaveCount(0);
  await menu(page, "menu-new-game-tab");
  await expect(picker(page)).toBeVisible();
  await expect(page.getByPlaceholder("Search games")).toBeFocused();
  await expect(tabs(page), "the one game shows as a tab while the picker is open").toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(tablist(page), "dismissed, the bar goes again").toHaveCount(0);

  // Two more games, then close the first: Reopen Closed Tab puts it back where it was, and shows it.
  const g1 = await openLibraryGame(page, 1);
  const g2 = await openLibraryGame(page, 2);
  expect(await titles(page)).toEqual([g0.title, g1.title, g2.title]);
  await tab(page, g0.title).hover();
  await closeOf(page, g0.title).click();
  await expect(tabs(page)).toHaveCount(2);
  await menu(page, "menu-reopen-game-tab");
  await expect(tabs(page)).toHaveCount(3);
  expect(await titles(page), "back in its own place, not at the end").toEqual([g0.title, g1.title, g2.title]);
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });

  // Nothing more to reopen: the menu's item does nothing.
  await menu(page, "menu-reopen-game-tab");
  await expect(tabs(page)).toHaveCount(3);
});

test("a tab's menu closes it, or every other tab", async ({ page }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await tab(page, g1.title).click({ button: "right" });
  const tabMenu = page.getByRole("menu");
  await expect(tabMenu.getByRole("menuitem", { name: "Close Tab", exact: true })).toBeVisible();
  await tabMenu.getByRole("menuitem", { name: "Close Other Tabs", exact: true }).click();
  await expect(tablist(page), "one game left: no tab bar").toHaveCount(0);
  await expect(heading(page), "the tab that was kept is the game shown").toHaveText(g1.title, { timeout: 10_000 });

  // The two that were closed come back one at a time, last closed first.
  await menu(page, "menu-reopen-game-tab");
  await expect(tabs(page)).toHaveCount(2);
  await menu(page, "menu-reopen-game-tab");
  expect(await titles(page), "both are back in their places").toEqual([g0.title, g1.title, g2.title]);
});

test("a seventh game says which tab it closed, and can bring it back", async ({ page }) => {
  // The account has five games, so the bar is filled with stand-ins: the first real game is the one shown least recently.
  const [g0] = await openGames(page, 1);
  await page.evaluate((game) => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith("scoutable_game_tabs:"))!;
    const fakes = [1, 2, 3, 4, 5].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: `Stand-in ${n}`, date: null }));
    sessionStorage.setItem(key, JSON.stringify({ tabs: [{ id: game.id, title: game.title, date: null }, ...fakes], recent: [...fakes.map((f) => f.id).reverse(), game.id] }));
  }, g0);
  await page.goto("/matches");
  const g1 = await openLibraryGame(page, 1);
  await expect(heading(page)).toHaveText(g1.title);
  await expect(tabs(page)).toHaveCount(6);

  const notice = page.locator("[data-sonner-toast]").filter({ hasText: g0.title });
  await expect(notice, "the tab that made room is named").toBeVisible();
  expect(await titles(page), "it is the game shown least recently that went").not.toContain(g0.title);
  // Nobody asked for that tab to close: the notice stays long enough to be read and answered.
  await page.waitForTimeout(6000);
  await expect(notice, "the notice is still there six seconds on").toBeVisible();
  await notice.getByRole("button", { name: "Reopen" }).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 10_000 });
  expect((await titles(page))[0], "it is back in its place").toBe(g0.title);
  await expect(tabs(page)).toHaveCount(6);
});

test("a tab cuts each team short by itself, so both stay in sight", async ({ page }) => {
  const games = await openGames(page, 5);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(400);
  const game = games.find((g) => g.title.includes(" vs "));
  expect(game, "the account has a game titled Home vs Away").toBeTruthy();
  const [home, away] = game!.title.split(" vs ");
  const strip = tab(page, game!.title);
  const box = await boxOf(strip, "the tab");
  for (const [team, what] of [
    [home, "the home team"],
    [away, "the away team"],
  ] as const) {
    const part = await boxOf(strip.getByText(team, { exact: true }), what);
    expect(part.width, `${what} keeps some room in a narrow tab`).toBeGreaterThanOrEqual(20);
    expect(part.x + part.width, `${what} stays inside the tab, clear of the ×`).toBeLessThanOrEqual(box.x + box.width - 20);
  }
  expect(await strip.textContent(), "the tab still reads as the whole title").toBe(game!.title);
});

/** The tabs stand side by side from the strip's left edge, and the + follows the last one. */
async function expectTabsInLine(page: Page, when: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const strip = await boxOf(tablist(page), "the tab strip");
        const boxes = await tabs(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
        const add = await boxOf(plus(page), "the +");
        const problems: string[] = [];
        if (Math.abs(boxes[0].left - strip.x) > 1) problems.push(`the first tab starts ${Math.round(boxes[0].left - strip.x)}px from the strip's left`);
        for (let i = 1; i < boxes.length; i++) {
          const gap = boxes[i].left - boxes[i - 1].right;
          if (Math.abs(gap) > 1) problems.push(`tab ${i + 1} is ${Math.round(gap)}px from the tab before it`);
        }
        const after = add.x - boxes[boxes.length - 1].right;
        if (after < -1 || after > 24) problems.push(`the + is ${Math.round(after)}px from the last tab`);
        return problems;
      },
      { message: `the tabs are in line ${when}`, timeout: 5_000 },
    )
    .toEqual([]);
}

test("the tabs stay side by side from the left when one closes or another opens, without leaving the page", async ({ page, browserName }) => {
  const [g0, g1, g2] = await openGames(page, 3);
  await expectTabsInLine(page, "with three games open");

  // Close the middle one in place: the others close up, each where it belongs.
  await tab(page, g1.title).hover();
  await closeOf(page, g1.title).click();
  await expect(tabs(page)).toHaveCount(2);
  await expectTabsInLine(page, "after the middle tab closed");
  await shot(page, `${browserName}-I-tabs-after-close`);

  // Open it again through the +, in place: it takes its place at the end.
  await plus(page).click();
  await picker(page).getByRole("button").filter({ hasText: g1.title }).click();
  await expect(tabs(page)).toHaveCount(3);
  // The new tab says Loading… until its game is read.
  await expect.poll(() => titles(page), { timeout: 15_000 }).toEqual([g0.title, g2.title, g1.title]);
  await expectTabsInLine(page, "after a game opened from the +");

  // The first one closed by its own menu, and brought back.
  await tab(page, g0.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Tab", exact: true }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expectTabsInLine(page, "after the first tab closed");
  await menu(page, "menu-reopen-game-tab");
  await expect(tabs(page)).toHaveCount(3);
  await expectTabsInLine(page, "after the closed tab came back");
});

test("Close Tab waits while a dialog is open, and with no tab for the page on screen it goes to an open game", async ({ page }) => {
  const [g0, g1] = await openGames(page, 2);

  // The picker is open over the page: Close Tab is not for the page behind it.
  await plus(page).click();
  await expect(picker(page)).toBeVisible();
  await menu(page, "menu-close-game-tab");
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs(page), "nothing was closed behind the picker").toHaveCount(2);

  // A game that isn't there has no tab; the bar still shows the two that are open.
  await page.goto("/matches/00000000-0000-4000-8000-0000000000aa");
  await expect(tabs(page)).toHaveCount(2, { timeout: 30_000 });
  await menu(page, "menu-close-game-tab");
  await expect(heading(page), "Close Tab leaves the page with no tab for the game shown last").toHaveText(g1.title, { timeout: 15_000 });
  await expect(tabs(page), "and closes neither of the open games").toHaveCount(2);
  expect(await titles(page)).toEqual([g0.title, g1.title]);
});
