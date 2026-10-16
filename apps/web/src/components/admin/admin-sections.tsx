"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { getOrgContext } from "@/lib/profile-db";

export type AdminSection = "orgs" | "imports" | "feedback" | "devices";

const SECTIONS: { value: AdminSection; href: string; label: React.ReactNode; title: string }[] = [
  {
    value: "orgs",
    href: "/admin",
    // Four segments share a phone's width: the long one shortens there.
    label: (
      <>
        <span className="sm:hidden">Orgs</span>
        <span className="hidden sm:inline">Organizations</span>
      </>
    ),
    title: "Organizations",
  },
  { value: "imports", href: "/admin/imports", label: "Imports", title: "Import grants and free refills" },
  { value: "feedback", href: "/admin/feedback", label: "Feedback", title: "Problem reports" },
  { value: "devices", href: "/admin/devices", label: "Devices", title: "Accounts over their device cap" },
];

/**
 * Platform admins only: anyone else is sent to their club, as before.
 * True once the check has passed.
 */
export function useAdminGate(): boolean {
  const router = useRouter();
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!user) return;
    getOrgContext()
      .then((ctx) => {
        if (!ctx.profile.isPlatformAdmin) router.replace("/organization");
        else setChecked(true);
      })
      .catch(() => router.replace("/organization"));
  }, [user, router]);
  return checked;
}

/**
 * Admin's sections as a segmented control in the toolbar, as Activity
 * Monitor switches its views: peers, so no section needs a back button.
 */
export function AdminSections({ current }: { current: AdminSection }) {
  const router = useRouter();
  useEffect(() => {
    for (const s of SECTIONS) if (s.value !== current) router.prefetch(s.href);
  }, [current, router]);
  return (
    <SegmentedControl
      aria-label="Admin section"
      value={current}
      onValueChange={(v) => router.push(SECTIONS.find((s) => s.value === v)!.href)}
      options={SECTIONS.map(({ value, label, title }) => ({ value, label, title }))}
    />
  );
}
