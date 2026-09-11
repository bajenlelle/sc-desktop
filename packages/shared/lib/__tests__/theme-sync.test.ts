import { describe, expect, it } from "vitest";
import type { RealtimeReporter, ThemePrefs } from "../theme-sync";
import {
  createRealtimeReporter,
  filterUnappliedSlots,
  isTransientRealtimeFailure,
  planAdoption,
  planWrite,
  prefsFromRow,
  REALTIME_CONFIRM_MS,
  REALTIME_REPORT_GRACE_MS,
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

describe("createRealtimeReporter", () => {
  const G = REALTIME_REPORT_GRACE_MS;
  const C = REALTIME_CONFIRM_MS;
  const HOURS_8 = 8 * 60 * 60 * 1000;

  interface Harness {
    reporter: RealtimeReporter;
    reports: Array<{ message: string; detail?: string }>;
    setJoined: (v: boolean) => void;
    setHidden: (v: boolean) => void;
    /** Advance the wall clock WITHOUT firing timers — a device suspend. */
    sleep: (ms: number) => void;
    /** Advance the wall clock, firing due timers at their scheduled times. */
    tick: (ms: number) => void;
    pendingTimers: () => number;
  }

  // Manual clock + timer table instead of vi.useFakeTimers, because the whole
  // point of the machine is distinguishing timers that fired on schedule from
  // timers that fired late after a suspend — sleep() and tick() make that
  // difference explicit.
  function harness(): Harness {
    let now = 0;
    let joined = false;
    let hidden = false;
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; at: number }>();
    const reports: Array<{ message: string; detail?: string }> = [];
    const reporter = createRealtimeReporter({
      isJoined: () => joined,
      isHidden: () => hidden,
      report: (message, detail) => reports.push({ message, detail }),
      now: () => now,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimer: (id) => void timers.delete(id as number),
    });
    return {
      reporter,
      reports,
      setJoined: (v) => (joined = v),
      setHidden: (v) => (hidden = v),
      sleep: (ms) => {
        now += ms;
      },
      tick: (ms) => {
        const target = now + ms;
        for (;;) {
          const due = [...timers.entries()]
            .filter(([, t]) => t.at <= target)
            .sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          timers.delete(due[0]);
          // A timer never fires before its schedule, but after a sleep() it
          // fires late — at the already-advanced wall clock.
          now = Math.max(now, due[1].at);
          due[1].fn();
        }
        now = target;
      },
      pendingTimers: () => timers.size,
    };
  }

  it("cold-join churn that recovers files nothing and leaves no timers", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR", "transport failure");
    h.tick(2_000);
    h.setJoined(true);
    h.reporter.onStatus("SUBSCRIBED");
    h.tick(G * 10);
    expect(h.reports).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
  });

  it("a genuinely stuck channel reports once, after grace + confirmation", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR", "transport failure");
    h.tick(G);
    expect(h.reports).toEqual([]); // clean window over -> confirmation, not report
    h.tick(C);
    expect(h.reports).toEqual([
      { message: "sustained realtime failure: CHANNEL_ERROR", detail: "transport failure" },
    ]);
    // Sticky: the same subscription never reports twice.
    h.reporter.onStatus("CHANNEL_ERROR", "transport failure");
    h.tick((G + C) * 3);
    expect(h.reports).toHaveLength(1);
    expect(h.pendingTimers()).toBe(0);
  });

  it("a rejoin landing during the confirmation window stays quiet", () => {
    const h = harness();
    h.reporter.onStatus("TIMED_OUT", "heartbeat timeout");
    h.tick(G);
    h.setJoined(true); // rejoin lands mid-confirmation
    h.tick(C);
    expect(h.reports).toEqual([]);
  });

  it("suspends never report, no matter how many or how late (regression: rearm was one-shot and sticky)", () => {
    const h = harness();
    // First failure + overnight sleep: rearm, not report.
    h.reporter.onStatus("CHANNEL_ERROR");
    h.sleep(HOURS_8);
    h.tick(0);
    expect(h.reports).toEqual([]);
    // Recovery. The old machine kept `rearmed` set here — its suspend
    // protection was consumed for the lifetime of the subscription.
    h.setJoined(true);
    h.reporter.onStatus("SUBSCRIBED");
    h.tick(1_000);
    // Second failure + another overnight sleep: still no report.
    h.setJoined(false);
    h.reporter.onStatus("CHANNEL_ERROR", "socket closed: 1006");
    h.sleep(HOURS_8);
    h.tick(0);
    expect(h.reports).toEqual([]);
    // Even a suspend during the confirmation window restarts the full grace.
    h.tick(G); // clean window -> confirming
    h.sleep(HOURS_8);
    h.tick(0);
    expect(h.reports).toEqual([]);
    // Only a clean, awake window (plus confirmation) finally reports.
    h.tick(G);
    h.tick(C);
    expect(h.reports).toEqual([
      { message: "sustained realtime failure: CHANNEL_ERROR", detail: "socket closed: 1006" },
    ]);
  });

  it("hidden contexts re-arm forever and report only once visible", () => {
    const h = harness();
    h.setHidden(true);
    h.reporter.onStatus("TIMED_OUT", "heartbeat timeout");
    h.tick(G * 5); // several windows elapse hidden
    expect(h.reports).toEqual([]);
    h.setHidden(false);
    h.tick(G + C);
    expect(h.reports).toEqual([
      { message: "sustained realtime failure: TIMED_OUT", detail: "heartbeat timeout" },
    ]);
  });

  it("CLOSED cancels a pending window (teardown is not an outage)", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR");
    h.reporter.onStatus("CLOSED");
    h.tick(G * 10);
    expect(h.reports).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
    // A failure after CLOSED starts a fresh window as usual.
    h.reporter.onStatus("CHANNEL_ERROR");
    h.tick(G + C);
    expect(h.reports).toHaveLength(1);
  });

  it("reports the LATEST failure, not the one that armed the window", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR", "socket closed: 1006");
    h.tick(5_000);
    h.reporter.onStatus("TIMED_OUT", "heartbeat timeout");
    h.tick(G + C);
    expect(h.reports).toEqual([
      { message: "sustained realtime failure: TIMED_OUT", detail: "heartbeat timeout" },
    ]);
  });

  it("keeps the last known detail when a later failure carries none", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR", "transport failure");
    h.reporter.onStatus("CHANNEL_ERROR");
    h.tick(G + C);
    expect(h.reports[0]?.detail).toBe("transport failure");
  });

  it("ignores unknown statuses entirely", () => {
    const h = harness();
    h.reporter.onStatus("SOMETHING_NEW");
    h.tick(G * 10);
    expect(h.reports).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
  });

  it("dispose cancels everything and makes late statuses no-ops", () => {
    const h = harness();
    h.reporter.onStatus("CHANNEL_ERROR");
    h.reporter.dispose();
    expect(h.pendingTimers()).toBe(0);
    h.reporter.onStatus("CHANNEL_ERROR"); // e.g. a status racing the cleanup
    h.tick(G * 10);
    expect(h.reports).toEqual([]);
    expect(h.pendingTimers()).toBe(0);
  });

  it("keeps the confirmation window shorter than the grace window", () => {
    // The confirmation exists to let an in-flight rejoin land, not to double
    // the wait — guard against the constants drifting past each other.
    expect(REALTIME_CONFIRM_MS).toBeLessThan(REALTIME_REPORT_GRACE_MS);
  });
});
