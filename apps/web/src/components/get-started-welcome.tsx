"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResendWelcome } from "@/components/resend-welcome";
import { useHandheld } from "@/lib/handheld";

/** The welcome card's action: the email link on a phone or tablet, the download button on a computer. */
export function GetStartedWelcome() {
  const handheld = useHandheld();
  if (handheld) return <ResendWelcome />;
  return (
    <>
      <p className="max-w-md text-sm text-muted-foreground">
        Scouting lives in the desktop app. Download it, sign in with this account, and you&apos;ll find a sample
        game ready to explore.
      </p>
      <Button asChild className="mt-2">
        <a href="https://scoutable.se/en/download" target="_blank" rel="noreferrer">
          <Download />
          Download the desktop app
        </a>
      </Button>
    </>
  );
}
