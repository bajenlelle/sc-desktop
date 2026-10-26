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
