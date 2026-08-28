/**
 * Public highlight page — the landing spot for the desktop app's
 * "Send to my phone" QR code. No auth (lives outside the (app) group, like
 * /join): the share id is a 122-bit uuid and the row expires after 30 days.
 *
 * Server component so link unfurlers (iMessage, WhatsApp, Slack, Instagram
 * DMs) get real OpenGraph tags: the highlight's title, a generated poster
 * image (./opengraph-image.tsx), and an og:video pointing at the MP4.
 * The pages are unlisted and expiring, so they are noindexed.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getHighlightShare } from "@scoutable/shared/lib/highlight-shares-db";
import HighlightView, { type HighlightShareResult } from "./highlight-view";

// Deduped between generateMetadata and the page render.
const loadShare = cache(async (shareId: string): Promise<HighlightShareResult> => {
  try {
    const supabase = await createClient();
    return await getHighlightShare(supabase, shareId);
  } catch {
    return { valid: false, reason: "not_found" };
  }
});

type Props = { params: Promise<{ shareId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareId } = await params;
  const share = await loadShare(shareId);
  const robots = { index: false, follow: false };
  if (!share.valid) {
    return { title: "Highlight — Scoutable", robots };
  }
  const description = "Basketball highlight made with Scoutable — every clip, every game, automatically.";
  return {
    title: `${share.title} — Scoutable`,
    description,
    robots,
    openGraph: {
      title: share.title,
      description,
      type: "video.other",
      siteName: "Scoutable",
      url: `/h/${shareId}`,
      videos: [{ url: share.url, type: "video/mp4" }],
    },
    twitter: {
      card: "summary_large_image",
      title: share.title,
      description,
    },
  };
}

export default async function HighlightSharePage({ params }: Props) {
  const { shareId } = await params;
  const share = await loadShare(shareId);
  return <HighlightView share={share} />;
}
