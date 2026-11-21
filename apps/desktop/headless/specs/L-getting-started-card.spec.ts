/**
 * Getting started lives at the bottom of the sidebar (docs/superpowers/specs/2026-11-21-retire-home-design.md,
 * "Getting started, in the sidebar"): a card with the progress and the next step, which opens the checklist
 * in a popover when pressed and never by itself, and whose × dismisses it for good.
 *
 * The test account dismissed its checklist long ago, so the page is told otherwise: the profile read answers
 * with no dismissal, and the dismissal the app writes is answered here and never reaches staging (a reload
 * then reads it back, as the server would). The space's reads are trimmed to no playlists and only the sample
 * game, so the checklist has steps left and the import step (which writes nothing) is open. For a club admin's
 * steps the account's own space is told it is a club it administers (as in L-shared-invite.spec.ts), and the team
 * it creates is answered here. Nothing is written.
 */
import type { Page, Route } from "@playwright/test";
import { expect, owned, shot, test, waitForQuiet } from "../helpers";

/** What the profile read is answered with, over the account's own row; the app's writes of these land here. */
interface ProfileAnswers {
  onboarding_checklist_dismissed_at: string | null;
  /** Left out: the account's own role. */
  declared_role?: string | null;
}

/**
 * Answers the profile with an un-dismissed checklist until the app dismisses it. The app's writes of the
 * dismissal and of the role are answered here, never reaching staging, and read back from then on.
 */
async function freshChecklist(page: Page): Promise<ProfileAnswers> {
  const answers: ProfileAnswers = { onboarding_checklist_dismissed_at: null };
  await page.route("**/rest/v1/profiles*", async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === "PATCH") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      if (!("onboarding_checklist_dismissed_at" in body) && !("declared_role" in body)) return route.fallback();
      Object.assign(answers, body);
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() !== "GET" || !url.includes("onboarding_checklist_dismissed_at")) return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
    const patch = (row: Record<string, unknown>) => ({ ...row, ...answers });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) });
  });
  return answers;
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

let profile: ProfileAnswers;

test.beforeEach(async ({ page }) => {
  profile = await freshChecklist(page);
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

test("answering the role question keeps the checklist open", async ({ page, browserName }) => {
  // An OAuth signup: no role yet, so the checklist asks first.
  profile.declared_role = null;
  await waitForQuiet(page);
  await page.reload();
  await card(page).click();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page).getByText("What describes you best?", { exact: true })).toBeVisible();
  await popover(page).getByRole("button", { name: /^Coach/ }).click();
  await expect.poll(() => profile.declared_role, { message: "the role was written" }).toBe("coach");
  await expect(popover(page).getByText("What describes you best?", { exact: true }), "the question is answered").toBeHidden();
  await waitForQuiet(page);
  await expect(popover(page), "the checklist stays open").toBeVisible();
  await expect(popover(page).getByRole("button", { name: /^Build your first playlist/ })).toBeEnabled();
  await shot(page, `${browserName}-L-getting-started-role-answered`);
});

test("× on the card dismisses it for good", async ({ page }) => {
  // The × sits on the card and shows while it's hovered (the update card, the sidebar's other ×, never shows here).
  await card(page).hover();
  const close = page.locator("aside").getByRole("button", { name: "Dismiss", exact: true });
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await expect(card(page), "the card is gone").toBeHidden();
  await expect.poll(() => profile.onboarding_checklist_dismissed_at, { message: "the dismissal was written" }).not.toBeNull();
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

test("a club admin's first team ticks its step at once", async ({ page, browserName }) => {
  // The account's own space as a club it administers, with no teams yet. The team the dialog creates is
  // answered here and read back from then on; the sample-game seeding for the club is answered here too.
  const teams: Record<string, unknown>[] = [];
  await page.route("**/rpc/get_my_orgs*", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({ response, json: rows.map((r) => ({ ...r, is_personal: false, role: "admin" })) });
  });
  await page.route("**/rpc/seed_demo_match*", (route) => route.fulfill({ status: 200, json: null }));
  await page.route("**/rest/v1/teams*", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, json: teams });
  });
  await page.route("**/rpc/create_team_for_org*", async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as { team_name?: string; team_season?: string | null; p_org_id?: string | null };
    const id = "00000000-0000-4000-8000-0000000007ea";
    teams.push({ id, org_id: body.p_org_id, name: body.team_name, sport: "basketball", season: body.team_season ?? null, created_at: new Date().toISOString() });
    await route.fulfill({ status: 200, json: id });
  });
  await waitForQuiet(page);
  await page.goto("/matches");
  await expect(card(page)).toContainText("Create your first team", { timeout: 30_000 });
  const before = (await card(page).innerText()).match(/(\d+) of (\d+)/);
  expect(before, "the card shows its progress").not.toBeNull();

  await card(page).click();
  await popover(page).getByRole("button", { name: /^Create your first team/ }).click();
  await expect(page).toHaveURL(/\/organization$/);
  const dialog = page.getByRole("dialog", { name: "New team" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Name", { exact: true }).fill(owned("team"));
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(dialog).toBeHidden();
  expect(teams, "the team was created (here, not on staging)").toHaveLength(1);

  // The card stays mounted all session: it reads the club's setup again without a reload.
  await expect(card(page), "the step is done").not.toContainText("Create your first team");
  await expect(card(page)).toContainText(`${Number(before![1]) + 1} of ${before![2]}`);
  await card(page).click();
  await expect(popover(page).getByRole("button", { name: /^Create your first team/ }), "ticked in the checklist").toBeDisabled();
  await shot(page, `${browserName}-L-getting-started-team-ticked`);
});

