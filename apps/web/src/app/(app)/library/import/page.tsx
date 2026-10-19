"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ImportFlow } from "@/components/import/import-flow";
import { Page } from "@/components/shell/page";

/**
 * Importing a league game from the browser: pick the game, upload its
 * video, and our converter does the rest. Under /library so the Library
 * stays highlighted and the tab bar steps aside. `?match=<id>` resumes a flow
 * after a reload, or starts the upload for a game already in the library.
 */
export default function ImportGamePage() {
  return (
    <Page width="medium">
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <ImportFlow />
      </Suspense>
    </Page>
  );
}
