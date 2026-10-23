/**
 * The public scouting report page: the landing spot for the link a coach
 * shares from the desktop app. No auth (outside the (app) group, like /h and
 * /join): the report's id is a 122-bit uuid, it expires after 30 days, and the
 * coach can switch it off. Read through get_scouting_report, the one anonymous
 * door (the table itself is the owner's).
 *
 * The link goes to staff and players, often through a chat that unfurls it:
 * the metadata carries the title, the opponent and counts, never a player's
 * name, stat or note. Unlisted, so noindexed (and next.config.ts adds the
 * header, Referrer-Policy and no-store for /r/*).
 */
import type { Metadata } from "next";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getScoutingReport, type ScoutingReportPage } from "@scoutable/shared/lib/scouting-reports-db";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import { ReportDocument } from "./report-document";
import { ReportUnavailable } from "./report-unavailable";
import { ViewTracker } from "./report-chrome";
import "./report.css";

// Deduped between generateMetadata and the page render.
const loadReport = cache(async (token: string): Promise<ScoutingReportPage> => {
  // The id is a uuid: anything else is not found without asking the database.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return { valid: false, reason: "not_found" };
  try {
    const supabase = await createClient();
    return await getScoutingReport(supabase, token);
  } catch {
    return { valid: false, reason: "not_found" };
  }
});

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const page = await loadReport(token);
  const robots = { index: false, follow: false, nocache: true };
  if (!page.valid) return { title: "Scouting report — Scoutable", robots };
  const { header } = page.report;
  const description = [
    `${header.players} ${header.players === 1 ? "player" : "players"}`,
    `${header.clips} ${header.clips === 1 ? "clip" : "clips"}`,
    `Prepared ${formatCardDate(header.preparedAt)}`,
  ].join(" · ");
  return {
    title: `${page.title} — Scoutable`,
    description,
    robots,
    referrer: "no-referrer",
    openGraph: { title: page.title, description, type: "website", siteName: "Scoutable", url: `/r/${token}` },
    twitter: { card: "summary_large_image", title: page.title, description },
  };
}

export default async function ScoutingReportPage({ params }: Props) {
  const { token } = await params;
  const page = await loadReport(token);
  if (!page.valid) {
    return (
      <>
        <ViewTracker valid={false} reason={page.reason} />
        <ReportUnavailable reason={page.reason} />
      </>
    );
  }
  // The public media bucket's address; without it the clips read "unavailable".
  const mediaBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? null;
  return (
    <>
      <ViewTracker valid />
      <ReportDocument report={page.report} mediaBase={mediaBase} />
    </>
  );
}
