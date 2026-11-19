/**
 * A release's notes as the desktop's update card shows them. The notes are
 * the annotated tag's message (release.yml → the GitHub release body → the
 * landing site's /api/updates/latest → the updater's `body`), written by
 * hand, so this only tidies what a tag message tends to hold: "- " and "* "
 * bullets, a Markdown heading mark or **bold**, blank lines.
 */
export interface ReleaseNoteLine {
  kind: "text" | "bullet";
  text: string;
}

export function releaseNoteLines(body: string | null | undefined): ReleaseNoteLine[] {
  if (!body) return [];
  const lines: ReleaseNoteLine[] = [];
  for (const raw of body.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*•]\s+/.test(line);
    line = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .trim();
    if (line) lines.push({ kind: bullet ? "bullet" : "text", text: line });
  }
  return lines;
}

/** The site's page with every release's notes, newest first (scoutable.se, from the releases repo). */
export const WHATS_NEW_URL = "https://scoutable.se/whats-new";

/** Where in the desktop a visit to the page started; the site reads it as utm_medium. */
export type WhatsNewSource = "update_card" | "help_menu";

/** The page, tagged with where it was opened from, at one version's notes when given ("2.0.0" → #v2.0.0). */
export function whatsNewUrl(source: WhatsNewSource, version?: string | null): string {
  const anchor = version ? `#v${version.replace(/^v/, "")}` : "";
  return `${WHATS_NEW_URL}?utm_source=desktop&utm_medium=${source}${anchor}`;
}
