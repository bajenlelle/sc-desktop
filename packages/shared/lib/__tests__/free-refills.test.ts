import { describe, expect, it } from "vitest";
import { refillCandidatesCsv, refillErrorMessage, type FreeRefillCandidate } from "../free-refills";

const row = (partial: Partial<FreeRefillCandidate>): FreeRefillCandidate => ({
  user_id: "u1",
  email: "anna@x.se",
  full_name: "Anna Svensson",
  declared_role: "coach",
  used: 3,
  allowance: 3,
  last_import_at: "2026-09-01T10:00:00Z",
  last_sign_in_at: null,
  in_club: false,
  had_subscription: false,
  email_consent: true,
  will_email: true,
  last_refill_at: null,
  eligible_at: "2026-10-01T10:00:00Z",
  eligible_now: true,
  ...partial,
});

describe("refillCandidatesCsv", () => {
  it("writes a header and one line per candidate, blanks for nulls", () => {
    const csv = refillCandidatesCsv([row({})]);
    const [header, line] = csv.split("\n");
    expect(header.split(",")[0]).toBe("email");
    expect(line).toBe("anna@x.se,Anna Svensson,coach,3,3,2026-09-01T10:00:00Z,,false,false,true,true,,2026-10-01T10:00:00Z,true");
  });

  it("quotes commas and quotes, and keeps formulas as text", () => {
    const csv = refillCandidatesCsv([row({ full_name: 'Svensson, "Anna"' }), row({ full_name: "=HYPERLINK(1)" })]);
    const lines = csv.split("\n");
    expect(lines[1]).toContain('"Svensson, ""Anna"""');
    expect(lines[2]).toContain("'=HYPERLINK(1)");
  });
});

describe("refillErrorMessage", () => {
  it("maps the RPC tokens", () => {
    expect(refillErrorMessage("P0001: refilled_recently")).toMatch(/cooldown/);
    expect(refillErrorMessage("P0001: too_soon")).toMatch(/Too soon/);
    expect(refillErrorMessage("boom")).toBe("Refill failed: boom");
  });
});
