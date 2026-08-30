"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getOrgContext,
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
import { LicenseBadge } from "@/components/license-badge";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { ArrowLeft, Clipboard, Check, Loader2, RefreshCw } from "lucide-react";

function roleBadgeVariant(
  role: string,
  isPlatformAdmin = false
): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

function fmtDate(iso: string | number | null | undefined): string {
  if (iso == null) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const { user } = useAuth();

  const [checked, setChecked] = useState(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<OrgLicenseEvent[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    getOrgContext()
      .then((ctx) => {
        if (!ctx.profile.isPlatformAdmin) {
          router.replace("/organization");
        } else {
          setChecked(true);
        }
      })
      .catch(() => router.replace("/organization"));
  }, [user]);

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
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  if (!checked || loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!org) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-red-500">Organization not found.</p>
      </div>
    );
  }

  const coachCount = members.filter((m) => m.role !== "player").length;
  const playerCount = members.filter((m) => m.role === "player").length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Platform Admin
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{org.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setEditName(org.name); setEditNameOpen(true); }}>
            Edit Name
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Members" value={members.length} />
            <StatCard label="Expires" value={org.expiresAt ? fmtDate(org.expiresAt) : "Never"} />
            <StatCard
              label="Created"
              value={new Date(org.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            />
          </div>

          {/* License card */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">License</p>
                <div className="flex items-center gap-2">
                  <LicenseBadge expiresAt={org.expiresAt} />
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openLicenseDialog}>
                    Edit
                  </Button>
                </div>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Coaches</span>
                  <p className="font-semibold">
                    {coachCount} / {org.coachSeatLimit !== null ? org.coachSeatLimit : "∞"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Players</span>
                  <p className="font-semibold">
                    {playerCount} / {org.playerSeatLimit !== null ? org.playerSeatLimit : "∞"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Plan tier</span>
                  <select
                    value={org.planTier}
                    onChange={(e) => handlePlanTierChange(e.target.value as OrgPlanTier)}
                    className="mt-0.5 block text-xs rounded border border-border bg-background px-2 py-1 cursor-pointer"
                  >
                    <option value="free">Free</option>
                    <option value="rookie">Rookie</option>
                    <option value="pro">Pro</option>
                    <option value="franchise">Franchise</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact & notes */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Contact &amp; notes</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openContactDialog}>
                  Edit
                </Button>
              </div>
              {org.contactName || org.contactEmail || org.notes ? (
                <div className="space-y-1 text-sm">
                  {(org.contactName || org.contactEmail) && (
                    <p>
                      {org.contactName ?? "—"}
                      {org.contactEmail && (
                        <span className="text-muted-foreground"> · {org.contactEmail}</span>
                      )}
                    </p>
                  )}
                  {org.notes && (
                    <p className="text-muted-foreground whitespace-pre-wrap">{org.notes}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No contact yet. Add one — the contact gets license expiry reminders alongside org
                  admins.
                </p>
              )}
            </CardContent>
          </Card>

          {/* License history */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">License history</p>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No license changes recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <span className="text-foreground">{describeEvent(e)}</span>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        — {e.actorName}, {fmtDate(e.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members" className="pt-4">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{m.fullName ?? m.email ?? m.id.slice(0, 8)}</span>
                    <Badge variant={roleBadgeVariant(m.role, m.isPlatformAdmin)} className="text-xs">
                      {m.isPlatformAdmin ? "platform admin" : m.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    {!m.isPlatformAdmin && m.role !== "admin" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={promotingId === m.id}
                        onClick={() => handlePromote(m.id)}
                      >
                        {promotingId === m.id ? "Promoting…" : "Promote to admin"}
                      </Button>
                    )}
                    {!m.isPlatformAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        disabled={removingId === m.id}
                        onClick={() => handleRemoveMember(m.id)}
                      >
                        {removingId === m.id ? "Removing…" : "Remove"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Invites */}
        <TabsContent value="invites" className="pt-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Admin Invite Code</p>
              <p className="text-xs text-muted-foreground">
                Generate a single-use admin invite code for this organization.
              </p>
              {inviteCode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono text-sm font-medium shrink-0">
                    {inviteCode}
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleCopy}>
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clipboard className="h-3.5 w-3.5" />}
                    {copied ? "Copied!" : "Copy Invite"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs gap-1.5 text-muted-foreground"
                    onClick={handleGenerateInvite}
                    disabled={generatingInvite}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${generatingInvite ? "animate-spin" : ""}`} />
                    {generatingInvite ? "Regenerating…" : "Regenerate"}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={handleGenerateInvite}
                  disabled={generatingInvite}
                >
                  {generatingInvite ? "Generating…" : "Generate Code"}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Name Dialog */}
      <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization Name</DialogTitle>
          </DialogHeader>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNameOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveName} disabled={savingName || !editName.trim()}>
              {savingName ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Org Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {org.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the organization. All members will be detached from the org but their accounts remain intact. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteOrg} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit License Dialog */}
      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit License</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Coach seat limit (blank = unlimited)</label>
              <Input
                type="number"
                min="0"
                placeholder="Unlimited"
                value={editCoachSeats}
                onChange={(e) => setEditCoachSeats(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Player seat limit (blank = unlimited)</label>
              <Input
                type="number"
                min="0"
                placeholder="Unlimited"
                value={editPlayerSeats}
                onChange={(e) => setEditPlayerSeats(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Expiry date (blank = never)</label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={editExpiresAt}
                  onChange={(e) => setEditExpiresAt(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0 text-xs"
                  onClick={handleQuickRenew}
                >
                  +1 year
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The license lasts through the whole expiry day.
              </p>
            </div>
            {(() => {
              const c = editCoachSeats.trim() ? parseInt(editCoachSeats, 10) : null;
              const p = editPlayerSeats.trim() ? parseInt(editPlayerSeats, 10) : null;
              const belowCoach = c != null && !Number.isNaN(c) && c < coachCount;
              const belowPlayer = p != null && !Number.isNaN(p) && p < playerCount;
              if (!belowCoach && !belowPlayer) return null;
              return (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {belowCoach && `Coach limit is below the current ${coachCount} coaches. `}
                  {belowPlayer && `Player limit is below the current ${playerCount} players. `}
                  Existing members keep access, but no one new can join.
                </p>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLicenseOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLicense} disabled={savingLicense}>
              {savingLicense ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact & notes dialog */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact &amp; notes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact name</label>
              <Input
                placeholder="Anna Andersson"
                value={editContactName}
                onChange={(e) => setEditContactName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contact email</label>
              <Input
                type="email"
                placeholder="kansli@club.se"
                value={editContactEmail}
                onChange={(e) => setEditContactEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Gets license expiry reminders alongside org admins.
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
                placeholder="Contract terms, renewal history, who to call…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveContact} disabled={savingContact}>
              {savingContact ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
