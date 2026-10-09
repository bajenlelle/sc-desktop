"use client";

/**
 * Platform-admin instrument for account-sharing detection (v1: detect, don't
 * gate): accounts whose 30-day active device count exceeds their role's cap
 * (app_config: device_cap_player / device_cap_coach). This data validates the
 * caps before any user-facing enforcement ships.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Globe, Laptop, Loader2, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { GroupFooter, GroupedList } from "@/components/ui/group";
import { EmptyState } from "@/components/empty-state";
import { AdminSections, useAdminGate } from "@/components/admin/admin-sections";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { createClient } from "@/lib/supabase/client";
import { listDeviceOutliers, type DeviceOutlier } from "@scoutable/shared/lib/devices-db";
import { formatDate } from "@/lib/format-date";
import { roleLabel } from "@/lib/roles";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const APP_ICON: Record<string, typeof Globe> = {
  web: Globe,
  desktop: Laptop,
  mobile: Smartphone,
};

/** One account over its cap; its devices open under it. */
function OutlierRow({ outlier: o, expanded, onToggle }: { outlier: DeviceOutlier; expanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <div className="flex min-h-12 items-center gap-3 py-2 pr-4 pl-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide devices" : "Show devices"}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-9"
        >
          <ChevronRight className={cn("size-4 transition-transform duration-200 ease-spring", expanded && "rotate-90")} />
        </button>
        {/* A pointer target only: the chevron is the keyboard control. */}
        <div onClick={onToggle} className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{o.fullName ?? o.email ?? "—"}</span>
          <span className="truncate text-callout text-muted-foreground">
            {[o.fullName ? o.email : null, roleLabel(o.role), o.orgs.length > 0 ? o.orgs.join(", ") : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="destructive" className="nums">
            {o.activeDevices} of {o.cap}
          </Badge>
          {o.blocked30d > 0 && (
            <span className="text-callout text-muted-foreground nums">{o.blocked30d} blocked in 30 days</span>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="devices"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.standard}
            className="overflow-hidden"
          >
            <ul className="border-t border-separator bg-fill-1/50 py-1">
              {o.devices.map((d, i) => {
                const Icon = APP_ICON[d.app] ?? Globe;
                return (
                  <li key={i} className="flex min-h-9 items-center gap-2.5 py-1.5 pr-4 pl-11">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-sm">{d.device_name ?? d.platform ?? "Unknown device"}</span>
                    <span className="ml-auto shrink-0 text-callout text-muted-foreground nums">
                      first seen {formatDate(d.first_seen, "short")} · last active {formatDate(d.last_seen, "short")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminDevicesPage() {
  const checked = useAdminGate();
  const [outliers, setOutliers] = useState<DeviceOutlier[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  return (
    <Page width="medium">
      <Toolbar title="Admin" subtitle="Accounts over their device cap" principal={<AdminSections current="devices" />} />
      <PageContent>
        {!checked || loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : outliers.length === 0 ? (
          <EmptyState
            icon={<MonitorSmartphone />}
            title="No one over their cap"
            body="No account has more active devices than its role allows."
          />
        ) : (
          <section>
            <GroupedList>
              {outliers.map((o) => (
                <OutlierRow key={o.userId} outlier={o} expanded={expanded.has(o.userId)} onToggle={() => toggle(o.userId)} />
              ))}
            </GroupedList>
            <GroupFooter>
              Active devices in the last 30 days against the role&apos;s cap: possible account sharing. Caps live in
              app_config (device_cap_player, device_cap_coach).
            </GroupFooter>
          </section>
        )}
      </PageContent>
    </Page>
  );
}
