"use client";

import { Loader2 } from "lucide-react";
import { AdminSections, useAdminGate } from "@/components/admin/admin-sections";
import { FreeRefills } from "@/components/admin/free-refills";
import { ImportGrants } from "@/components/admin/import-grants";
import { PlayerPurchases } from "@/components/admin/player-purchases";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";

/** Imports given by hand: campaign grants, refills of the free tier, and player purchases. */
export default function AdminImportsPage() {
  const checked = useAdminGate();
  return (
    <Page width="medium">
      <Toolbar title="Admin" subtitle="Import grants, free refills and player purchases" principal={<AdminSections current="imports" />} />
      <PageContent className="space-y-10">
        {!checked ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <ImportGrants />
            <FreeRefills />
            <PlayerPurchases />
          </>
        )}
      </PageContent>
    </Page>
  );
}
