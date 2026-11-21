/**
 * Getting started lives at the bottom of the sidebar (docs/superpowers/specs/2026-11-21-retire-home-design.md,
 * "Getting started, in the sidebar"): a card with the progress and the next step, which opens the checklist
 * in a popover when pressed and never by itself, and whose × dismisses it for good.
 *
 * The test account dismissed its checklist long ago, so the page is told otherwise: the profile read answers
 * with no dismissal, and the dismissal the app writes is answered here and never reaches staging (a reload
 * then reads it back, as the server would). The space's reads are trimmed to no playlists and only the sample
 * game, so the checklist has steps left and the import step (which writes nothing) is open. Nothing is written.
 */
import type { Page, Route } from "@playwright/test";
import { expect, shot, test, waitForQuiet } from "../helpers";

/** Answers the profile with an un-dismissed checklist until the app dismisses it; returns whether it has. */
async function freshChecklist(page: Page): Promise<() => string | null> {
  let dismissedAt: string | null = null;
  await page.route("**/rest/v1/profiles*", async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === "PATCH" && (request.postData() ?? "").includes("onboarding_checklist_dismissed_at")) {
      const body = request.postDataJSON() as { onboarding_checklist_dismissed_at?: string };
      dismissedAt = body.onboarding_checklist_dismissed_at ?? new Date().toISOString();
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() !== "GET" || !url.includes("onboarding_checklist_dismissed_at")) return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
    const patch = (row: Record<string, unknown>) => ({ ...row, onboarding_checklist_dismissed_at: dismissedAt });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) });
  });
  return () => dismissedAt;
}

/** The space as the page is told it: no playlists, and of the games only the sample. */
async function earlySpace(page: Page): Promise<void> {
  const keep = (filter: (rows: Record<string, unknown>[]) => Record<string, unknown>[]) => async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    await route.fulfill({ response, json: Array.isArray(body) ? filter(body as Record<string, unknown>[]) : body });
  };
  await page.route("**/rest/v1/playlists*", keep(() => []));
  await page.route("**/rest/v1/matches*", keep((rows) => rows.filter((r) => r.is_demo === true)));
}

const card = (page: Page) => page.locator("aside").getByRole("button", { name: /^Getting started/ });
const popover = (page: Page) => page.getByRole("dialog").filter({ hasText: "Welcome to Scoutable" });

let dismissed: () => string | null;

test.beforeEach(async ({ page }) => {
  dismissed = await freshChecklist(page);
  await earlySpace(page);
  await page.goto("/matches");
  await expect(card(page), "the card is in the sidebar").toBeVisible({ timeout: 30_000 });
});

test("the card shows progress and the next step", async ({ page, browserName }) => {
  await expect(card(page)).toContainText(/\d+ of \d+/);
  // The next step is the first open one in the checklist that isn't locked.
  await card(page).click();
  await expect(popover(page)).toBeVisible();
  const next = await popover(page).evaluate((root) => {
    for (const button of root.querySelectorAll<HTMLButtonElement>("ul li button")) {
      if (button.disabled || button.querySelector(".lucide-lock")) continue;
      return button.querySelector("span.block")?.textContent ?? null;
    }
    return null;
  });
  expect(next, "the checklist has a step left").not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect(card(page)).toContainText(next!);
  await shot(page, `${browserName}-L-getting-started-card`);
});

test("pressing it opens the checklist, and a step closes it and goes there", async ({ page, browserName }) => {
  await card(page).click();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page).getByRole("button", { name: /Create your account/ })).toBeDisabled();
  await popover(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await shot(page, `${browserName}-L-getting-started-popover`);
  await popover(page).getByRole("button", { name: /^Import your own game/ }).click();
  await expect(popover(page), "the step closes the checklist").toBeHidden();
  await expect(page).toHaveURL(/\/upload$/);
});

test("× on the card dismisses it for good", async ({ page }) => {
  // The × sits on the card and shows while it's hovered (the update card, the sidebar's other ×, never shows here).
  await card(page).hover();
  const close = page.locator("aside").getByRole("button", { name: "Dismiss", exact: true });
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await expect(card(page), "the card is gone").toBeHidden();
  await expect.poll(dismissed, { message: "the dismissal was written" }).not.toBeNull();
  await waitForQuiet(page);
  await page.reload();
  await expect(page.locator("aside").getByRole("navigation", { name: "Main" })).toBeVisible({ timeout: 30_000 });
  await waitForQuiet(page);
  await expect(card(page), "it stays gone after a reload").toBeHidden();
});

test("it never opens by itself", async ({ page }) => {
  // Where the app lands after sign-in, loaded afresh.
  await waitForQuiet(page);
  await page.goto("/");
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await waitForQuiet(page);
  await page.waitForTimeout(1000);
  await expect(popover(page)).toBeHidden();
  await expect(page.getByText("Welcome to Scoutable")).toHaveCount(0);
});
