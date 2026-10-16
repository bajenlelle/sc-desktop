"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Check, Clipboard, Loader2, MoreHorizontal, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Callout, FORM_ROW_DATE, FORM_ROW_INPUT, FormRow, GroupFooter, GroupHeader, GroupRow, GroupedList } from "@/components/ui/group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { LicenseBadge } from "@/components/license-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { useAdminGate } from "@/components/admin/admin-sections";
import { PlanTierMenu } from "@/components/admin/plan-tier-menu";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { BackButton } from "@/components/shell/back-button";
import {
  getOrgById,
  getOrgMembersForAdmin,
  updateOrgNameForPlatform,
  generateAdminOrgInviteCode,
  updateOrgLicense,
  updateOrgContact,
  updateOrgPlanTier,
  listOrgLicenseEvents,
  promoteToAdmin,
  removeOrgMember,
  deleteOrgForPlatform,
} from "@/lib/profile-db";
import type {
  Organization,
  OrgLicenseEvent,
  OrgPlanTier,
  UserProfile,
} from "@scoutable/shared/types/org";
import { getLicenseState } from "@scoutable/shared/lib/license-state";
import { formatDate } from "@/lib/format-date";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

type Tab = "overview" | "members" | "invites";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function fmtDate(iso: string | number | null | undefined): string {
  if (iso == null) return "never";
  return formatDate(iso);
}

/** One-line human description of an audit event's change. */
function describeEvent(e: OrgLicenseEvent): string {
  const o = e.oldValues ?? {};
  const n = e.newValues ?? {};
  const seat = (v: string | number | null | undefined) => (v == null ? "∞" : String(v));
  switch (e.event) {
    case "org_created":
      return `Organization created — ${seat(n.coach_seat_limit)} coach / ${seat(n.player_seat_limit)} player seats, expires ${n.expires_at ? fmtDate(String(n.expires_at)) : "never"}`;
    case "license_updated": {
      const parts: string[] = [];
      if (o.coach_seat_limit !== n.coach_seat_limit)
        parts.push(`coach seats ${seat(o.coach_seat_limit)} → ${seat(n.coach_seat_limit)}`);
      if (o.player_seat_limit !== n.player_seat_limit)
        parts.push(`player seats ${seat(o.player_seat_limit)} → ${seat(n.player_seat_limit)}`);
      if (o.expires_at !== n.expires_at)
        parts.push(
          `expiry ${o.expires_at ? fmtDate(String(o.expires_at)) : "never"} → ${n.expires_at ? fmtDate(String(n.expires_at)) : "never"}`
        );
      return parts.length > 0 ? `License updated — ${parts.join(", ")}` : "License saved (no changes)";
    }
    case "plan_tier_updated":
      return `Plan tier ${o.plan_tier ?? "?"} → ${n.plan_tier ?? "?"}`;
    case "contact_updated":
      return `Contact updated — ${n.contact_name ?? "—"} (${n.contact_email ?? "—"})`;
    case "renewal_requested":
      return `Renewal requested by ${n.requester ?? "an org admin"}`;
  }
}

export default function OrgDetailPage() {
  const router = useRouter();
  const { id: orgId } = useParams<{ id: string }>();
  const checked = useAdminGate();

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<OrgLicenseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [licenseOpen, setLicenseOpen] = useState(false);
  const [editCoachSeats, setEditCoachSeats] = useState("");
  const [editPlayerSeats, setEditPlayerSeats] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [savingLicense, setSavingLicense] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [editContactName, setEditContactName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
  // Removing someone asks first, as on the Club page.
  const [removeTarget, setRemoveTarget] = useState<UserProfile | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!checked || !orgId) return;
    loadData();
  }, [checked, orgId]);

  async function loadData() {
    setLoading(true);
    try {
      const [orgData, membersData, eventsData] = await Promise.all([
        getOrgById(orgId),
        getOrgMembersForAdmin(orgId),
        listOrgLicenseEvents(orgId),
      ]);
      setOrg(orgData);
      setMembers(membersData);
      setEvents(eventsData);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveName() {
    if (!editName.trim() || !orgId) return;
    setSavingName(true);
    try {
      await updateOrgNameForPlatform(orgId, editName.trim());
      toast.success("Organization name updated");
      setEditNameOpen(false);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  function openLicenseDialog() {
    if (!org) return;
    setEditCoachSeats(org.coachSeatLimit !== null ? String(org.coachSeatLimit) : "");
    setEditPlayerSeats(org.playerSeatLimit !== null ? String(org.playerSeatLimit) : "");
    setEditExpiresAt(org.expiresAt ? new Date(org.expiresAt).toISOString().split("T")[0] : "");
    setLicenseOpen(true);
  }

  async function handleSaveLicense() {
    if (!orgId) return;
    const coachSeats = editCoachSeats.trim() ? parseInt(editCoachSeats, 10) : null;
    const playerSeats = editPlayerSeats.trim() ? parseInt(editPlayerSeats, 10) : null;
    if (
      (coachSeats != null && (Number.isNaN(coachSeats) || coachSeats < 0)) ||
      (playerSeats != null && (Number.isNaN(playerSeats) || playerSeats < 0))
    ) {
      toast.error("Seat limits must be zero or a positive number.");
      return;
    }
    setSavingLicense(true);
    try {
      // End of day, like the import-grants dialog — a license expiring
      // "Mar 18" should last through Mar 18 locally, not die at UTC midnight.
      const expiresAt = editExpiresAt.trim()
        ? new Date(`${editExpiresAt}T23:59:59`).toISOString()
        : null;
      await updateOrgLicense(orgId, coachSeats, playerSeats, expiresAt);
      toast.success("License updated", {
        description: `${coachSeats ?? "∞"} coach / ${playerSeats ?? "∞"} player seats · expires ${
          expiresAt ? fmtDate(expiresAt) : "never"
        }`,
      });
      setLicenseOpen(false);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingLicense(false);
    }
  }

  /** +1 year from the current dialog expiry (or today when unset/past). */
  function handleQuickRenew() {
    const base = editExpiresAt.trim() ? new Date(editExpiresAt) : new Date();
    const from = Number.isNaN(base.getTime()) || base.getTime() < Date.now() ? new Date() : base;
    from.setFullYear(from.getFullYear() + 1);
    setEditExpiresAt(from.toISOString().split("T")[0]);
  }

  function openContactDialog() {
    if (!org) return;
    setEditContactName(org.contactName ?? "");
    setEditContactEmail(org.contactEmail ?? "");
    setEditNotes(org.notes ?? "");
    setContactOpen(true);
  }

  async function handleSaveContact() {
    if (!orgId) return;
    setSavingContact(true);
    try {
      await updateOrgContact(
        orgId,
        editContactName.trim() || null,
        editContactEmail.trim() || null,
        editNotes.trim() || null
      );
      toast.success("Contact updated");
      setContactOpen(false);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingContact(false);
    }
  }

  async function handlePlanTierChange(tier: OrgPlanTier) {
    if (!orgId || !org) return;
    try {
      await updateOrgPlanTier(orgId, tier);
      setOrg({ ...org, planTier: tier });
      toast.success("Plan tier updated and locked");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handlePromote(memberId: string) {
    setPromotingId(memberId);
    try {
      await promoteToAdmin(memberId, orgId);
      toast.success("Member promoted to admin");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPromotingId(null);
    }
  }

  async function handleGenerateInvite() {
    setGeneratingInvite(true);
    try {
      const code = await generateAdminOrgInviteCode(orgId);
      setInviteCode(code);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeneratingInvite(false);
    }
  }

  function handleCopy() {
    if (!inviteCode) return;
    // A pasteable link, not just a code — recipients land on /join/{code}.
    navigator.clipboard.writeText(
      `Join ${org?.name ?? ""} on Scoutable: ${window.location.origin}/join/${inviteCode} (code ${inviteCode})`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDeleteOrg() {
    if (!orgId) return;
    setDeleting(true);
    try {
      await deleteOrgForPlatform(orgId);
      toast.success("Organization deleted");
      router.replace("/admin");
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setRemovingId(memberId);
    try {
      await removeOrgMember(memberId, orgId);
      toast.success("Member removed");
      setRemoveTarget(null);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  if (!checked || loading || !org) {
    return (
      <Page width="medium">
        <Toolbar inline title="Organization" leading={<BackButton href="/admin" label="Admin" />} />
        <PageContent>
          {!org && checked && !loading ? (
            <EmptyState
              title="Organization not found"
              body="It may have been deleted."
              action={
                <Button variant="outline" size="sm" onClick={() => router.push("/admin")}>
                  Back to Admin
                </Button>
              }
            />
          ) : (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </PageContent>
      </Page>
    );
  }

  const coachCount = members.filter((m) => m.role !== "player").length;
  const playerCount = members.filter((m) => m.role === "player").length;
  const licenseState = getLicenseState(org.expiresAt);
  const licenseNeedsLook = licenseState === "expiring" || licenseState === "grace" || licenseState === "locked";
  const seats = (count: number, limit: number | null) => (
    <span className={cn("nums", limit != null && count > limit && "text-destructive")}>
      {count} of {limit ?? "unlimited"}
    </span>
  );

  return (
    <Page width="medium">
      <Toolbar
        title={org.name}
        subtitle={`${plural(members.length, "member")} · created ${formatDate(org.createdAt)}`}
        leading={<BackButton href="/admin" label="Admin" />}
        principal={
          <SegmentedControl
            aria-label="Show"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "members", label: "Members" },
              { value: "invites", label: "Invites" },
            ]}
          />
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setEditName(org.name);
                  setEditNameOpen(true);
                }}
              >
                Rename…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-white" onSelect={() => setDeleteDialogOpen(true)}>
                Delete organization…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <PageContent className="space-y-7">
        {tab === "overview" && (
          <>
            <section>
              <GroupHeader
                title="License"
                action={
                  <Button size="xs" variant="ghost" className="text-primary" onClick={openLicenseDialog}>
                    Edit…
                  </Button>
                }
              />
              <GroupedList>
                <GroupRow label="Plan" trailing={<PlanTierMenu value={org.planTier} onChange={(t) => void handlePlanTierChange(t)} />} />
                <GroupRow
                  label="Expires"
                  trailing={
                    <>
                      {licenseNeedsLook && <LicenseBadge expiresAt={org.expiresAt} />}
                      <span className="nums">{org.expiresAt ? formatDate(org.expiresAt) : "Never"}</span>
                    </>
                  }
                />
                <GroupRow label="Coaches" trailing={seats(coachCount, org.coachSeatLimit)} />
                <GroupRow label="Players" trailing={seats(playerCount, org.playerSeatLimit)} />
              </GroupedList>
              <GroupFooter>A plan chosen here is set by hand: Stripe won&apos;t change it afterwards.</GroupFooter>
            </section>

            <section>
              <GroupHeader
                title="Contact and notes"
                action={
                  <Button size="xs" variant="ghost" className="text-primary" onClick={openContactDialog}>
                    Edit…
                  </Button>
                }
              />
              <GroupedList>
                {org.contactName || org.contactEmail || org.notes ? (
                  <>
                    {(org.contactName || org.contactEmail) && (
                      <>
                        <GroupRow label="Name" trailing={org.contactName ?? "—"} />
                        <GroupRow
                          label="Email"
                          trailing={
                            org.contactEmail ? (
                              <a href={`mailto:${org.contactEmail}`} className="text-primary underline-offset-2 hover:underline">
                                {org.contactEmail}
                              </a>
                            ) : (
                              "—"
                            )
                          }
                        />
                      </>
                    )}
                    {org.notes && <p className="px-4 py-2.5 text-sm whitespace-pre-wrap text-muted-foreground">{org.notes}</p>}
                  </>
                ) : (
                  <p className="px-4 py-3 text-callout text-muted-foreground">
                    No contact yet. The contact gets license expiry reminders alongside the organization&apos;s admins.
                  </p>
                )}
              </GroupedList>
            </section>

            <section>
              <GroupHeader title="License history" />
              <GroupedList>
                {events.length === 0 ? (
                  <p className="px-4 py-3 text-callout text-muted-foreground">No license changes recorded yet.</p>
                ) : (
                  events.map((e) => (
                    <div key={e.id} className="flex flex-col px-4 py-2">
                      <span className="text-sm text-foreground">{describeEvent(e)}</span>
                      <span className="text-callout text-muted-foreground nums">
                        {e.actorName}, {fmtDate(e.createdAt)}
                      </span>
                    </div>
                  ))
                )}
              </GroupedList>
            </section>
          </>
        )}

        {tab === "members" &&
          (members.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No members yet"
              body="Make an admin invite code to bring in the first admin."
              action={
                <Button size="sm" variant="outline" onClick={() => setTab("invites")}>
                  Invites
                </Button>
              }
            />
          ) : (
            (["admin", "coach", "player"] as const).map((role) => {
              const group = members.filter((m) => m.role === role);
              if (group.length === 0) return null;
              const label = role === "admin" ? "Admins" : role === "coach" ? "Coaches" : "Players";
              return (
                <section key={role}>
                  <GroupHeader
                    title={
                      <>
                        {label} <span className="font-normal text-muted-foreground nums">{group.length}</span>
                      </>
                    }
                  />
                  <GroupedList>
                    {group.map((m) => {
                      const name = m.fullName ?? m.email ?? m.id.slice(0, 8);
                      const busy = promotingId === m.id || removingId === m.id;
                      return (
                        <div key={m.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                          <PersonAvatar name={name} url={m.avatarUrl} className="size-7" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">{name}</span>
                            <span className="truncate text-callout text-muted-foreground nums">
                              {[m.fullName ? m.email : null, `joined ${formatDate(m.createdAt)}`].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                          {m.isPlatformAdmin ? (
                            <Badge variant="destructive">{roleLabel(m.role, true)}</Badge>
                          ) : (
                            <span className="shrink-0 text-callout text-muted-foreground">{roleLabel(m.role)}</span>
                          )}
                          {!m.isPlatformAdmin &&
                            (busy ? (
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${name}`}>
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {m.role !== "admin" && (
                                    <>
                                      <DropdownMenuItem onSelect={() => void handlePromote(m.id)}>Make admin</DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                    </>
                                  )}
                                  <DropdownMenuItem
                                    className="text-destructive focus:bg-destructive focus:text-white"
                                    onSelect={() => setRemoveTarget(m)}
                                  >
                                    Remove from organization…
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ))}
                        </div>
                      );
                    })}
                  </GroupedList>
                </section>
              );
            })
          ))}

        {tab === "invites" && (
          <section>
            <GroupHeader title="Admin invite code" />
            <GroupedList>
              {inviteCode ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="font-mono text-title-3 tracking-wider select-all">{inviteCode}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      {copied ? <Check className="text-success" /> : <Clipboard />}
                      {copied ? "Copied" : "Copy invite"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleGenerateInvite} disabled={generatingInvite}>
                      <RefreshCw className={cn(generatingInvite && "animate-spin")} />
                      {generatingInvite ? "Regenerating…" : "Regenerate"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                  <span className="text-sm text-muted-foreground">No code yet.</span>
                  <Button size="sm" onClick={handleGenerateInvite} disabled={generatingInvite}>
                    {generatingInvite && <Loader2 className="animate-spin" />}
                    Generate code
                  </Button>
                </div>
              )}
            </GroupedList>
            <GroupFooter>
              A single-use code that makes whoever uses it an admin of {org.name}. Copy invite copies a join link with the
              code.
            </GroupFooter>
          </section>
        )}
      </PageContent>

      {/* Rename */}
      <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename organization</DialogTitle>
          </DialogHeader>
          <GroupedList>
            <FormRow label="Name" htmlFor="org-rename">
              <Input
                id="org-rename"
                className={FORM_ROW_INPUT}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                autoFocus
              />
            </FormRow>
          </GroupedList>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveName} disabled={savingName || !editName.trim()}>
              {savingName && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteDialogOpen} onOpenChange={(o) => !deleting && setDeleteDialogOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {org.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the organization. Its members are detached from it, but their accounts stay. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteOrg} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />}
              Delete organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove a member */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && !removingId && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Remove {removeTarget?.fullName ?? removeTarget?.email} from {org.name}?
            </DialogTitle>
            <DialogDescription>
              They lose access to the organization&apos;s teams and shared playlists. They can be invited again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!removingId} onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!removingId} onClick={() => removeTarget && void handleRemoveMember(removeTarget.id)}>
              {removingId && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* License */}
      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit license</DialogTitle>
          </DialogHeader>
          <GroupedList>
            <FormRow label="Coach seats" htmlFor="license-coach">
              <Input
                id="license-coach"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="Unlimited"
                className={FORM_ROW_INPUT}
                value={editCoachSeats}
                onChange={(e) => setEditCoachSeats(e.target.value)}
              />
            </FormRow>
            <FormRow label="Player seats" htmlFor="license-player">
              <Input
                id="license-player"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="Unlimited"
                className={FORM_ROW_INPUT}
                value={editPlayerSeats}
                onChange={(e) => setEditPlayerSeats(e.target.value)}
              />
            </FormRow>
            <FormRow label="Expires" htmlFor="license-expires" description="Blank: never">
              <Input
                id="license-expires"
                type="date"
                className={FORM_ROW_DATE}
                value={editExpiresAt}
                onChange={(e) => setEditExpiresAt(e.target.value)}
              />
              <Button type="button" size="xs" variant="outline" className="shrink-0" onClick={handleQuickRenew}>
                +1 year
              </Button>
            </FormRow>
          </GroupedList>
          <p className="-mt-2 px-1 text-subheadline text-muted-foreground">The license lasts through the whole expiry day.</p>
          {(() => {
            const c = editCoachSeats.trim() ? parseInt(editCoachSeats, 10) : null;
            const p = editPlayerSeats.trim() ? parseInt(editPlayerSeats, 10) : null;
            const belowCoach = c != null && !Number.isNaN(c) && c < coachCount;
            const belowPlayer = p != null && !Number.isNaN(p) && p < playerCount;
            if (!belowCoach && !belowPlayer) return null;
            return (
              <Callout tone="warning">
                {belowCoach && `Coach limit is below the current ${coachCount} coaches. `}
                {belowPlayer && `Player limit is below the current ${playerCount} players. `}
                Existing members keep access, but no one new can join.
              </Callout>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLicenseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLicense} disabled={savingLicense}>
              {savingLicense && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact and notes */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contact and notes</DialogTitle>
          </DialogHeader>
          <section>
            <GroupedList>
              <FormRow label="Name" htmlFor="contact-name">
                <Input
                  id="contact-name"
                  placeholder="Anna Andersson"
                  className={FORM_ROW_INPUT}
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />
              </FormRow>
              <FormRow label="Email" htmlFor="contact-email">
                <Input
                  id="contact-email"
                  type="email"
                  placeholder="kansli@club.se"
                  className={FORM_ROW_INPUT}
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                />
              </FormRow>
            </GroupedList>
            <GroupFooter>Gets license expiry reminders alongside the organization&apos;s admins.</GroupFooter>
          </section>
          <Textarea
            aria-label="Notes"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            rows={4}
            placeholder="Contract terms, renewal history, who to call…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveContact} disabled={savingContact}>
              {savingContact && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
