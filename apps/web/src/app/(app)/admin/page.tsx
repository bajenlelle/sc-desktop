"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getAllOrgsWithCounts, createOrgForPlatform, updateOrgPlanTier } from "@/lib/profile-db";
import type { OrgWithCount, OrgPlanTier } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { getOrgContext } from "@/lib/profile-db";

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgIsNt, setNewOrgIsNt] = useState(false);
  const [creating, setCreating] = useState(false);

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

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreating(true);
    try {
      await createOrgForPlatform(newOrgName.trim(), newOrgIsNt);
      toast.success("Organization created");
      setNewOrgName("");
      setNewOrgIsNt(false);
      setDialogOpen(false);
      await loadOrgs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handlePlanTierChange(orgId: string, tier: OrgPlanTier) {
    try {
      await updateOrgPlanTier(orgId, tier);
      setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, planTier: tier } : o));
      toast.success("Plan tier updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!checked) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Platform Admin</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">All organizations on the platform</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>+ Create Org</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : orgs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No organizations yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Members</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Teams</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Plan</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => (
                    <tr
                      key={org.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/admin/orgs/${org.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">{org.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{org.memberCount}</td>
                      <td className="px-4 py-3 text-muted-foreground">{org.teamCount}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={org.planTier}
                          onChange={(e) => handlePlanTierChange(org.id, e.target.value as OrgPlanTier)}
                          className="text-xs rounded border border-border bg-background px-2 py-1 cursor-pointer"
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="max">Max</option>
                          <option value="franchise">Franchise</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(org.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/orgs/${org.id}`);
                          }}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Organization name"
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
            autoFocus
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newOrgIsNt}
              onChange={(e) => setNewOrgIsNt(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <div>
              <span className="text-sm font-medium">National Team organization</span>
              <p className="text-xs text-muted-foreground">Coaches join as secondary members (no org switch required)</p>
            </div>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrg} disabled={creating || !newOrgName.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
