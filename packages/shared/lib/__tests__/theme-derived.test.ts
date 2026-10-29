import { describe, expect, it } from "vitest";
import { COLOR_THEMES, THEME_TOKENS } from "../themes";
import { deriveThemeColors, rgba } from "../theme-derived";

describe("rgba", () => {
  it("turns a hex colour and an alpha into an rgba() string", () => {
    expect(rgba("#020405", 0.05)).toBe("rgba(2, 4, 5, 0.05)");
    expect(rgba("d8dfe4", 0.1)).toBe("rgba(216, 223, 228, 0.1)");
  });
});

describe("deriveThemeColors", () => {
  it("derives fills and separators from the foreground, as the web's color-mix does", () => {
    const light = deriveThemeColors("scoutable-light", "light");
    expect(light.fill1).toBe("rgba(2, 4, 5, 0.05)");
    expect(light.fill2).toBe("rgba(2, 4, 5, 0.08)");
    expect(light.fill3).toBe("rgba(2, 4, 5, 0.12)");
    expect(light.fill4).toBe("rgba(2, 4, 5, 0.18)");
    expect(light.separator).toBe("rgba(2, 4, 5, 0.1)");
    expect(light.separatorStrong).toBe("rgba(2, 4, 5, 0.18)");

    const dark = deriveThemeColors("scoutable-dark", "dark");
    expect(dark.separator).toBe("rgba(216, 223, 228, 0.1)");
    expect(dark.materialToolbar).toBe("rgba(9, 19, 26, 0.72)");
  });

  it("strengthens separators under Increase Contrast", () => {
    const d = deriveThemeColors("scoutable-dark", "dark", { increasedContrast: true });
    expect(d.separator).toBe(d.separatorStrong);
  });

  it("takes success and warning from the mode, not the theme", () => {
    expect(deriveThemeColors("courtside", "light")).toMatchObject({ success: "#168b49", warning: "#c46d00" });
    expect(deriveThemeColors("nord", "dark")).toMatchObject({ success: "#5bcc80", warning: "#f5ae4b" });
  });

  it("uses the card colour for popovers except where themes.css sets its own", () => {
    expect(deriveThemeColors("film-room", "dark").popover).toBe("#2a2a2e");
    expect(deriveThemeColors("mocha", "dark").popover).toBe("#313244");
    expect(deriveThemeColors("aubergine", "dark").popover).toBe(THEME_TOKENS.aubergine.card);
    expect(deriveThemeColors("film-room", "dark").materialPopover).toBe("rgba(42, 42, 46, 0.88)");
  });

  it("falls back to the mode's default theme for an unknown or wrong-mode id", () => {
    expect(deriveThemeColors("nope", "dark").popover).toBe(THEME_TOKENS["scoutable-dark"].card);
    expect(deriveThemeColors("courtside", "dark").selection).toBe(THEME_TOKENS["scoutable-dark"].primary);
  });

  it("selects with the theme's primary", () => {
    for (const t of COLOR_THEMES) {
      const d = deriveThemeColors(t.id, t.mode);
      expect(d.selection).toBe(THEME_TOKENS[t.id].primary);
      expect(d.selectionForeground).toBe(THEME_TOKENS[t.id].primaryForeground);
    }
  });
});
