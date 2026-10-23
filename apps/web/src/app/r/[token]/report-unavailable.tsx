import { LogoMark } from "@/components/logo";

const COPY = {
  not_found: {
    title: "Report not found",
    body: "Check that you opened the full link, or ask whoever sent it for a new one.",
  },
  expired: {
    title: "This report has expired",
    body: "Reports work for 30 days. Ask whoever sent it for a new link.",
  },
  revoked: {
    title: "This report is no longer shared",
    body: "Whoever sent it stopped sharing. Ask them for a new link.",
  },
} as const;

/** Not found, expired or switched off: the page says which, and what to do. */
export function ReportUnavailable({ reason }: { reason: keyof typeof COPY }) {
  const { title, body } = COPY[reason];
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center gap-6 px-5 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(1.5rem+var(--safe-bottom))]">
      <LogoMark className="size-10 rounded-[9px] shadow-sm ring-1 ring-black/5" />
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <h1 className="text-title-3 text-foreground">{title}</h1>
        <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}
