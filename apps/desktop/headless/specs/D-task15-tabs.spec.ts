/**
 * Group D, Task 15: open games sit as rows in the sidebar and switch without
 * loading (the rows' own look and their +, drag and Close Tab are in
 * I-game-tabs.spec.ts). Opens the test account's games from the Library inside
 * the app (no reload, so the session's caches are what a coach has), steps
 * with ⌃Tab / ⌃⇧Tab (Control in both browsers: the page reads `ctrlKey` and
 * `key === "Tab"`), closes by × and by middle click, and renames one game's
 * title on Details for the blur-before-navigate fix: the title is restored
 * in `finally`, whatever happens.
 */
import type { Page } from "@playwright/test";
import { expect, openLibraryGame, owned, shot, showGameView, test } from "../helpers";

// The open games: rows in the sidebar (components/shell/open-games.tsx).
const tablist = (page: Page) => page.getByRole("navigation", { name: "Open games" });
const tab = (page: Page, title: string) => tablist(page).getByRole("button", { name: title, exact: true });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** From here on, notes whether the game page's spinner ("Loading the game…") is ever put on the page. */
async function watchForSpinner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sawSpinner: boolean; __spinnerWatch?: MutationObserver };
    w.__sawSpinner = false;
    w.__spinnerWatch?.disconnect();
    w.__spinnerWatch = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n.textContent?.includes("Loading the game")) w.__sawSpinner = true;
      }
    });
    w.__spinnerWatch.observe(document.body, { childList: true, subtree: true });
  });
}
const sawSpinner = (page: Page) => page.evaluate(() => (window as unknown as { __sawSpinner: boolean }).__sawSpinner);

/** The game's title as the server holds it, read through the app's own client. */
const titleOnServer = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const { data } = await createClient().from("matches").select("title").eq("id", id).single();
    return (data as { title: string } | null)?.title ?? null;
  }, id);

/** The game this spec renamed and its title before, until the title is back on the server. */
let renamedGame: { id: string; original: string } | null = null;

/**
 * Writes the original title back and waits until the server holds it. A blur-save
 * of the field can land after the first write, so each read that still differs writes again.
 */
async function restoreTitle(page: Page): Promise<void> {
  const game = renamedGame;
  if (!game) return;
  const write = () =>
    page.evaluate(
      async ({ id, title }) => {
        const { updateMatchMeta } = await import("/src/lib/matches-db.ts" as string);
        await updateMatchMeta(id, { title });
      },
      { id: game.id, title: game.original },
    );
  await write();
  await expect
    .poll(
      async () => {
        const now = await titleOnServer(page, game.id);
        if (now !== game.original) await write();
        return now;
      },
      { message: "the renamed game's title is back on the server", timeout: 15_000 },
    )
    .toBe(game.original);
  renamedGame = null;
}

test.afterEach(async ({ page }) => {
  await restoreTitle(page);
});

test("games open in tabs, switch without loading, and close", { tag: "@alone" }, async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-D-task15-${step}`;

  // One game: one tab.
  const g0 = await openLibraryGame(page, 0);
  await showGameView(page);
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(1);

  // The second game is a second row, and the one selected.
  const g1 = await openLibraryGame(page, 1);
  await showGameView(page);
  await expect(tablist(page)).toBeVisible();
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(2);
  await expect(tab(page, g1.title)).toHaveAttribute("aria-current", "page");
  await shot(page, name("two-tabs"));

  const g2 = await openLibraryGame(page, 2);
  await showGameView(page);
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(3);
  // The newest game is on top.
  await expect(tablist(page).locator("button[data-open-game]")).toHaveText([g2.title, g1.title, g0.title]);

  // A click switches at once: the game's own title, its play list, and no spinner on the way.
  await watchForSpinner(page);
  await tab(page, g0.title).click();
  await expect(heading(page)).toHaveText(g0.title, { timeout: 5_000 });
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 5_000 });
  await expect(tab(page, g0.title)).toHaveAttribute("aria-current", "page");
  await tab(page, g2.title).click();
  await expect(heading(page)).toHaveText(g2.title, { timeout: 5_000 });
  await expect(page.getByRole("list", { name: "Plays" })).toBeVisible({ timeout: 5_000 });
  expect(await sawSpinner(page), "no \"Loading the game…\" on a tab switch").toBe(false);
  await shot(page, name("switched"));

  // ⌃Tab and ⌃⇧Tab step in list order (g2, g1, g0) and wrap at both ends.
  await page.keyboard.press("Control+Shift+Tab"); // g2 → g0, wrapping back
  await expect(heading(page)).toHaveText(g0.title, { timeout: 5_000 });
  await page.keyboard.press("Control+Tab"); // g0 → g2, wrapping forward
  await expect(heading(page)).toHaveText(g2.title, { timeout: 5_000 });
  await page.keyboard.press("Control+Tab"); // g2 → g1
  await expect(heading(page)).toHaveText(g1.title, { timeout: 5_000 });
  expect(await sawSpinner(page), "no spinner on a key switch either").toBe(false);
  await expect(tab(page, g1.title)).toHaveAttribute("aria-current", "page");

  // Rename on Details, then ⌃Tab without leaving the field: the switch saves it, and the tab follows.
  const original = await titleOnServer(page, g1.id);
  expect(original, "the second game's title is readable").toBeTruthy();
  const renamed = owned(`renamed ${Date.now() % 100000}`);
  renamedGame = { id: g1.id, original: original! };
  try {
    await page.getByRole("radio", { name: "Details" }).click();
    const field = page.locator("#game-title");
    await expect(field).toHaveValue(original!, { timeout: 15_000 });
    await field.fill(renamed);
    await expect(field).toBeFocused();
    await page.keyboard.press("Control+Tab"); // g1 → g0, straight from the field
    await expect(heading(page)).toHaveText(g0.title, { timeout: 5_000 });
    await expect.poll(() => titleOnServer(page, g1.id), { message: "the title typed before the switch is saved" }).toBe(renamed);
    await expect(tab(page, renamed)).toBeVisible({ timeout: 10_000 });
    await shot(page, name("renamed-tab"));
    // Back by ⌃⇧Tab: the game was left on Details, and comes back there with the new title.
    await page.keyboard.press("Control+Shift+Tab");
    await expect(page.getByRole("radio", { name: "Details" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#game-title")).toHaveValue(renamed);
  } finally {
    // Also in afterEach: whichever runs first puts it back, the other finds nothing to do.
    await restoreTitle(page);
  }
  await expect(tab(page, original!)).toBeVisible({ timeout: 10_000 });

  // The account's other games, five tabs in all (it has five games: the seventh-game eviction can't be reached).
  const g3 = await openLibraryGame(page, 3);
  const g4 = await openLibraryGame(page, 4);
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(5);

  // At 1024 wide the five rows are all in the sidebar.
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.waitForTimeout(400);
  for (const box of await tablist(page).locator("button[data-open-game]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom))) {
    expect(box, "each of five rows is inside the window").toBeLessThanOrEqual(700);
  }
  await shot(page, name("five-tabs-1024"));
  await page.setViewportSize({ width: 1440, height: 900 });

  // Close another tab by its × (shown on hover) and one by a middle click: the shown game stays.
  await tab(page, g0.title).hover();
  await tablist(page).getByRole("button", { name: `Close ${g0.title}` }).click();
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(4);
  await tab(page, g1.title).click({ button: "middle" });
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(3);
  await expect(page).toHaveURL(new RegExp(`/matches/${g4.id}$`));
  await expect(tablist(page).locator("button[data-open-game]")).toHaveText([g4.title, g3.title, g2.title]);
  await shot(page, name("closed-two"));

  // Close the shown game's tab (the first one): the one under it shows.
  await tab(page, g4.title).hover();
  await tablist(page).getByRole("button", { name: `Close ${g4.title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/matches/${g3.id}$`));
  await expect(tab(page, g3.title)).toHaveAttribute("aria-current", "page");
  await expect(tablist(page).locator("button[data-open-game]")).toHaveCount(2);
  await shot(page, name("closed-current"));
});
