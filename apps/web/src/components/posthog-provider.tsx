"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initAnalytics, stashAttribution, trackEvent } from "@/lib/analytics";

/**
 * Explicit pageview tracking (capture_pageview is off). Because playlist
 * opens are URL-driven (/my-playlists?p={id}), pageviews double as
 * playlist-open telemetry via the playlist_open property.
 * useSearchParams requires a Suspense boundary in the app router.
 */
function PageTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    stashAttribution(searchParams);
    trackEvent("page_viewed", {
      path: pathname,
      playlist_open: searchParams.get("p") ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PageTracker />
      </Suspense>
      {children}
    </>
  );
}
