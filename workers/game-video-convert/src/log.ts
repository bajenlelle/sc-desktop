/**
 * One line per event, `[convert <videoId> a<attempt>] key=value …`, built so
 * that nothing which must not reach Workers Logs or a terminal can: URLs are
 * replaced before printing and the values registered as secrets are blanked.
 */
const MAX_MESSAGE = 300;
const MIN_SECRET_LENGTH = 8;

export interface Logger {
  (fields: Record<string, unknown>): void;
  setAttempt(attempt: number): void;
  /** Error text safe for a public log: no URLs, no registered secrets, one bounded line. */
  safe(e: unknown): string;
}

export function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number") {
      parts.push(`${key}=${Number.isInteger(value) ? value : Number(value.toFixed(3))}`);
      continue;
    }
    const text = typeof value === "string" ? value : typeof value === "boolean" ? String(value) : JSON.stringify(value);
    parts.push(`${key}=${/[\s"=]/.test(text) || text === "" ? JSON.stringify(text) : text}`);
  }
  return parts.join(" ");
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= MIN_SECRET_LENGTH) out = out.split(s).join("<secret>");
  return out
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE);
}

export function createLogger(videoId: string, secrets: readonly (string | null | undefined)[] = [], write: (line: string) => void = (line) => console.log(line)): Logger {
  const known = secrets.filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET_LENGTH);
  let attempt = 0;
  const safe = (e: unknown): string => redact(e instanceof Error ? e.message : String(e), known);
  const log = ((fields: Record<string, unknown>) => {
    write(redact(`[convert ${videoId} a${attempt}] ${formatFields(fields)}`, known));
  }) as Logger;
  log.setAttempt = (n: number) => {
    attempt = n;
  };
  log.safe = safe;
  return log;
}
