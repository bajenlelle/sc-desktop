import { describe, expect, it } from "vitest";
import { isAppearanceSetting, menuAppearanceFor, windowThemeFor } from "../appearance";

describe("windowThemeFor", () => {
  it("hands the window back to the OS under system", () => {
    expect(windowThemeFor("system", "dark")).toBeNull();
    expect(windowThemeFor("system", "light")).toBeNull();
  });

  it("follows the OS before the setting is known", () => {
    expect(windowThemeFor(undefined, "dark")).toBeNull();
  });

  it("pins the window to the resolved mode under an explicit setting", () => {
    expect(windowThemeFor("light", "light")).toBe("light");
    expect(windowThemeFor("dark", "dark")).toBe("dark");
  });

  it("does not pin anything while the mode is still resolving", () => {
    expect(windowThemeFor("light", undefined)).toBeNull();
  });
});

describe("menuAppearanceFor", () => {
  it("maps unknown or missing settings to system", () => {
    expect(menuAppearanceFor(undefined)).toBe("system");
    expect(menuAppearanceFor("sepia")).toBe("system");
    expect(menuAppearanceFor("dark")).toBe("dark");
  });
});

describe("isAppearanceSetting", () => {
  it("accepts the three settings only", () => {
    expect(isAppearanceSetting("system")).toBe(true);
    expect(isAppearanceSetting("light")).toBe(true);
    expect(isAppearanceSetting("dark")).toBe(true);
    expect(isAppearanceSetting("auto")).toBe(false);
    expect(isAppearanceSetting(null)).toBe(false);
  });
});
