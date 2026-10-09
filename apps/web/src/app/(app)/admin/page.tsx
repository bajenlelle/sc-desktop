"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FORM_ROW_DATE, FORM_ROW_INPUT, FormRow, GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState } from "@/components/empty-state";
import { LicenseBadge } from "@/components/license-badge";
import { SpaceAvatar } from "@/components/space-avatar";
import { AdminSections, useAdminGate } from "@/components/admin/admin-sections";
import { PlanTierMenu } from "@/components/admin/plan-tier-menu";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import {
  getAllOrgsWithCounts,
  createOrgForPlatform,
  sendEmailInvites,
  updateOrgPlanTier,
  unlockOrgPlanTier,
} from "@/lib/profile-db";
import type { OrgWithCount, OrgPlanTier } from "@scoutable/shared/types/org";
import { orgPlanLabel } from "@scoutable/shared/lib/plan-tier";
import { getLicenseState } from "@scoutable/shared/lib/license-state";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

type LicenseFilter = "all" | "expiring" | "expired" | "over_cap";

const FILTERS: Array<{ key: LicenseFilter; label: string }> = [
  { key: "all", label: "All licenses" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "over_cap", label: "Over cap" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function isOverCap(org: OrgWithCount): boolean {
  return (
    (org.coachSeatLimit != null && org.coachCount > org.coachSeatLimit) ||
    (org.playerSeatLimit != null && org.playerCount > org.playerSeatLimit)
  );
}

function matchesFilter(org: OrgWithCount, filter: LicenseFilter): boolean {
  if (filter === "all") return true;
  if (org.isPersonal) return false; // personal orgs have no franchise license
  const state = getLicenseState(org.expiresAt);
  if (filter === "expiring") {
    // 45-day window mirrors the platform digest, wider than the badge's 30.
    return (
      !!org.expiresAt &&
      state !== "grace" &&
      state !== "locked" &&
      new Date(org.expiresAt).getTime() - Date.now() <= 45 * 24 * 60 * 60 * 1000
    );
  }
  if (filter === "expired") return state === "grace" || state === "locked";
  return isOverCap(org);
}

/** A personal space goes by its owner: its name is the same for everyone. */
const displayName = (org: OrgWithCount) => (org.isPersonal ? (org.ownerEmail ?? "Personal") : org.name);

/**
 * One organization: the whole row opens it (a stretched link, so it opens in
 * a new tab too), while the plan menu sits above the link and stays its own
 * control. On a phone the license and plan take a line under the name.
 */
function OrgRow({
  org,
  onPlanChange,
  onUnlock,
}: {
  org: OrgWithCount;
  onPlanChange: (tier: OrgPlanTier) => void;
  onUnlock: () => void;
}) {
  const hasSeatLimits = org.coachSeatLimit != null || org.playerSeatLimit != null;
  const meta = org.isPersonal
    ? [`Created ${formatDate(org.createdAt)}`]
    : [plural(org.memberCount, "member"), plural(org.teamCount, "team"), `created ${formatDate(org.createdAt)}`];
  return (
    <div className="relative flex min-h-12 items-center gap-3 px-4 py-2 transition-colors duration-100 hover:bg-fill-1 has-[a:active]:bg-fill-2">
      <SpaceAvatar name={org.name} personal={org.isPersonal} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            href={`/admin/orgs/${org.id}`}
            className="truncate text-sm text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-selection"
          >
            {displayName(org)}
          </Link>
          <span className="text-callout text-muted-foreground nums">{meta.join(" · ")}</span>
          {hasSeatLimits && (
            <span className={cn("text-callout nums", isOverCap(org) ? "text-destructive" : "text-muted-foreground")}>
              {org.coachCount} of {org.coachSeatLimit ?? "∞"} coaches · {org.playerCount} of {org.playerSeatLimit ?? "∞"} players
            </span>
          )}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          {!org.isPersonal && <LicenseBadge expiresAt={org.expiresAt} />}
          <PlanTierMenu value={org.planTier} lockedAt={org.planTierLockedAt} onChange={onPlanChange} onUnlock={onUnlock} />
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </div>
  );
}

export default function AdminPage() {
  const checked = useAdminGate();
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<LicenseFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!checked) return;
    loadOrgs();
  }, [checked]);

  async function loadOrgs() {
    setLoading(true);
    try {
      setOrgs(await getAllOrgsWithCounts());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const visibleOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs.filter(
      (o) =>
        matchesFilter(o, filter) &&
        (!q || [o.name, o.ownerEmail, o.contactEmail].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [orgs, filter, query]);
  const clubs = visibleOrgs.filter((o) => !o.isPersonal);
  const personal = visibleOrgs.filter((o) => o.isPersonal);

  async function handlePlanTierChange(orgId: string, tier: OrgPlanTier) {
    try {
      await updateOrgPlanTier(orgId, tier);
      const lockedAt = new Date().toISOString();
      setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, planTier: tier, planTierLockedAt: lockedAt } : o));
      toast.success("Plan tier updated and locked");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleUnlockPlanTier(orgId: string) {
    try {
      await unlockOrgPlanTier(orgId);
      setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, planTierLockedAt: null } : o));
      toast.success("Plan tier unlocked — Stripe will drive future updates");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const section = (title: string, rows: OrgWithCount[]) =>
    rows.length > 0 && (
      <section>
        <GroupHeader
          title={
            <>
              {title} <span className="font-normal text-muted-foreground nums">{rows.length}</span>
            </>
          }
        />
        <GroupedList>
          {rows.map((org) => (
            <OrgRow
              key={org.id}
              org={org}
              onPlanChange={(tier) => void handlePlanTierChange(org.id, tier)}
              onUnlock={() => void handleUnlockPlanTier(org.id)}
            />
          ))}
        </GroupedList>
      </section>
    );

  return (
    <Page width="medium">
      <Toolbar
        title="Admin"
        subtitle={checked && !loading ? plural(orgs.length, "organization") : undefined}
        principal={<AdminSections current="orgs" />}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!checked} aria-label="New organization">
            <Plus />
            <span className="hidden sm:inline">New organization</span>
          </Button>
        }
      />
      <PageContent className="space-y-7">
        {!checked || loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* In the content, not the toolbar: the bar's centre belongs to the four sections. */}
            <div className="flex items-center gap-3">
              <SearchField
                className="min-w-0 flex-1 sm:max-w-xs"
                placeholder="Search organizations"
                aria-label="Search organizations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <PopUpButton
                size="sm"
                aria-label="License"
                align="end"
                className="ml-auto shrink-0"
                value={filter}
                onValueChange={setFilter}
                options={FILTERS.map((f) => ({
                  value: f.key,
                  label: `${f.label} (${orgs.filter((o) => matchesFilter(o, f.key)).length})`,
                }))}
              />
            </div>
            {orgs.length === 0 ? (
              <EmptyState
                icon={<Building2 />}
                title="No organizations yet"
                body="Set one up when a club signs on."
                action={
                  <Button size="sm" onClick={() => setDialogOpen(true)}>
                    New organization
                  </Button>
                }
              />
            ) : visibleOrgs.length === 0 ? (
              <EmptyState
                title="Nothing matches"
                body={query.trim() ? "No organizations match your search." : "No organizations match this filter."}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Show all
                  </Button>
                }
              />
            ) : (
              <>
                {section("Organizations", clubs)}
                {section("Personal spaces", personal)}
              </>
            )}
          </>
        )}
      </PageContent>

      <CreateOrgDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={loadOrgs} />
    </Page>
  );
}

/**
 * Org setup in one flow: name, plan, license, contact, and an optional email
 * invite for the customer's first admin — replaces the old name-only dialog
 * that left every new org unlimited/never-expiring until someone remembered
 * the license page.
 */
function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isNt, setIsNt] = useState(false);
  const [planTier, setPlanTier] = useState<OrgPlanTier>("franchise");
  const [coachSeats, setCoachSeats] = useState("");
  const [playerSeats, setPlayerSeats] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [creating, setCreating] = useState(false);

  function reset() {
    setName("");
    setIsNt(false);
    setPlanTier("franchise");
    setCoachSeats("");
    setPlayerSeats("");
    setExpiresAt("");
    setContactName("");
    setContactEmail("");
    setAdminEmail("");
  }

  async function handleCreate() {
    if (!name.trim()) return;
    const coach = coachSeats.trim() ? parseInt(coachSeats, 10) : null;
    const player = playerSeats.trim() ? parseInt(playerSeats, 10) : null;
    if ((coach != null && Number.isNaN(coach)) || (player != null && Number.isNaN(player))) {
      toast.error("Seat limits must be numbers.");
      return;
    }
    setCreating(true);
    try {
      const orgId = await createOrgForPlatform({
        name: name.trim(),
        isNtOrg: isNt,
        planTier,
        coachSeats: coach,
        playerSeats: player,
        // End of day, like the import-grants dialog — a license set to expire
        // "Mar 18" should last through Mar 18 locally, not die at UTC midnight.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
      });

      let summary = `${name.trim()} created`;
      if (adminEmail.trim()) {
        await sendEmailInvites(orgId, [adminEmail.trim()], "admin");
        summary += ` — admin invite sent to ${adminEmail.trim()}`;
      }
      toast.success(summary, {
        description:
          coach != null || player != null || expiresAt
            ? `${planTier} · ${coach ?? "∞"} coach / ${player ?? "∞"} player seats${
                expiresAt ? ` · expires ${expiresAt}` : ""
              }`
            : `${planTier} · no seat limits or expiry set`,
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A long form, as a macOS sheet does it: the fields scroll between a
          fixed title and fixed buttons. */}
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>Set the license up front, so a new club never starts unlimited and never expiring.</DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 space-y-5 overflow-y-auto px-6 py-px max-sm:-mx-5 max-sm:px-5">
          <GroupedList>
            <FormRow label="Name" htmlFor="org-name">
              <Input
                id="org-name"
                className={FORM_ROW_INPUT}
                placeholder="Club name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </FormRow>
            <FormRow label="National team" htmlFor="org-nt" description="Coaches join as secondary members">
              <Switch id="org-nt" checked={isNt} onCheckedChange={setIsNt} />
            </FormRow>
          </GroupedList>

          <section>
            <GroupHeader title="License" />
            <GroupedList>
              <FormRow label="Plan">
                <PopUpButton
                  aria-label="Plan"
                  align="end"
                  value={planTier}
                  onValueChange={setPlanTier}
                  options={(["franchise", "free", "rookie", "pro"] as const).map((t) => ({ value: t, label: orgPlanLabel(t) }))}
                />
              </FormRow>
              <FormRow label="Expires" htmlFor="org-expires" description="Blank: never">
                <Input id="org-expires" type="date" className={FORM_ROW_DATE} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </FormRow>
              <FormRow label="Coach seats" htmlFor="org-coach-seats">
                <Input
                  id="org-coach-seats"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="Unlimited"
                  className={FORM_ROW_INPUT}
                  value={coachSeats}
                  onChange={(e) => setCoachSeats(e.target.value)}
                />
              </FormRow>
              <FormRow label="Player seats" htmlFor="org-player-seats">
                <Input
                  id="org-player-seats"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="Unlimited"
                  className={FORM_ROW_INPUT}
                  value={playerSeats}
                  onChange={(e) => setPlayerSeats(e.target.value)}
                />
              </FormRow>
            </GroupedList>
          </section>

          <section>
            <GroupHeader title="Contact" />
            <GroupedList>
              <FormRow label="Name" htmlFor="org-contact-name">
                <Input
                  id="org-contact-name"
                  placeholder="Anna Andersson"
                  className={FORM_ROW_INPUT}
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </FormRow>
              <FormRow label="Email" htmlFor="org-contact-email">
                <Input
                  id="org-contact-email"
                  type="email"
                  placeholder="kansli@club.se"
                  className={FORM_ROW_INPUT}
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </FormRow>
            </GroupedList>
            <GroupFooter>The contact gets license expiry reminders alongside the organization&apos;s admins.</GroupFooter>
          </section>

          <section>
            <GroupHeader title="First admin" />
            <GroupedList>
              <FormRow label="Email" htmlFor="org-admin-email" description="Optional">
                <Input
                  id="org-admin-email"
                  type="email"
                  placeholder="coach@club.se"
                  className={FORM_ROW_INPUT}
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </FormRow>
            </GroupedList>
            <GroupFooter>
              They get an email with a join link and join as an admin. You can also make an invite code later, on the
              organization&apos;s page.
            </GroupFooter>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating && <Loader2 className="animate-spin" />}
            Create organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
