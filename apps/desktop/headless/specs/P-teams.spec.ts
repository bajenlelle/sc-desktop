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

test("a team's page leads with what stands out", async ({ page, browserName }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alfa" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("6 games played · none in your library yet")).toBeVisible();
  const keys = page.getByRole("region", { name: "What stands out" });
  await expect(keys.getByText("Shoot a lot of threes: 69% of shots, most in the league.", { exact: true })).toBeVisible();
  await expect(keys.getByRole("listitem")).toHaveCount(1);
  await expect(keys.getByText("Nothing stands out.", { exact: true })).toBeVisible(); // without the ball
  const play = page.getByRole("region", { name: "How they play" });
  await expect(play.getByText("Share of shots from three")).toBeVisible();
  await expect(play.getByRole("button")).toHaveCount(0); // season numbers open nothing
  await expect(play.locator("[data-season-mark]").first()).toBeAttached();
  await shot(page, `${browserName}-P-team-top`);
  await page.getByRole("button", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

test("too early to say with fewer than five games", async ({ page }) => {
  await mockLeague(page, madeUpLeague({ gamesEach: 3 }));
  await page.goto("/teams");
  await page.getByRole("link", { name: "Alfa", exact: true }).click();
  await expect(page.getByText("Too early to say what stands out: 3 games played.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Places appear after 5 games.")).toBeVisible();
});

test("a team the season doesn't list says so", async ({ page }) => {
  await mockLeague(page, madeUpLeague());
  await page.goto("/teams/48974/999");
  await expect(page.getByText("This team isn't in this season.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Go to Teams" }).click();
  await expect(page).toHaveURL(/\/teams$/);
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
