/**
 * Group A, Task 2: the folder tree. An expanded folder shows the open-folder
 * icon and a guide line under its chevron; a child playlist's icon sits in its
 * sibling subfolder's column, 14 px right of the parent's; an empty folder's
 * hint starts there too; with no folders a playlist has no extra indent; the
 * guide line stays behind a selected row. Creates `headless-1431 …` rows and
 * deletes them, pass or fail.
 */
import type { Locator, Page } from "@playwright/test";
import {
  createInSidebar,
  deleteOwnRowsNamed,
  expect,
  folderRow,
  openPlaylists,
  ownRowsNamed,
  playlistRow,
  PORT,
  shot,
  test,
} from "../helpers";

const PREFIX = `headless-${PORT} `;
const TREE = `${PREFIX}tree`;
const SUB = `${PREFIX}sub`;
const CHILD = `${PREFIX}child`;

/** Lucide's icon name from an svg's classes (`lucide-folder-open`, `lucide-folder`, …). */
async function iconName(icon: Locator): Promise<string> {
  const classes = ((await icon.getAttribute("class")) ?? "").split(/\s+/);
  return classes.find((c) => c.startsWith("lucide-") && !c.endsWith("-icon")) ?? classes.join(" ");
}

async function box(locator: Locator, what: string) {
  const b = await locator.boundingBox();
  expect(b, `${what} is laid out`).not.toBeNull();
  return b!;
}

/** The colour at one CSS pixel, as the PNG of a 1×1 clip (two clips compare equal when the pixels do). */
async function pixel(page: Page, x: number, y: number): Promise<Buffer> {
  return page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: "disabled" });
}

test.afterEach(async ({ page }) => {
  await deleteOwnRowsNamed(page, PREFIX);
});

test("A task 2: open-folder icon, aligned indents, guide line", async ({ page, browserName }) => {
  const name = (step: string) => `${browserName}-A-task2-${step}`;
  await openPlaylists(page);
  await deleteOwnRowsNamed(page, PREFIX);
  await page.reload();
  await expect(page.getByRole("button", { name: "New Playlist", exact: true })).toBeVisible({ timeout: 30_000 });

  // ── A playlist at the top level, while the space has no folders: no spacer, its icon at the row's 8 px padding.
  const child = await createInSidebar(page, "playlist", CHILD);
  const realFolders = page.locator("[data-folder-id]:not([data-folder-id='uncategorized'])");
  if ((await realFolders.count()) === 0) {
    const row = await box(child, "the playlist row");
    const icon = await box(child.locator("svg").first(), "the playlist icon");
    expect(icon.x - row.x, "no folders: the playlist icon sits at the row's padding, no extra indent").toBeCloseTo(8, 0);
    await shot(page, name("no-folders"));
  } else {
    test.info().annotations.push({ type: "skipped-check", description: "the space already had folders, so the no-folder indent wasn't measured" });
  }

  // ── A folder, a subfolder inside it (its context menu's New Subfolder).
  const tree = await createInSidebar(page, "folder", TREE);
  await tree.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Subfolder", exact: true }).click();
  // The field opens unfocused when a menu opened it (finding A-1, see A-task1-rename.spec.ts), so fill it directly.
  const subField = page.locator("[data-folder-id^='temp-'] input");
  await expect(subField).toHaveValue("New Folder");
  await subField.fill(SUB);
  await subField.press("Enter");
  const sub = folderRow(page, SUB);
  await expect(sub).toBeVisible({ timeout: 15_000 });

  // With folders, a top-level playlist's icon lines up with a top-level folder's.
  const treeIcon = tree.locator("svg").nth(1);
  expect((await box(child.locator("svg").first(), "the top-level playlist icon")).x, "a top-level playlist's icon is in the top-level folder's icon column").toBeCloseTo(
    (await box(treeIcon, "the folder icon")).x,
    0,
  );

  // ── Move the playlist into the folder through its context menu ("Move to folder"; no drag needed).
  await child.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to folder" }).hover();
  await page.getByRole("menuitem", { name: TREE, exact: true }).click();
  await expect
    .poll(async () => {
      const treeId = await tree.getAttribute("data-folder-id");
      return (await ownRowsNamed(page, "playlists", CHILD)).map((r) => r.folder_id === treeId);
    }, { message: "the playlist is stored in the folder" })
    .toEqual([true]);
  const inTree = () => tree.evaluate((header, childName) => {
    const rowEl = [...document.querySelectorAll<HTMLElement>("[data-playlist-id]")].find((r) => r.innerText.split("\n")[0] === childName);
    return !!rowEl && header.parentElement!.contains(rowEl);
  }, CHILD);
  await expect.poll(inTree, { message: "the playlist row renders inside the folder" }).toBe(true);

  // ── Expanded: open-folder icon; the child's icon in the subfolder's column, 14 px right of the parent's.
  await page.mouse.move(2, 2);
  await expect(tree.locator("svg").nth(1)).toHaveClass(/lucide-folder-open/);
  expect(await iconName(treeIcon), "an expanded folder shows FolderOpen").toBe("lucide-folder-open");
  const parentX = (await box(treeIcon, "the parent folder icon")).x;
  const subX = (await box(sub.locator("svg").nth(1), "the subfolder icon")).x;
  const childBox = await box(child.locator("svg").first(), "the child playlist icon");
  expect(childBox.x, "the child playlist's icon is in its sibling subfolder's column").toBeCloseTo(subX, 1);
  expect(childBox.x - parentX, "…14 px right of the parent's icon").toBeCloseTo(14, 1);

  // The empty subfolder's hint starts where a child of it would put its icon (sub icon + 14).
  const hint = page.getByText("Empty — drag a playlist here").first();
  const hintStart = await hint.evaluate((p) => p.getBoundingClientRect().left + parseFloat(getComputedStyle(p).paddingLeft));
  expect(hintStart - subX, "the empty hint starts one indent right of the subfolder's icon").toBeCloseTo(14, 1);

  // The guide line: 1 px at the centre of the parent's chevron.
  const guide = tree.locator("xpath=following-sibling::div[1]/span[1]");
  await expect(guide).toHaveClass(/w-px/);
  const guideBox = await box(guide, "the guide line");
  const chevron = await box(tree.locator("svg").first(), "the parent's chevron");
  expect(guideBox.width, "the guide is 1 px").toBeCloseTo(1, 1);
  // The brief's formula puts the line's left edge at the chevron's centre (left = … + 7), so the 1 px line spans centre…centre+1.
  expect(guideBox.x, "the guide starts at the chevron's centre").toBeCloseTo(chevron.x + chevron.width / 2, 1);
  const childRow = await box(child, "the child row");
  expect(guideBox.y + guideBox.height, "the guide runs down past the folder's last row").toBeGreaterThanOrEqual(childRow.y + childRow.height - 1);

  // The guide stays behind a selected row (the created playlist is the selected one): across the selected
  // pill its pixel is the pill's colour; across the (unselected) subfolder row it is a visible line.
  await expect(child, "the child playlist is the selected row").toHaveClass(/bg-selection/);
  const gx = Math.floor(guideBox.x);
  const childMid = childRow.y + childRow.height / 2;
  const subRow = await box(sub, "the subfolder row");
  const subMid = subRow.y + subRow.height / 2;
  // Light, then dark (the system appearance, which the default theme follows).
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    expect((await pixel(page, gx, subMid)).equals(await pixel(page, gx + 4, subMid)), `${scheme}: the guide line shows across an unselected row`).toBe(false);
    expect((await pixel(page, gx, childMid)).equals(await pixel(page, gx + 4, childMid)), `${scheme}: the guide line doesn't cut through the selected row's pill`).toBe(true);
    await shot(page, name(`tree-expanded-${scheme}`));
  }
  await page.emulateMedia({ colorScheme: "light" });

  // ── Collapsed: the closed folder icon, no children, no guide.
  await tree.getByText(TREE, { exact: true }).click();
  await expect(tree.locator("svg").nth(1)).not.toHaveClass(/lucide-folder-open/);
  expect(await iconName(tree.locator("svg").nth(1)), "a collapsed folder shows Folder").toBe("lucide-folder");
  await expect(sub, "a collapsed folder hides its subfolders").toBeHidden();
  await expect(playlistRow(page, CHILD), "a collapsed folder hides its playlists").toBeHidden();
  await shot(page, name("tree-collapsed"));
});
