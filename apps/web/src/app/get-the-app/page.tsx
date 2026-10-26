/**
 * One link to the mobile app, whatever opens it: a phone is sent straight
 * to its store (the user agent decides, on the server), a computer gets a
 * QR code to scan plus both stores. Public, so it works from an email or
 * a chat as well as from the join page.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APP_STORE_URL, GET_THE_APP_PATH, PLAY_STORE_URL, storeUrlFor } from "@scoutable/shared/lib/store-links";
import { AuthHeading, AuthShell } from "@/components/auth/auth-frame";
import { StoreQr } from "./store-qr";

export const metadata: Metadata = {
  title: "Get the app — Scoutable",
  description: "Scoutable for players is an app for iPhone and Android.",
};

export default async function GetTheAppPage() {
  const store = storeUrlFor((await headers()).get("user-agent"));
  if (store) redirect(store);

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.scoutable.se";
  return (
    <AuthShell>
      <AuthHeading
        title="Get the Scoutable app"
        description="Scoutable for players is an app for iPhone and Android. Scan the code with your phone, or open this page there."
      />
      <StoreQr url={`${origin}${GET_THE_APP_PATH}`} />
      {/* The stores' own badges (public/badges), as their guidelines ask.
          Google's has padding built in, so it is drawn taller to match. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <a href={APP_STORE_URL} className="inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-selection">
          {/* eslint-disable-next-line @next/next/no-img-element -- official badge artwork, sized by attributes */}
          <img src="/badges/app-store.svg" alt="Download on the App Store" width={120} height={40} />
        </a>
        <a href={PLAY_STORE_URL} className="inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-selection">
          {/* eslint-disable-next-line @next/next/no-img-element -- official badge artwork, sized by attributes */}
          <img src="/badges/google-play.png" alt="Get it on Google Play" width={140} height={54} />
        </a>
      </div>
    </AuthShell>
  );
}
