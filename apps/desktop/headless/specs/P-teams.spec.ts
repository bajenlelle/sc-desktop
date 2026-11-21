/**
 * The Teams pages (docs/teams.md): the league's table and a team's page, on a
 * made-up league (headless/team-league.ts) the genius function's answers are
 * mocked with, so nothing depends on real standings.
 */
import type { Page } from "@playwright/test";
import { expect, mockLeague, shot, test } from "../helpers";
import { madeUpLeague } from "../team-league";

const teamRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

test("the league table lists every team and opens one", async ({ page, browserName }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible({ timeout: 30_000 });
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(7); // the header and six teams
  await expect(rows.nth(1)).toContainText("Alfa");
  await expect(page.getByText("Your next game")).toHaveCount(0); // the made-up league holds no team of the space
  await expect(page.getByText("Your team", { exact: true })).toHaveCount(0);
  await shot(page, `${browserName}-P-teams-league`);
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page).toHaveURL(/\/teams\/\d+\/1$/);
});

test("Teams is a row in the sidebar", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Teams", exact: true }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(nav.getByRole("link", { name: "Teams", exact: true })).toHaveAttribute("aria-current", "page");
});

test("two groups make two titled tables", async ({ page }) => {
  await mockLeague(page, madeUpLeague({ groups: { Norra: [1, 2, 3], Södra: [4, 5, 6] } }));
  await page.goto("/teams");
  await expect(page.getByRole("table")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Norra" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Södra" })).toBeVisible();
  await expect(teamRow(page, "Delta")).toContainText("1"); // first in Södra
});

test("a failed read and an older function say so", async ({ page }) => {
  await mockLeague(page, { season: "fail", fixtures: [] });
  await page.goto("/teams");
  await expect(page.getByText("Couldn't load the league.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await mockLeague(page, { season: "unknown", fixtures: [] });
  await page.reload();
  await expect(page.getByText("This league has no team statistics.")).toBeVisible({ timeout: 30_000 });
});
