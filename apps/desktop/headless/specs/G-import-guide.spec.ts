/**
 * The first-import guide on the Import game page
 * (src/components/import/import-guide.tsx): it follows what the coach does
 * through four steps, lights the step's area, rings the button to press, and
 * never covers what it lights. It starts by itself only for a coach who has
 * never imported a game.
 *
 * Reads only. It never presses Import game: that writes an import-log row no
 * spec can delete, on an account every worktree shares.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, shot, test } from "../helpers";

// The app's default window (src-tauri/tauri.conf.json).
test.use({ viewport: { width: 1280, height: 720 } });

const guide = (page: Page) => page.locator(".import-guide-root");
const bubble = (page: Page) => page.getByRole("complementary", { name: "Import guide" });
const showGuide = (page: Page) => page.getByRole("button", { name: "Show guide" });

/** Import game, loaded far enough that the guide could show (its leagues are in). */
async function openImport(page: Page) {
  await page.goto("/upload");
  await expect(page.getByRole("heading", { level: 1, name: "Import game" })).toBeVisible();
  await expect(page.locator('[data-tour="pick"]')).toBeVisible({ timeout: 30_000 });
}

/** The import log answers "no games yet", as it does for a brand-new coach. */
async function pretendNoImports(page: Page) {
  await page.route("**/rest/v1/import_log*", async (route) => {
    if (route.request().method() !== "HEAD") return route.fallback();
    await route.fulfill({
      status: 200,
      headers: {
        "content-range": "*/0",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range",
      },
    });
  });
}

/** A screenshot once the guide's fades and the page's scroll have come to rest. */
async function shotAtRest(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  await page.waitForTimeout(600);
  await shot(page, name);
}

async function expectStep(page: Page, step: string, n: number, title: string) {
  await expect(guide(page)).toHaveAttribute("data-guide-step", step, { timeout: 30_000 });
  await expect(bubble(page)).toContainText(title);
  await expect(bubble(page)).toContainText(`Step ${n} of 4`);
}

/** The bubble is fully on screen and does not lie over the area it explains. */
async function expectBubbleBesideLitArea(page: Page, area: Locator) {
  await expect(bubble(page)).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const b = await bubble(page).boundingBox();
      const a = await area.boundingBox();
      if (!b || !a) return "missing";
      const apart = b.x >= a.x + a.width || b.x + b.width <= a.x || b.y >= a.y + a.height || b.y + b.height <= a.y;
      return apart ? "apart" : "overlapping";
    })
    .toBe("apart");
}

/** Picks the first game of the list under All games (the account may or may not have a team). */
async function pickFirstGame(page: Page) {
  const allGames = page.getByRole("tab", { name: "All games" });
  if (await allGames.isVisible()) await allGames.click();
  const row = page.locator('[data-tour="pick"] .max-h-72 button').first();
  await expect(row, "the league has a finished game to pick").toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText(/plays ready to clip\./)).toBeVisible({ timeout: 30_000 });
}

test("the guide follows a first import step by step", async ({ page, browserName }) => {
  const name = (step: string) => `import-guide-${browserName}-${step}`;
  await openImport(page);

  // An account with imports gets no guide by itself; the toolbar opens it.
  await expect(bubble(page)).toHaveCount(0);
  await showGuide(page).click();
  await expect(showGuide(page)).toHaveCount(0);

  // Step 1: the whole card is lit, no button is ringed, the bubble sits in the margin.
  const pick = page.locator('[data-tour="pick"]');
  await expectStep(page, "pick", 1, "Pick the game in your recording");
  await expect(guide(page)).toHaveAttribute("data-guide-side", "margin");
  await expectBubbleBesideLitArea(page, pick);
  await shotAtRest(page, name("1-pick"));
  await page.emulateMedia({ colorScheme: "dark" });
  await shotAtRest(page, name("1-pick-dark"));
  await page.emulateMedia({ colorScheme: "light" });

  // Step 2: picking a game moves it on by itself, and rings the video button.
  await pickFirstGame(page);
  const video = page.locator('[data-tour="video"]');
  await expectStep(page, "video", 2, "Choose the recording");
  await expect(page.locator('[data-tour="video-pick"]')).toHaveCSS("outline-style", "solid");
  await expectBubbleBesideLitArea(page, video);
  await shotAtRest(page, name("2-video"));

  // The washed-out part still takes clicks: Change sends the guide back a step.
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expectStep(page, "pick", 1, "Pick the game in your recording");
  await pickFirstGame(page);
  await expectStep(page, "video", 2, "Choose the recording");

  // Step 3: the video is chosen (the mock's dialog answers with the fixture).
  await page.locator('[data-tour="video-pick"]').click();
  await expectStep(page, "tipoff", 3, "Set the tip-off");
  const setTipoff = page.locator('[data-tour="tipoff-set"]');
  await expect(setTipoff).toBeEnabled({ timeout: 30_000 });
  await expect(setTipoff).toHaveCSS("outline-style", "solid");
  await expect(setTipoff, "the page scrolls the ringed button into view").toBeInViewport({ ratio: 1 });
  await expectBubbleBesideLitArea(page, video);
  await shotAtRest(page, name("3-tipoff"));

  // The two-minute fixture is far shorter than a game, so the page asks for
  // the quarters next and the guide stays on this step with them.
  await setTipoff.click();
  await expectStep(page, "tipoff", 3, "Set where the quarters start");
  await shotAtRest(page, name("3-quarters"));
  await page.locator("#breaks-cut").click();

  // Step 4: everything is set; the import button is ringed. Not pressed.
  const submit = page.locator('[data-tour="submit"]');
  await expectStep(page, "import", 4, "Import the game");
  await expect(page.locator('[data-tour="submit-button"]')).toHaveCSS("outline-style", "solid");
  await expect(page.locator('[data-tour="submit-button"]')).toBeEnabled();
  await expectBubbleBesideLitArea(page, submit);
  await shotAtRest(page, name("4-import"));

  // Hiding it brings the toolbar button back and leaves the page as it was.
  await bubble(page).getByRole("button", { name: "Hide guide" }).click();
  await expect(bubble(page)).toHaveCount(0);
  await expect(guide(page)).not.toHaveAttribute("data-guide-step", /.+/);
  await expect(showGuide(page)).toBeVisible();
  await expect(page.getByText("Ready to import.")).toBeVisible();
});

test("it starts by itself for a coach with no imports, and Skip guide is for good", async ({ page }) => {
  await pretendNoImports(page);
  await openImport(page);
  await expectStep(page, "pick", 1, "Pick the game in your recording");

  await bubble(page).getByRole("button", { name: "Skip guide" }).click();
  await expect(bubble(page)).toHaveCount(0);

  await page.reload();
  await expect(showGuide(page)).toBeVisible({ timeout: 30_000 });
  await expect(bubble(page)).toHaveCount(0);
});

test("Escape closes it for this visit only", async ({ page }) => {
  await pretendNoImports(page);
  await openImport(page);
  await expectStep(page, "pick", 1, "Pick the game in your recording");

  await page.keyboard.press("Escape");
  await expect(bubble(page)).toHaveCount(0);
  await expect(showGuide(page)).toBeVisible();

  await page.reload();
  await expectStep(page, "pick", 1, "Pick the game in your recording");
});

test("a coach who has imported a game is left alone, and it is remembered", async ({ page, browserName }) => {
  await openImport(page);
  await expect(showGuide(page)).toBeVisible({ timeout: 30_000 });
  await shotAtRest(page, `import-guide-${browserName}-0-launcher`);
  // The real import log says this account has games: no guide, and the device remembers.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("scoutable_import_guide_done:"))))
    .toBe(true);
  await expect(bubble(page)).toHaveCount(0);
});

test.describe("in the smallest window", () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test("the bubble hangs below the lit area and is scrolled into view", async ({ page, browserName }) => {
    const name = (step: string) => `import-guide-${browserName}-narrow-${step}`;
    await openImport(page);
    await showGuide(page).click();

    await expectStep(page, "pick", 1, "Pick the game in your recording");
    await expect(guide(page)).toHaveAttribute("data-guide-side", "below");
    // The list arrives after the guide and pushes the bubble down: the page follows it.
    await expect(page.locator('[data-tour="pick"] .max-h-72 button').first()).toBeVisible({ timeout: 30_000 });
    await expectBubbleBesideLitArea(page, page.locator('[data-tour="pick"]'));
    await shotAtRest(page, name("1-pick"));

    await pickFirstGame(page);
    await page.locator('[data-tour="video-pick"]').click();
    await expectStep(page, "tipoff", 3, "Set the tip-off");
    await expect(page.locator('[data-tour="tipoff-set"]')).toBeEnabled({ timeout: 30_000 });
    await expectBubbleBesideLitArea(page, page.locator('[data-tour="video"]'));
    await shotAtRest(page, name("3-tipoff"));
  });
});
