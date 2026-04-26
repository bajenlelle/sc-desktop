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
  removeOrgMember,
  deleteOrgForPlatform,
} from "@/lib/profile-db";
import type { Organization, UserProfile } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { ArrowLeft, Clipboard, Check, RefreshCw } from "lucide-react";

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

function expiryBadge(expiresAt: string | null): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (!expiresAt) return { label: "No expiry", variant: "secondary" };
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = ms / 1000 / 60 / 60 / 24;
  if (days < 0) return { label: "Expired", variant: "destructive" };
  if (days < 30) return { label: `Expires in ${Math.ceil(days)}d`, variant: "default" };
  return { label: new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), variant: "secondary" };
}

export default function OrgDetailPage() {
  const router = useRouter();
  const { id: orgId } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [checked, setChecked] = useState(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [licenseOpen, setLicenseOpen] = useState(false);
  const [editCoachSeats, setEditCoachSeats] = useState("");
  const [editPlayerSeats, setEditPlayerSeats] = useState("");
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [savingLicense, setSavingLicense] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
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
      const [orgData, membersData] = await Promise.all([
        getOrgById(orgId),
        getOrgMembersForAdmin(orgId),
      ]);
      setOrg(orgData);
      setMembers(membersData);
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
    setSavingLicense(true);
    try {
      const coachSeats = editCoachSeats.trim() ? parseInt(editCoachSeats) : null;
      const playerSeats = editPlayerSeats.trim() ? parseInt(editPlayerSeats) : null;
      const expiresAt = editExpiresAt.trim() ? new Date(editExpiresAt).toISOString() : null;
      await updateOrgLicense(orgId, coachSeats, playerSeats, expiresAt);
      toast.success("License updated");
      setLicenseOpen(false);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingLicense(false);
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
    navigator.clipboard.writeText(`Join ${org?.name ?? ""} on Scoutable — Code: ${inviteCode}`);
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
      await removeOrgMember(memberId);
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
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading…</p>
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
  const expiry = expiryBadge(org.expiresAt);

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
                  <Badge variant={expiry.variant} className="text-xs">{expiry.label}</Badge>
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
              </div>
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
                    <span className="text-sm">{m.fullName ?? m.id.slice(0, 8)}</span>
                    <Badge variant={roleBadgeVariant(m.role, m.isPlatformAdmin)} className="text-xs">
                      {m.isPlatformAdmin ? "platform admin" : m.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
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
              <Input
                type="date"
                value={editExpiresAt}
                onChange={(e) => setEditExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLicenseOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveLicense} disabled={savingLicense}>
              {savingLicense ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
