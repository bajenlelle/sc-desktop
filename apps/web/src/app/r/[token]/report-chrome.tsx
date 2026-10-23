"use client";

/**
 * The report page's few client-side parts: the sticky jump bar between
 * players, Save as PDF (the browser's own print dialog, so no PDF library), a
 * per-player QR for the printed copy, and the page-view event.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function ViewTracker({ valid, reason }: { valid: boolean; reason?: string }) {
  useEffect(() => {
    trackEvent("scouting_report_page_viewed", { valid, ...(reason ? { reason } : {}) });
    // Once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Lazy images only load near the viewport, so print would find blanks: load them all, then wait for them. */
async function loadAllImages() {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>("img[loading='lazy']"));
  images.forEach((img) => {
    img.loading = "eager";
  });
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
}

async function printReport() {
  await loadAllImages();
  trackEvent("scouting_report_pdf_saved");
  window.print();
}

/** Save as PDF. Only where there is a pointer: on a phone the share sheet's own print is the way. */
export function SaveAsPdf({ className }: { className?: string }) {
  // The desktop app opens the report in the system browser with #print: print on arrival.
  useEffect(() => {
    if (window.location.hash === "#print") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      void printReport();
    }
  }, []);
  return (
    <Button variant="outline" size="sm" onClick={() => void printReport()} className={cn("report-screen-only hidden [@media(pointer:fine)]:inline-flex", className)}>
      <Printer />
      Save as PDF
    </Button>
  );
}

export interface JumpItem {
  id: string;
  label: string;
}

/** A row of player chips under the header, for a report with three or more players. */
export function JumpBar({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        // The topmost section that is mostly in view.
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav
      aria-label="Players"
      className="report-screen-only sticky top-0 z-10 -mx-5 border-b border-separator bg-material-toolbar px-5 py-2 backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"
    >
      <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              aria-current={active === i.id ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-3 text-callout transition-colors duration-150 active:scale-[0.97]",
                active === i.id ? "bg-foreground text-background" : "bg-fill-2 text-foreground hover:bg-fill-3",
              )}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A QR that opens this player's section, for the printed page. Drawn after load, so the address is the page's own. */
export function PrintQr({ anchor }: { anchor: string }) {
  // The page's own address: known in the browser, absent while rendering on the server.
  const page = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}${window.location.pathname}`,
    () => null,
  );
  if (!page) return null;
  const url = `${page}#${anchor}`;
  return (
    <div className="report-print-only ml-auto w-[20mm] shrink-0 text-center">
      <QRCode value={url} size={256} style={{ width: "20mm", height: "20mm" }} />
      <p className="mt-1 text-footnote text-muted-foreground">Watch the clips</p>
    </div>
  );
}
