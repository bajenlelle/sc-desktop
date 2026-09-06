"use client";

/**
 * Platform-admin instrument for account-sharing detection (v1: detect, don't
 * gate): accounts whose 30-day active device count exceeds their role's cap
 * (app_config: device_cap_player / device_cap_coach). This data validates the
 * caps before any user-facing enforcement ships.
 */
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Globe, Laptop, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { getOrgContext } from "@/lib/profile-db";
import { useAuth } from "@/components/auth-context";
import { listDeviceOutliers, type DeviceOutlier } from "@scoutable/shared/lib/devices-db";

const APP_ICON: Record<string, typeof Globe> = {
  web: Globe,
  desktop: Laptop,
  mobile: Smartphone,
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminDevicesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [outliers, setOutliers] = useState<DeviceOutlier[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    getOrgContext()
      .then((ctx) => {
        if (!ctx.profile.isPlatformAdmin) router.replace("/organization");
        else setChecked(true);
      })
      .catch(() => router.replace("/organization"));
  }, [user, router]);

  // loading starts true; the fetch runs once when the admin check clears.
  useEffect(() => {
    if (!checked) return;
    listDeviceOutliers(createClient())
      .then(setOutliers)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [checked]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (!checked) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Device outliers</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Accounts with more active devices (last 30 days) than their cap — possible account
          sharing. Caps live in app_config (device_cap_player / device_cap_coach).
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : outliers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No accounts over their device cap. Nothing to see — that&apos;s good.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Account</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Orgs</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Active devices</th>
                  </tr>
                </thead>
                <tbody>
                  {outliers.map((o) => (
                    <Fragment key={o.userId}>
                      <tr
                        onClick={() => toggle(o.userId)}
                        className="cursor-pointer border-b border-border hover:bg-muted/50"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {expanded.has(o.userId) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <p className="font-medium text-foreground">{o.fullName ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{o.email ?? "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize">{o.role}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {o.orgs.length > 0 ? o.orgs.join(", ") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="destructive">
                            {o.activeDevices} of {o.cap}
                          </Badge>
                          {o.blocked30d > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              blocked: {o.blocked30d} in 30d
                            </p>
                          )}
                        </td>
                      </tr>
                      {expanded.has(o.userId) && (
                        <tr className="border-b border-border bg-muted/30">
                          <td colSpan={4} className="px-4 py-3">
                            <ul className="space-y-2 pl-6">
                              {o.devices.map((d, i) => {
                                const Icon = APP_ICON[d.app] ?? Globe;
                                return (
                                  <li key={i} className="flex items-center gap-2 text-sm">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-foreground">
                                      {d.device_name ?? d.platform ?? "Unknown device"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      first seen {formatDate(d.first_seen)} · last active{" "}
                                      {formatDate(d.last_seen)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
