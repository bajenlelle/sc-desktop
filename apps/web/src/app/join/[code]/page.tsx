/**
 * The landing of an invite link, /join/<CODE>.
 *
 * Server component so link unfurlers (iMessage, WhatsApp, Slack) get real
 * OpenGraph tags — "Join Hammarby Basket" — instead of the app's defaults.
 * The preview RPC is open to anon, which is what an unfurler is, and never
 * says who an emailed invite was sent to. The join itself is client work in
 * ./join-view.tsx. The pages are unlisted, so they are noindexed
 * (next.config.ts adds the header too).
 */
import type { Metadata } from "next";
import { cache } from "react";
import type { InvitePreview } from "@scoutable/shared/types/org";
import { createClient } from "@/lib/supabase/server";
import { asRole, inviteDestination, toInvitePreview, type InvitePreviewRow } from "@/lib/invite-preview";
import { INVITE_CODE } from "@/lib/pending-invite";
import JoinView from "./join-view";

// Deduped between generateMetadata and the page render.
const loadPreview = cache(async (code: string): Promise<InvitePreview> => {
  // Codes are six characters: anything else is not found without asking the database.
  if (!INVITE_CODE.test(code)) return { valid: false, reason: "not_found" };
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_invite_preview", { p_code: code.toUpperCase() });
    return toInvitePreview(data as InvitePreviewRow | null);
  } catch {
    return { valid: false, reason: "not_found" };
  }
});

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const preview = await loadPreview(code);
  const robots = { index: false, follow: false };
  if (!preview.valid) {
    return { title: "Invite — Scoutable", description: "This invite link is no longer valid.", robots };
  }
  const title = `Join ${inviteDestination(preview, "Scoutable")}`;
  const description = `You're invited${preview.role ? ` as ${asRole(preview.role)}` : ""}. Open the link to join on Scoutable.`;
  return {
    title: `${title} — Scoutable`,
    description,
    robots,
    openGraph: { title, description, type: "website", siteName: "Scoutable", url: `/join/${code.toUpperCase()}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const preview = await loadPreview(code);
  return <JoinView code={code} preview={preview} />;
}
