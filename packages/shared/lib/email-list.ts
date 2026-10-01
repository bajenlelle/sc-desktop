/**
 * Parsing and classifying pasted email lists for the invite dialog (web and
 * desktop). Coaches paste from anywhere: a spreadsheet column (one per line),
 * an Outlook/Gmail recipient field ("Anna S <anna@x.se>; erik@y.se"), or a
 * CSV row with names in other columns. All of those reduce to "split on
 * separators, keep the tokens that look like addresses".
 *
 * The server (invite_by_email) normalizes and validates again. This is for the
 * chips and the summary line, so the rules match: trim, lowercase, same regex.
 */

import type { InviteSkipReason } from "../types/org";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** Commas, semicolons, any whitespace (incl. CR/LF and tabs from spreadsheets). */
const SEPARATORS = /[,;\s]+/;

/** Wrapping punctuation from "Name <a@x.se>", quotes, and mailto: links. */
function cleanToken(token: string): string {
  return token
    .replace(/^mailto:/i, "")
    .replace(/^[<("'[]+/, "")
    .replace(/[>)"'\].:]+$/, "")
    .trim()
    .toLowerCase();
}

export interface ParsedEmailList {
  /** Valid addresses, lowercased, deduped, in paste order. */
  emails: string[];
  /** Tokens that contain "@" but aren't valid addresses, deduped. */
  invalid: string[];
}

/**
 * Tokens without "@" are dropped silently: in a pasted list they're names,
 * column headers or "Svensson" from `Anna Svensson <anna@x.se>`.
 */
export function parseEmailList(text: string): ParsedEmailList {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(SEPARATORS)) {
    // "Name<a@x.se>" without a space still carries the address after "<".
    const token = cleanToken(raw.includes("<") ? raw.slice(raw.lastIndexOf("<")) : raw);
    if (!token || !token.includes("@") || seen.has(token)) continue;
    seen.add(token);
    (isValidEmail(token) ? emails : invalid).push(token);
  }
  return { emails, invalid };
}

export type InviteEntryStatus = "new" | "invalid" | "member" | "invited";

export interface InviteEntry {
  email: string;
  status: InviteEntryStatus;
}

/**
 * Status per entry against what the dialog knows: current members and live
 * email invites. "new" is what gets sent.
 */
export function classifyInviteEmails(
  entries: string[],
  known: { memberEmails: Iterable<string>; invitedEmails: Iterable<string> }
): InviteEntry[] {
  const members = new Set([...known.memberEmails].map((e) => e.toLowerCase()));
  const invited = new Set([...known.invitedEmails].map((e) => e.toLowerCase()));
  return entries.map((email) => ({
    email,
    status: !isValidEmail(email)
      ? "invalid"
      : members.has(email)
        ? "member"
        : invited.has(email)
          ? "invited"
          : "new",
  }));
}

/** "24 to invite · 2 already members · 1 already invited · 1 not valid" */
export function inviteSummary(entries: InviteEntry[]): string {
  const count = (s: InviteEntryStatus) => entries.filter((e) => e.status === s).length;
  const parts = [
    `${count("new")} to invite`,
    count("member") > 0 && `${count("member")} already ${count("member") === 1 ? "a member" : "members"}`,
    count("invited") > 0 && `${count("invited")} already invited`,
    count("invalid") > 0 && `${count("invalid")} not valid`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * What invite_by_email skipped, for the toast after a send:
 * "Skipped 1 already a member · 2 already invited". Null when nothing was.
 */
export function skippedSummary(skipped: { reason: InviteSkipReason }[]): string | null {
  if (skipped.length === 0) return null;
  const status: Record<InviteSkipReason, InviteEntryStatus> = {
    invalid: "invalid",
    already_member: "member",
    already_invited: "invited",
  };
  const entries = skipped.map((s) => ({ email: "", status: status[s.reason] }));
  // Reuse the dialog's wording, minus its leading "0 to invite".
  return `Skipped ${inviteSummary(entries).split(" · ").slice(1).join(" · ")}`;
}

/** Server cap per send (invite_by_email raises too_many_emails above it). */
export const MAX_INVITES_PER_SEND = 200;
