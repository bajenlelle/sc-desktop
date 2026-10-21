import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMatchesLight } from "../matches-db";

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: "owner",
    title: id,
    game_date: null,
    home_team: { name: "Home", color: "#111" },
    away_team: { name: "Away", color: "#222" },
    home_roster: [],
    away_roster: [],
    video_url: null,
    sync_point: null,
    league_id: null,
    season_id: null,
    stage_id: null,
    org_id: "org-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

function client(rows: unknown[]) {
  const selects: string[] = [];
  const b: Record<string, unknown> = {
    select(s: string) { selects.push(s); return b; },
    eq() { return b; },
    or() { return b; },
    order() { return b; },
    then: (r: (x: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(r),
  };
  const c = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } }, error: null }) },
    from() { return b; },
  } as unknown as SupabaseClient;
  return { c, selects };
}

describe("listMatchesLight withEventCount", () => {
  it("counts the plays per game instead of loading them", async () => {
    const { c, selects } = client([
      row("m1", { play_by_play_events: [{ count: 412 }] }),
      row("m2", { play_by_play_events: [] }),
    ]);
    const out = await listMatchesLight(c, "org-1", { ownOnly: true, withEventCount: true });
    expect(selects).toEqual(["*, play_by_play_events(count)"]);
    expect(out.map((m) => [m.id, m.eventCount, m.events.length])).toEqual([
      ["m1", 412, 0],
      ["m2", 0, 0],
    ]);
  });

  it("leaves eventCount out without the option", async () => {
    const { c, selects } = client([row("m1")]);
    const [m] = await listMatchesLight(c, "org-1");
    expect(selects).toEqual(["*"]);
    expect(m.eventCount).toBeUndefined();
  });
});
