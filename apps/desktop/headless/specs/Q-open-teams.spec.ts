/**
 * The open teams (docs/teams.md, "Open teams"): a team becomes a row under
 * "Open teams" in the sidebar when its page is visited, the team on screen is
 * the selected row (and Teams is not), a row opens its team as it was left,
 * × closes it (to the next open team, else Teams), and the rows are back after
 * the app is quit. On the made-up league (headless/team-league.ts); it writes
 * nothing: the open teams live in the browser's storage.
 */
import type { Page } from "@playwright/test";
import { expect, mockLeague, test } from "../helpers";
import { madeUpLeague } from "../team-league";

const nav = (page: Page) => page.getByRole("navigation", { name: "Open teams" });
const row = (page: Page, name: string) => nav(page).getByRole("button", { name, exact: true });
const titles = (page: Page) => nav(page).locator("button[data-open-tab]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
const teamsLink = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Teams", exact: true });

/** Opens a team from the league table, as a coach does: through the sidebar's Teams once the app is up (a page load would forget how teams were left). */
async function openTeam(page: Page, name: string) {
  if (page.url().startsWith("http")) await teamsLink(page).click();
  else await page.goto("/teams");
  await page.getByRole("main").getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await mockLeague(page, madeUpLeague());
});

test("a visited team is an open team, selected while it is on screen", async ({ page }) => {
  await page.goto("/teams");
  await expect(page.getByRole("table")).toBeVisible({ timeout: 30_000 });
  await expect(nav(page)).toHaveCount(0); // none open yet: no caption
  await openTeam(page, "Alfa");
  await expect(row(page, "Alfa")).toHaveAttribute("aria-current", "page");
  await expect(teamsLink(page)).not.toHaveAttribute("aria-current", "page");
  await teamsLink(page).click();
  await expect(row(page, "Alfa")).not.toHaveAttribute("aria-current", "page");
  await expect(teamsLink(page)).toHaveAttribute("aria-current", "page");
});

test("a row opens its team as it was left", async ({ page }) => {
  await openTeam(page, "Alfa");
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page).toHaveURL(/view=plays/);
  await openTeam(page, "Beta");
  await expect.poll(() => titles(page)).toEqual(["Alfa", "Beta"]);
  await row(page, "Alfa").click();
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible();
  await expect(page).toHaveURL(/\/teams\/\d+\/1\?view=plays$/);
  await expect(page.getByRole("radio", { name: "Plays" })).toBeChecked();
  await row(page, "Beta").click();
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Season" })).toBeChecked();
});

test("closing the team on screen goes to the next open team, the last to Teams", async ({ page }) => {
  await openTeam(page, "Alfa");
  await openTeam(page, "Beta");
  await row(page, "Alfa").click();
  await expect(row(page, "Alfa")).toHaveAttribute("aria-current", "page");
  await row(page, "Alfa").hover();
  await page.getByRole("button", { name: "Close Alfa", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(["Beta"]);
  await row(page, "Beta").hover();
  await page.getByRole("button", { name: "Close Beta", exact: true }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(nav(page)).toHaveCount(0);
});

test("closing a team that isn't on screen stays where it is", async ({ page }) => {
  await openTeam(page, "Alfa");
  await openTeam(page, "Beta");
  await row(page, "Alfa").hover();
  await page.getByRole("button", { name: "Close Alfa", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(["Beta"]);
});

test("a row's menu closes the other teams", async ({ page }) => {
  await openTeam(page, "Alfa");
  await openTeam(page, "Beta");
  await openTeam(page, "Gamma");
  await row(page, "Beta").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close Other Tabs" }).click();
  await expect.poll(() => titles(page)).toEqual(["Beta"]);
  await expect(page.getByRole("heading", { level: 1, name: "Beta" })).toBeVisible();
});

test("the open teams are back after the app is quit", async ({ page }) => {
  await openTeam(page, "Alfa");
  await openTeam(page, "Beta");
  await page.goto("/teams");
  await page.reload();
  await expect(nav(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => titles(page)).toEqual(["Alfa", "Beta"]);
});

test("the open games keep their own list", async ({ page }) => {
  await openTeam(page, "Alfa");
  await expect(page.getByRole("navigation", { name: "Open games" })).toHaveCount(0);
});
