"use client";

/**
 * The report page's few client-side parts: the sticky jump bar between
 * players, Save as PDF (the browser's own print dialog, so no PDF library), a
 * per-player QR for the printed copy, the "Made with Scoutable" footer link,
 * and the page-view event that also counts the reader's open.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/logo";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { APP_OPEN_HASH, countsAsReaderOpen, recordScoutingReportOpen } from "@scoutable/shared/lib/scouting-reports-db";

/**
 * Where "Made with Scoutable" leads: the home page, tagged so the visits from
 * reports can be told apart. It points at the scouting report page once that exists.
 */
export const REPORT_FOOTER_URL = "https://scoutable.se/?utm_source=scouting_report&utm_medium=report_footer";

/**
 * Counts a reader's open: the page-view event, and (for a live report) the
 * report's open count. The coach opening their own link from the desktop app
 * (#app) or to print it (#print) is not a reader, so neither is counted.
 *
 * It renders before the document, so its effect reads #print before SaveAsPdf
 * strips it. #app is stripped here so a reload or a copied address from that
 * tab doesn't carry it on.
 */
export function ViewTracker({ valid, reason, id }: { valid: boolean; reason?: string; id?: string }) {
  const done = useRef(false);
  useEffect(() => {
    // Once per page load, also where React runs effects twice (development): the hash is gone the second time.
    if (done.current) return;
    done.current = true;
    const hash = window.location.hash;
    if (hash === APP_OPEN_HASH) history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!countsAsReaderOpen(hash)) return;
    trackEvent("scouting_report_page_viewed", { valid, ...(reason ? { reason } : {}) });
    if (valid && id) void recordScoutingReportOpen(createClient(), id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** "Made with Scoutable" at the foot of every report (on screen and in the saved PDF), with the click counted. */
export function FooterMark() {
  return (
    <footer className="report-footer mt-auto flex items-center justify-center gap-2 pt-6 text-callout text-muted-foreground">
      <span>Made with</span>
      <a href={REPORT_FOOTER_URL} target="_blank" rel="noreferrer noopener" aria-label="scoutable." onClick={() => trackEvent("scouting_report_footer_clicked")}>
        <Wordmark className="h-4 w-auto" />
      </a>
    </footer>
  );
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

/** A row of section chips under the header (Team, then the players), for a report with three or more sections. */
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
      aria-label="Sections"
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
