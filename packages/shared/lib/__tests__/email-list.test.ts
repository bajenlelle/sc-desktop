import { describe, expect, it } from "vitest";
import { classifyInviteEmails, inviteSummary, isValidEmail, parseEmailList, skippedSummary } from "../email-list";

describe("parseEmailList", () => {
  it("reads a spreadsheet column (CRLF, trailing blank line)", () => {
    expect(parseEmailList("anna@x.se\r\nerik@y.se\r\n\r\nlisa@z.se\r\n")).toEqual({
      emails: ["anna@x.se", "erik@y.se", "lisa@z.se"],
      invalid: [],
    });
  });

  it("reads an Outlook recipient list with display names", () => {
    const outlook = `"Svensson, Anna" <Anna.Svensson@x.se>; Erik Berg <erik@y.se>; lisa@z.se`;
    expect(parseEmailList(outlook).emails).toEqual(["anna.svensson@x.se", "erik@y.se", "lisa@z.se"]);
  });

  it("reads a Gmail comma list and a name glued to its bracket", () => {
    expect(parseEmailList("Anna<anna@x.se>, erik@y.se,lisa@z.se").emails).toEqual([
      "anna@x.se",
      "erik@y.se",
      "lisa@z.se",
    ]);
  });

  it("keeps only the address columns of CSV and tab-separated rows", () => {
    const csv = "First,Last,Email\nAnna,Svensson,anna@x.se\nErik\tBerg\terik@y.se";
    expect(parseEmailList(csv)).toEqual({ emails: ["anna@x.se", "erik@y.se"], invalid: [] });
  });

  it("strips mailto: and sentence punctuation", () => {
    expect(parseEmailList("mailto:anna@x.se (erik@y.se). lisa@z.se:").emails).toEqual([
      "anna@x.se",
      "erik@y.se",
      "lisa@z.se",
    ]);
  });

  it("lowercases and dedupes in paste order", () => {
    expect(parseEmailList("Erik@Y.se anna@x.se ERIK@y.SE").emails).toEqual(["erik@y.se", "anna@x.se"]);
  });

  it("reports tokens with @ that aren't addresses, and ignores words without @", () => {
    expect(parseEmailList("anna@x.se erik@ @lisa Svensson bad@domain lisa@z.se")).toEqual({
      emails: ["anna@x.se", "lisa@z.se"],
      invalid: ["erik@", "@lisa", "bad@domain"],
    });
  });

  it("returns nothing for empty or address-free text", () => {
    expect(parseEmailList("")).toEqual({ emails: [], invalid: [] });
    expect(parseEmailList("Anna Svensson\nErik Berg")).toEqual({ emails: [], invalid: [] });
  });
});

describe("isValidEmail", () => {
  it("matches the server's rule", () => {
    expect(isValidEmail("a@b.se")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.se")).toBe(false);
  });
});

describe("classifyInviteEmails + inviteSummary", () => {
  const entries = ["new@x.se", "member@x.se", "invited@x.se", "bad@x", "new2@x.se"];
  const classified = classifyInviteEmails(entries, {
    memberEmails: ["Member@x.se"],
    invitedEmails: ["INVITED@x.se"],
  });

  it("marks members, pending invites and invalid entries", () => {
    expect(classified.map((e) => e.status)).toEqual(["new", "member", "invited", "invalid", "new"]);
  });

  it("summarizes what the server skipped", () => {
    expect(skippedSummary([])).toBeNull();
    expect(
      skippedSummary([{ reason: "already_member" }, { reason: "already_invited" }, { reason: "already_invited" }])
    ).toBe("Skipped 1 already a member · 2 already invited");
  });

  it("summarizes counts, leaving out empty groups", () => {
    expect(inviteSummary(classified)).toBe("2 to invite · 1 already a member · 1 already invited · 1 not valid");
    expect(inviteSummary(classifyInviteEmails(["a@x.se"], { memberEmails: [], invitedEmails: [] }))).toBe(
      "1 to invite"
    );
  });
});
