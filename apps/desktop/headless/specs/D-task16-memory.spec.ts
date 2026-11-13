/**
 * Group D, Task 16: a game comes back by its tab as it was left (filters,
 * quarter zoom, list scroll, view), its labels and "Adding to" don't flash,
 * a `?play=` link opens clean, and an add right after a switch lands once.
 * Makes its own target playlist and its own label (put on a few of the first
 * game's plays) and deletes both at the end; deleting the label takes its
 * assignments with it.
 */
import type { Page } from "@playwright/test";
import {
  addingCount,
  chooseNewTarget,
  deleteOwnedPlaylists,
  expect,
  openLibraryGame,
  owned,
  playlistClips,
  playRows,
  shot,
  showGameView,
  test,
} from "../helpers";

const TARGET = owned("target");
const LABEL = owned("chip");

const tablist = (page: Page) => page.getByRole("tablist", { name: "Open games" });
const tab = (page: Page, title: string) => tablist(page).getByRole("tab", { name: title, exact: true });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const plays = (page: Page) => page.getByRole("list", { name: "Plays" });
const teamRadios = (page: Page) => page.getByRole("radiogroup", { name: "Team" }).getByRole("radio");
const zoom = (page: Page) => page.getByRole("button", { name: "Timeline zoom" });

/**
 * Switches by the game's tab and waits for that game's page. The URL changes on
 * the press, but the router keeps the page it leaves on screen until the next
 * one has rendered (a transition): a click made before then lands on the old page.
 */
async function switchTo(page: Page, game: { title: string }): Promise<void> {
  await tab(page, game.title).click();
  await expect(heading(page)).toHaveText(game.title);
  await expect(tab(page, game.title)).toHaveAttribute("aria-selected", "true");
}

async function deleteOwnLabel(page: Page): Promise<void> {
  await page.evaluate(async (name) => {
    const { createClient } = await import("/src/lib/supabase/client.ts" as string);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const { error } = await sb.from("labels").delete().eq("user_id", auth.user!.id).eq("name", name);
    if (error) throw new Error(`headless: label cleanup failed: ${error.message}`);
  }, LABEL);
}

/** Puts this spec's own label on these plays of the game, in the game's space. */
async function labelPlays(page: Page, matchId: string, eventIds: number[]): Promise<void> {
  await page.evaluate(
    async ({ matchId, eventIds, name }) => {
      const { createClient } = await import("/src/lib/supabase/client.ts" as string);
      const labels = await import("/src/lib/labels-db.ts" as string);
      const { data } = await createClient().from("matches").select("org_id").eq("id", matchId).single();
      const orgId = (data as { org_id: string }).org_id;
      const label = await labels.createLabel(orgId, name, "orange");
      await labels.bulkAssign(orgId, eventIds.map((eventId) => ({ matchId, eventId })), label.id, "add");
    },
    { matchId, eventIds, name: LABEL },
  );
}

const eventOf = (key: string) => Number(key.slice(key.lastIndexOf(":") + 1));

/**
 * Samples every frame for `ms` while game `title` is on screen: is "Adding to"
 * the target, how many of this spec's label chips show, which team is
 * chosen and what the zoom says. Started before a switch, read after.
 */
async function startSampling(page: Page, title: string, ms: number): Promise<void> {
  await page.evaluate(
    ({ title, target, label, ms }) => {
      type Frame = { adding: boolean; chips: number; team: string | null; zoom: string | null };
      const w = window as unknown as { __frames: Frame[] };
      w.__frames = [];
      const until = performance.now() + ms;
      const tick = () => {
        if (document.querySelector("h1")?.textContent?.trim() === title && document.querySelector('[role="list"][aria-label="Plays"]')) {
          const list = document.querySelector('[role="list"][aria-label="Plays"]')!;
          w.__frames.push({
            adding: !!document.querySelector(`[aria-label="Adding to ${target}. Change playlist"]`),
            chips: [...list.querySelectorAll("span")].filter((s) => s.textContent === label && s.children.length === 0).length,
            team: document.querySelector('[role="radiogroup"][aria-label="Team"] [aria-checked="true"]')?.textContent ?? null,
            zoom: document.querySelector('[aria-label="Timeline zoom"]')?.textContent ?? null,
          });
        }
        if (performance.now() < until) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { title, target: TARGET, label: LABEL, ms },
  );
}
const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __frames: { adding: boolean; chips: number; team: string | null; zoom: string | null }[] }).__frames);

test.afterEach(async ({ page }) => {
  // The label goes even when the playlist delete throws.
  try {
    await deleteOwnedPlaylists(page, [TARGET]);
  } finally {
    await deleteOwnLabel(page);
  }
});

test("a game comes back by its tab as it was left", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-D-task16-${step}`;
  await page.goto("/matches");
  try {
    await deleteOwnedPlaylists(page, [TARGET]);
  } finally {
    await deleteOwnLabel(page);
  }

  // Game A with a target and a label on its first plays, read fresh (a reload, so the label is in its first read).
  const a = await openLibraryGame(page, 0);
  await showGameView(page);
  await chooseNewTarget(page, TARGET);
  const firstKeys = await playRows(page).evaluateAll((els) => els.slice(0, 12).map((e) => e.getAttribute("data-row-key")!));
  await labelPlays(page, a.id, firstKeys.map(eventOf));
  await page.goto(`/matches/${a.id}`);
  await showGameView(page);
  await expect(plays(page).getByText(LABEL, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: `Adding to ${TARGET}. Change playlist` })).toBeVisible();
  const allPlays = await playRows(page).count();

  // Game B, then back to A by its tab.
  const b = await openLibraryGame(page, 1);
  await showGameView(page);
  await switchTo(page, a);
  await expect(page.getByRole("radio", { name: "Game" })).toHaveAttribute("aria-checked", "true");

  // In A: one team, a play in Q3 playing, the zoom on Q3, and the list scrolled away from it.
  const home = teamRadios(page).nth(1);
  const homeName = (await home.innerText()).trim();
  await home.click();
  await expect(home).toHaveAttribute("aria-checked", "true");
  const q3Play = plays(page).locator('[data-row-key="period:3"] ~ div[data-row-key]').first();
  const q3Key = (await q3Play.getAttribute("data-row-key"))!;
  await q3Play.click();
  await expect(q3Play).toHaveAttribute("aria-current", "true");
  await zoom(page).click();
  await page.getByRole("menuitemradio", { name: "Q3", exact: true }).click();
  await expect(zoom(page)).toHaveText("Q3");
  await page.waitForTimeout(800); // past the list's own-scroll grace after the click
  await plays(page).evaluate((el) => el.scrollTo({ top: 600 }));
  await expect(page.getByRole("button", { name: "Jump to now" })).toBeVisible();
  const leftAt = await plays(page).evaluate((el) => el.scrollTop);
  expect(leftAt).toBeGreaterThan(300);
  const chipsLeft = await plays(page).getByText(LABEL, { exact: true }).count();
  expect(chipsLeft, "some of the labelled plays are listed under the team filter").toBeGreaterThan(0);
  await shot(page, name("a-left"));

  // To B and back: from the first frame A is drawn, the target, the chips, the team and the zoom are all there.
  await switchTo(page, b);
  await startSampling(page, a.title, 1_500);
  await tab(page, a.title).click();
  await expect(heading(page)).toHaveText(a.title, { timeout: 1_500 });
  await page.waitForTimeout(1_600);
  const seen = await frames(page);
  expect(seen.length, "frames sampled while A was shown").toBeGreaterThan(5);
  expect(seen.filter((f) => !f.adding), "frames without \"Adding to\" the target").toEqual([]);
  expect(seen.filter((f) => f.chips === 0), "frames without the label chips").toEqual([]);
  expect(seen.filter((f) => f.team?.trim() !== homeName), "frames with another team chosen").toEqual([]);
  expect(seen.filter((f) => f.zoom?.trim() !== "Q3"), "frames with another zoom").toEqual([]);
  // And the list is where it was left, not following.
  const backAt = await plays(page).evaluate((el) => el.scrollTop);
  expect(Math.abs(backAt - leftAt), `list scroll back at ${backAt}, left at ${leftAt}`).toBeLessThanOrEqual(40);
  // No "Jump to now" here: without footage there is no current play to come back to (the position
  // memory is the video's time, kept only while footage plays), so the list has nothing to point at.
  await expect(plays(page).getByText(LABEL, { exact: true })).toHaveCount(chipsLeft);
  await shot(page, name("a-back"));

  // A left on Details comes back on Details.
  await page.getByRole("radio", { name: "Details" }).click();
  await expect(page.getByRole("radio", { name: "Details" })).toHaveAttribute("aria-checked", "true");
  await switchTo(page, b);
  await switchTo(page, a);
  await expect(page).toHaveURL(new RegExp(`/matches/${a.id}$`));
  await expect(page.getByRole("radio", { name: "Details" })).toHaveAttribute("aria-checked", "true");
  await shot(page, name("a-details-back"));

  // A link to a play (in-app, from B, so the remembered filters and zoom are still in memory) opens without them.
  await switchTo(page, b);
  await page.evaluate((url) => {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/matches/${a.id}?play=${eventOf(q3Key)}`);
  await expect(heading(page)).toHaveText(a.title);
  await expect(page.getByRole("radio", { name: "Game" })).toHaveAttribute("aria-checked", "true");
  await expect(teamRadios(page).nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(zoom(page)).toHaveText("Whole game");
  // Every play listed (no team, no moment), and the list not put back where A's last visit left it.
  await expect(playRows(page)).toHaveCount(allPlays);
  await expect(plays(page).locator(`[data-row-key="${q3Key}"]`)).toBeAttached();
  expect(await plays(page).evaluate((el) => el.scrollTop), "the list isn't restored to A's remembered scroll").toBeLessThan(leftAt / 2);
  // Not asserted: the linked play being current and scrolled to. Placing the playhead at a linked play
  // needs footage (game-watch-view's placement effect returns without it), and this game's video isn't here.
  await shot(page, name("play-link"));

  // An add right after a switch lands once: one check, the count goes to 1, the server holds it once.
  await switchTo(page, b);
  // The add is pressed as soon as A is drawn, with its playlists read again behind it.
  await switchTo(page, a);
  const row = playRows(page).nth(20);
  await row.getByRole("button", { name: `Add to ${TARGET}`, exact: true }).click();
  const added = (await row.getAttribute("data-row-key"))!;
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: `Added to ${TARGET}` })).toBeVisible();
  await expect(row.getByRole("button", { name: `In ${TARGET}. Remove`, exact: true })).toBeVisible();
  await page.waitForTimeout(2_500); // the background read lands behind the add
  await expect(plays(page).getByRole("button", { name: `In ${TARGET}. Remove`, exact: true })).toHaveCount(1);
  await expect(addingCount(page, TARGET)).toHaveText("1");
  await expect.poll(() => playlistClips(page, TARGET), { message: "the target holds the play once" }).toEqual([
    { matchId: a.id, eventId: eventOf(added) },
  ]);
  await shot(page, name("add-after-switch"));
});
