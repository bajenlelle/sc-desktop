import { describe, expect, it } from "vitest";
import type { ThemePrefs } from "../theme-sync";
import {
  filterUnappliedSlots,
  isTransientRealtimeFailure,
  planAdoption,
  planWrite,
  prefsFromRow,
  REALTIME_REPORT_GRACE_MS,
  realtimeReportVerdict,
  unappliedSlotsFor,
} from "../theme-sync";
import type { MobileThemeTokens } from "../themes";
import { COLOR_THEMES, DEFAULT_THEME, getTheme, hexToRgbTriplet, THEME_TOKENS } from "../themes";

describe("prefsFromRow", () => {
  it("maps a snake_case profiles row to camelCase prefs", () => {
    expect(prefsFromRow({ theme_dark: "nord", theme_light: "daylight", theme_mode: "system" })).toEqual({
      themeDark: "nord",
      themeLight: "daylight",
      themeMode: "system",
    });
  });

  it("accepts all three mode settings", () => {
    expect(prefsFromRow({ theme_mode: "light" }).themeMode).toBe("light");
    expect(prefsFromRow({ theme_mode: "dark" }).themeMode).toBe("dark");
    expect(prefsFromRow({ theme_mode: "system" }).themeMode).toBe("system");
  });

  it("turns missing keys into nulls", () => {
    expect(prefsFromRow({})).toEqual({ themeDark: null, themeLight: null, themeMode: null });
  });

  it("treats empty strings as never synced", () => {
    expect(prefsFromRow({ theme_dark: "", theme_light: "", theme_mode: "" })).toEqual({
      themeDark: null,
      themeLight: null,
      themeMode: null,
    });
  });

  it("nulls an invalid theme_mode while the other fields survive", () => {
    expect(prefsFromRow({ theme_dark: "mocha", theme_light: "courtside", theme_mode: "disco" })).toEqual({
      themeDark: "mocha",
      themeLight: "courtside",
      themeMode: null,
    });
    expect(prefsFromRow({ theme_dark: "mocha", theme_mode: 42 }).themeMode).toBeNull();
  });
});

describe("planAdoption", () => {
  const local: ThemePrefs = { themeDark: "scoutable-dark", themeLight: "scoutable-light", themeMode: "system" };

  it("never adopts null server fields (never synced -> device default stays)", () => {
    expect(planAdoption({ themeDark: null, themeLight: null, themeMode: null }, local)).toEqual({});
  });

  it("returns only the non-null fields that differ", () => {
    const server: ThemePrefs = { themeDark: "nord", themeLight: "scoutable-light", themeMode: "dark" };
    expect(planAdoption(server, local)).toEqual({ themeDark: "nord", themeMode: "dark" });
  });

  it("is empty when server and local already agree", () => {
    expect(planAdoption({ ...local }, local)).toEqual({});
  });
});

describe("planWrite", () => {
  const ref: ThemePrefs = { themeDark: "scoutable-dark", themeLight: "scoutable-light", themeMode: "system" };

  it("is gated shut before the first server snapshot (ref null)", () => {
    const local: ThemePrefs = { themeDark: "nord", themeLight: "daylight", themeMode: "dark" };
    expect(planWrite(local, null)).toEqual({});
  });

  it("never writes null local fields", () => {
    expect(planWrite({ themeDark: null, themeLight: null, themeMode: null }, ref)).toEqual({});
  });

  it("returns only the concrete fields that differ from the ref", () => {
    const local: ThemePrefs = { themeDark: "mocha", themeLight: "scoutable-light", themeMode: null };
    expect(planWrite(local, ref)).toEqual({ themeDark: "mocha" });
  });

  it("writes a field the server has never synced once local is concrete", () => {
    const partialRef: ThemePrefs = { themeDark: "nord", themeLight: null, themeMode: null };
    expect(planWrite({ themeDark: "nord", themeLight: "daylight", themeMode: null }, partialRef)).toEqual({
      themeLight: "daylight",
    });
  });

  it("is empty when local matches the ref", () => {
    expect(planWrite({ ...ref }, ref)).toEqual({});
  });
});

// Plain-object walkthroughs of the watcher protocol in the theme-sync.ts
// header: adoption sets the ref FIRST then applies; local changes go through
// planWrite; non-empty diffs are merged into the ref optimistically.
describe("reconcile protocol", () => {
  it("adoption echo: snapshot adopted ref-first, then the watcher's planWrite is empty", () => {
    // Fresh device, defaults only — the null ref gates any write.
    let local: ThemePrefs = { themeDark: "scoutable-dark", themeLight: "scoutable-light", themeMode: "system" };
    let ref: ThemePrefs | null = null;
    expect(planWrite(local, ref)).toEqual({});

    // First profile snapshot (fully synced elsewhere): ref first, then apply.
    const server = prefsFromRow({ theme_dark: "nord", theme_light: "daylight", theme_mode: "dark" });
    ref = { ...server };
    local = { ...local, ...planAdoption(server, local) };
    expect(local).toEqual({ themeDark: "nord", themeLight: "daylight", themeMode: "dark" });

    // The apply triggers the local watcher — adoption never writes.
    expect(planWrite(local, ref)).toEqual({});
  });

  it("partial snapshot: the watcher pushes device values for fields the server never synced", () => {
    // SUSPECT: the header says an adoption echo diffs to {} and that device
    // defaults are never pushed, but that only holds field-wise — after a
    // snapshot with null theme_light/theme_mode, the watcher writes the
    // device defaults for them (seeds the profile; flagging in case the gate
    // was meant to cover this too).
    let local: ThemePrefs = { themeDark: "scoutable-dark", themeLight: "scoutable-light", themeMode: "system" };
    let ref: ThemePrefs | null = null;

    const server = prefsFromRow({ theme_dark: "nord" }); // theme_light/theme_mode never synced
    ref = { ...server };
    local = { ...local, ...planAdoption(server, local) };

    expect(planWrite(local, ref)).toEqual({ themeLight: "scoutable-light", themeMode: "system" });
  });

  it("local pick: writes just the changed field, and its realtime echo adopts to {}", () => {
    let local: ThemePrefs = { themeDark: "nord", themeLight: "daylight", themeMode: "dark" };
    let ref: ThemePrefs = { ...local }; // in sync after a snapshot

    local = { ...local, themeDark: "mocha" }; // user picks a dark theme
    const diff = planWrite(local, ref);
    expect(diff).toEqual({ themeDark: "mocha" });
    ref = { ...ref, ...diff }; // optimistic merge, write fired

    // Realtime echo of our own UPDATE — nothing to re-apply, no loop.
    const echo = prefsFromRow({ theme_dark: "mocha", theme_light: "daylight", theme_mode: "dark" });
    ref = { ...echo };
    expect(planAdoption(echo, local)).toEqual({});
    expect(planWrite(local, ref)).toEqual({});
  });

  it("double pick: a stale echo transiently re-applies the older pick, then converges", () => {
    let local: ThemePrefs = { themeDark: "scoutable-dark", themeLight: "scoutable-light", themeMode: "system" };
    let ref: ThemePrefs = { ...local };

    // Pick A then B before either echo lands, ref merged each time.
    local = { ...local, themeDark: "nord" };
    const diffA = planWrite(local, ref);
    expect(diffA).toEqual({ themeDark: "nord" });
    ref = { ...ref, ...diffA };

    local = { ...local, themeDark: "mocha" };
    const diffB = planWrite(local, ref);
    expect(diffB).toEqual({ themeDark: "mocha" });
    ref = { ...ref, ...diffB };

    // Echo of A lands after B was picked: the older value is re-applied for a
    // moment (visible flicker), but the pre-set ref keeps the watcher silent.
    const echoA = prefsFromRow({ theme_dark: "nord", theme_light: "scoutable-light", theme_mode: "system" });
    ref = { ...echoA };
    const applyA = planAdoption(echoA, local);
    expect(applyA).toEqual({ themeDark: "nord" });
    local = { ...local, ...applyA };
    expect(planWrite(local, ref)).toEqual({});

    // Echo of B converges everything back.
    const echoB = prefsFromRow({ theme_dark: "mocha", theme_light: "scoutable-light", theme_mode: "system" });
    ref = { ...echoB };
    const applyB = planAdoption(echoB, local);
    expect(applyB).toEqual({ themeDark: "mocha" });
    local = { ...local, ...applyB };
    expect(planAdoption(echoB, local)).toEqual({});
    expect(planWrite(local, ref)).toEqual({});
  });

  it("offline revert: reverting the failed write's ref field re-arms the diff", () => {
    let local: ThemePrefs = { themeDark: "nord", themeLight: "daylight", themeMode: "system" };
    let ref: ThemePrefs = { ...local };

    local = { ...local, themeLight: "courtside" }; // pick while offline
    const diff = planWrite(local, ref);
    expect(diff).toEqual({ themeLight: "courtside" });
    ref = { ...ref, ...diff }; // optimistic
    expect(planWrite(local, ref)).toEqual({}); // quiet while the write is in flight

    // The write fails: revert the optimistic field so a re-pick retries.
    ref = { ...ref, themeLight: "daylight" };
    expect(planWrite(local, ref)).toEqual({ themeLight: "courtside" });
  });
});

describe("theme registry integrity", () => {
  const TOKEN_KEYS: Array<keyof MobileThemeTokens> = [
    "background",
    "foreground",
    "card",
    "primary",
    "primaryForeground",
    "secondary",
    "muted",
    "mutedForeground",
    "accent",
    "destructive",
    "border",
    "input",
  ];

  it("has 8 themes and THEME_TOKENS covers exactly the COLOR_THEMES ids", () => {
    expect(COLOR_THEMES).toHaveLength(8);
    expect(Object.keys(THEME_TOKENS).sort()).toEqual(COLOR_THEMES.map((t) => t.id).sort());
  });

  it("gives every palette all 12 mobile tokens as lowercase #rrggbb", () => {
    for (const palette of Object.values(THEME_TOKENS)) {
      expect(Object.keys(palette).sort()).toEqual([...TOKEN_KEYS].sort());
    }
    const badHexes = Object.entries(THEME_TOKENS).flatMap(([id, palette]) =>
      TOKEN_KEYS.filter((key) => !/^#[0-9a-f]{6}$/.test(palette[key])).map((key) => `${id}.${key}`),
    );
    expect(badHexes).toEqual([]);
  });

  it("keeps the secondary/muted and border/input aliases in every palette", () => {
    const brokenAliases = Object.entries(THEME_TOKENS)
      .filter(([, p]) => p.secondary !== p.muted || p.border !== p.input)
      .map(([id]) => id);
    expect(brokenAliases).toEqual([]);
  });

  it("points DEFAULT_THEME at registered ids of the right mode", () => {
    expect(DEFAULT_THEME).toEqual({ dark: "scoutable-dark", light: "scoutable-light" });
    expect(getTheme(DEFAULT_THEME.dark)?.mode).toBe("dark");
    expect(getTheme(DEFAULT_THEME.light)?.mode).toBe("light");
    expect(THEME_TOKENS[DEFAULT_THEME.dark]).toBeDefined();
    expect(THEME_TOKENS[DEFAULT_THEME.light]).toBeDefined();
  });
});

describe("hexToRgbTriplet", () => {
  it("converts #rrggbb to the tailwind 'r g b' shape", () => {
    expect(hexToRgbTriplet("#ffffff")).toBe("255 255 255");
    expect(hexToRgbTriplet("#09131a")).toBe("9 19 26");
  });

  it("accepts uppercase hex too", () => {
    expect(hexToRgbTriplet("#09131A")).toBe("9 19 26");
    expect(hexToRgbTriplet("#FFFFFF")).toBe("255 255 255");
  });
});

describe("unapplied-slot guard (unknown ids from newer clients)", () => {
  const local: ThemePrefs = {
    themeDark: "scoutable-dark",
    themeLight: "scoutable-light",
    themeMode: "dark",
  };

  it("flags slots whose server id this registry cannot render", () => {
    expect(unappliedSlotsFor({ themeDark: "neon", themeLight: "daylight", themeMode: "dark" })).toEqual(
      { themeDark: true, themeLight: false },
    );
    // A known id filed under the wrong mode is also unappliable.
    expect(unappliedSlotsFor({ themeDark: "daylight", themeLight: null, themeMode: null })).toEqual({
      themeDark: true,
      themeLight: false,
    });
    expect(unappliedSlotsFor({ themeDark: null, themeLight: null, themeMode: null })).toEqual({
      themeDark: false,
      themeLight: false,
    });
  });

  it("strips a masked slot from the write so the fallback never clobbers the newer pick", () => {
    // Server holds "neon" (unknown here); local still shows the fallback and
    // a mode toggle fires T3 — themeDark must NOT be written.
    const ref: ThemePrefs = { themeDark: "neon", themeLight: "scoutable-light", themeMode: "dark" };
    const after = { ...local, themeMode: "light" as const };
    const { diff, unapplied } = filterUnappliedSlots(
      planWrite(after, ref),
      { themeDark: true, themeLight: false },
      local,
      after,
    );
    expect(diff).toEqual({ themeMode: "light" });
    expect(unapplied.themeDark).toBe(true);
  });

  it("reclaims a masked slot when the user actually picks it on this device", () => {
    const ref: ThemePrefs = { themeDark: "neon", themeLight: "scoutable-light", themeMode: "dark" };
    const picked = { ...local, themeDark: "mocha" };
    const { diff, unapplied } = filterUnappliedSlots(
      planWrite(picked, ref),
      { themeDark: true, themeLight: false },
      local, // previous evaluation: fallback still shown
      picked,
    );
    expect(diff).toEqual({ themeDark: "mocha" });
    expect(unapplied.themeDark).toBe(false);
  });

  it("keeps the mask with no previous evaluation (first run after adoption)", () => {
    const ref: ThemePrefs = { themeDark: "neon", themeLight: "scoutable-light", themeMode: "dark" };
    const { diff, unapplied } = filterUnappliedSlots(
      planWrite(local, ref),
      { themeDark: true, themeLight: false },
      null,
      local,
    );
    expect(diff).toEqual({});
    expect(unapplied.themeDark).toBe(true);
  });
});

describe("isTransientRealtimeFailure", () => {
  it("flags the two statuses that mean the join failed", () => {
    expect(isTransientRealtimeFailure("CHANNEL_ERROR")).toBe(true);
    expect(isTransientRealtimeFailure("TIMED_OUT")).toBe(true);
  });

  it("ignores ordinary lifecycle statuses, so a cold join files nothing", () => {
    expect(isTransientRealtimeFailure("SUBSCRIBED")).toBe(false);
    expect(isTransientRealtimeFailure("CLOSED")).toBe(false);
    expect(isTransientRealtimeFailure("")).toBe(false);
    expect(isTransientRealtimeFailure("SOMETHING_NEW")).toBe(false);
  });

  it("gives the rejoin real time to land before anything is reported", () => {
    // Guards against someone trimming this to a value shorter than supabase-js
    // takes to retry, which would put the noise straight back.
    expect(REALTIME_REPORT_GRACE_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("realtimeReportVerdict", () => {
  const G = REALTIME_REPORT_GRACE_MS;

  it("stays quiet once the channel is joined, however late the timer ran", () => {
    expect(realtimeReportVerdict({ joined: true, elapsedMs: G, rearmed: false })).toBe("quiet");
    expect(realtimeReportVerdict({ joined: true, elapsedMs: G * 1000, rearmed: true })).toBe("quiet");
  });

  it("reports a channel still dead after a normally-elapsed window", () => {
    expect(realtimeReportVerdict({ joined: false, elapsedMs: G, rearmed: false })).toBe("report");
  });

  it("re-arms instead of reporting when the timer fired suspiciously late", () => {
    // A suspended device freezes timers; on wake this fires immediately with a
    // huge wall-clock gap, long before any rejoin could land.
    expect(realtimeReportVerdict({ joined: false, elapsedMs: G * 120, rearmed: false })).toBe("rearm");
  });

  it("re-arms at most once, so a stuck channel still reports", () => {
    expect(realtimeReportVerdict({ joined: false, elapsedMs: G * 120, rearmed: true })).toBe("report");
  });

  it("does not re-arm for ordinary timer jitter just over the window", () => {
    expect(realtimeReportVerdict({ joined: false, elapsedMs: G * 2, rearmed: false })).toBe("report");
  });
});
