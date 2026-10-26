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
import { Button } from "@/components/ui/button";
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
      <div className="grid gap-2">
        <Button asChild className="w-full">
          <a href={APP_STORE_URL}>Download on the App Store</a>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <a href={PLAY_STORE_URL}>Get it on Google Play</a>
        </Button>
      </div>
    </AuthShell>
  );
}
