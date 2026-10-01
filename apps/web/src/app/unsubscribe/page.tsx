/**
 * Unsubscribe from marketing email: the link in every marketing email's
 * footer (send-email). Public, like /join and /h: the token is the
 * credential. A button, not an automatic unsubscribe on load, because link
 * scanners and prefetchers open GET links; one-click from the mail client
 * goes to /api/unsubscribe instead.
 */
import type { Metadata } from "next";
import UnsubscribeView from "./unsubscribe-view";

export const metadata: Metadata = {
  title: "Unsubscribe — Scoutable",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ t?: string }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const { t } = await searchParams;
  return <UnsubscribeView token={t ?? ""} />;
}
