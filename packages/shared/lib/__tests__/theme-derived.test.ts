import { describe, expect, it } from "vitest";
import { COLOR_THEMES, THEME_TOKENS } from "../themes";
import { deriveThemeColors, rgba, themeVarMap } from "../theme-derived";

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

describe("canvas", () => {
  it("floors grouped screens with the muted tone when a light theme's cards equal its page", () => {
    expect(deriveThemeColors("scoutable-light", "light").canvas).toBe(THEME_TOKENS["scoutable-light"].muted);
  });

  it("keeps the page colour where cards already stand out or the mode is dark", () => {
    expect(deriveThemeColors("daylight", "light").canvas).toBe(THEME_TOKENS.daylight.background);
    expect(deriveThemeColors("courtside", "light").canvas).toBe(THEME_TOKENS.courtside.background);
    for (const t of COLOR_THEMES.filter((t) => t.mode === "dark")) {
      expect(deriveThemeColors(t.id, "dark").canvas).toBe(THEME_TOKENS[t.id].background);
    }
  });
});

describe("eventDot", () => {
  it("colours makes, misses and turnovers with the status colours and assists with the primary", () => {
    const light = deriveThemeColors("courtside", "light").eventDot;
    expect(light.make).toBe("#168b49");
    expect(light.miss).toBe(THEME_TOKENS.courtside.destructive);
    expect(light.turnover).toBe("#c46d00");
    expect(light.assist).toBe(THEME_TOKENS.courtside.primary);
    expect(light.neutral).toBe(THEME_TOKENS.courtside.mutedForeground);
  });

  it("uses fixed blue, violet and orange per mode for rebounds, steals and blocks, and fouls", () => {
    const light = deriveThemeColors("scoutable-light", "light").eventDot;
    expect([light.rebound, light.steal, light.block, light.foul]).toEqual(["#3b82f6", "#7c3aed", "#7c3aed", "#ea580c"]);
    const dark = deriveThemeColors("nord", "dark").eventDot;
    expect([dark.rebound, dark.steal, dark.block, dark.foul]).toEqual(["#60a5fa", "#a78bfa", "#a78bfa", "#fb923c"]);
    expect(dark.make).toBe("#5bcc80");
  });
});

describe("themeVarMap", () => {
  const KEYS = [
    "--color-background", "--color-foreground", "--color-card", "--color-canvas", "--color-primary",
    "--color-primary-foreground", "--color-secondary", "--color-muted", "--color-muted-foreground",
    "--color-accent", "--color-destructive", "--color-border", "--color-input", "--color-popover",
    "--color-success", "--color-warning", "--color-fill-1", "--color-fill-2", "--color-fill-3",
    "--color-fill-4", "--color-separator", "--color-separator-strong", "--color-material-toolbar",
    "--color-material-popover",
  ];

  it("holds every variable the Tailwind config reads, for every theme", () => {
    for (const t of COLOR_THEMES) {
      const map = themeVarMap(THEME_TOKENS[t.id], deriveThemeColors(t.id, t.mode));
      expect(Object.keys(map).sort()).toEqual([...KEYS].sort());
    }
  });

  it("writes solid colours as RGB triplets and derived ones as rgba()", () => {
    const map = themeVarMap(THEME_TOKENS["scoutable-light"], deriveThemeColors("scoutable-light", "light"));
    expect(map["--color-background"]).toBe("252 252 252");
    expect(map["--color-canvas"]).toBe("245 245 245");
    expect(map["--color-success"]).toBe("22 139 73");
    expect(map["--color-fill-2"]).toBe("rgba(2, 4, 5, 0.08)");
    for (const [k, v] of Object.entries(map)) {
      expect(v, k).toMatch(/^(\d{1,3} \d{1,3} \d{1,3}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\))$/);
    }
  });
});
