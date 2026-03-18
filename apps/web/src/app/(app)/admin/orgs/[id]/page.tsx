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

export default function OrgDetailPage() {
  const router = useRouter();
  const { id: orgId } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [checked, setChecked] = useState(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);

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

  function openEditDialog() {
    setEditName(org?.name ?? "");
    setEditDialogOpen(true);
  }

  async function handleSaveName() {
    if (!editName.trim() || !orgId) return;
    setSaving(true);
    try {
      await updateOrgNameForPlatform(orgId, editName.trim());
      toast.success("Organization name updated");
      setEditDialogOpen(false);
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
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
        <Button variant="outline" size="sm" onClick={openEditDialog}>
          Edit Name
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="pt-4">
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
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
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
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
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
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveName} disabled={saving || !editName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
