"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { subscribeGameUploadOutcomes, useGameUploadJobs } from "@/lib/game-upload";

/**
 * Keeps a browser upload company wherever the user goes in the app: a leave
 * warning while any upload runs (a closed tab loses the parts in flight, and
 * the user may not know the upload is still going), and a toast when an
 * upload finishes on a page that isn't showing it. In-app navigation never
 * touches the upload itself; the job lives in lib/game-upload.ts's store.
 */
export function GameUploadProvider({ children }: { children: React.ReactNode }) {
  const jobs = useGameUploadJobs();
  const uploading = jobs.length > 0;
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const router = useRouter();
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older engines show the returned string; current ones show their own.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  useEffect(
    () =>
      subscribeGameUploadOutcomes(({ matchId, title, outcome }) => {
        if (outcome !== "converting" && outcome !== "ready") return;
        const path = pathnameRef.current ?? "";
        const gamePath = `/games/${encodeURIComponent(matchId)}`;
        const onImport = path === "/games/import" && new URLSearchParams(window.location.search).get("match") === matchId;
        if (path === gamePath || onImport) return;
        toast.success(outcome === "ready" ? "Your game is ready" : "Your game is converting", {
          description: outcome === "ready" ? title : `${title}. We'll email you when it's ready to watch.`,
          duration: 10000,
          action: { label: "Open", onClick: () => router.push(gamePath) },
        });
      }),
    [router],
  );

  return <>{children}</>;
}
