"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { useAuth } from "@/components/auth-context";
import { trackEvent } from "@/lib/analytics";
import { GET_THE_APP_PATH, storeUrlFor } from "@scoutable/shared/lib/store-links";

const DISMISSED_KEY = "scoutable_app_banner_dismissed";

/**
 * Players on a phone's browser: the app is the better place to watch.
 * Dismissed once, it stays away on that browser.
 */
export function GetTheAppBanner({ className }: { className?: string }) {
  const { activeOrgRole, isPlayerOnly } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private mode or blocked storage: show it, it can be closed.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser is only known after mount
    setShow(!dismissed && storeUrlFor(navigator.userAgent) !== null);
  }, []);

  if (!show || !(isPlayerOnly || activeOrgRole === "player")) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Then it comes back next time; nothing to do about it.
    }
    setShow(false);
  };

  return (
    <Callout
      tone="neutral"
      icon={<Smartphone />}
      className={className}
      action={
        <div className="flex items-center gap-1">
          <Button asChild size="xs">
            <Link href={GET_THE_APP_PATH} onClick={() => trackEvent("app_download_clicked", { surface: "banner" })}>
              Get the app
            </Link>
          </Button>
          <Button size="xs" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
            <X />
          </Button>
        </div>
      }
    >
      Scoutable is better in the app: your playlists, and a notification when a coach shares one.
    </Callout>
  );
}
