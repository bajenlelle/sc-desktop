"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, Copy, Link2, Loader2, Settings2, X } from "lucide-react";
import {
  sendEmailInvites,
  getOrCreateLinkInvite,
  updateOrgInviteExpiry,
  deleteOrgInvite,
} from "@/lib/profile-db";
import type { OrgInvite, OrgTeam } from "@scoutable/shared/types/org";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "coach" | "player" | "admin";

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  orgName: string;
  orgTeams: OrgTeam[];
  isAdmin: boolean;
  initialTeamId?: string;
}

const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "7 days", hours: 7 * 24 },
  { label: "30 days", hours: 30 * 24 },
  { label: "Never", hours: null },
];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const APP_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "https://app.scoutable.se";

// ---------------------------------------------------------------------------
// InviteModal
// ---------------------------------------------------------------------------

export function InviteModal({
  open,
  onClose,
  orgId,
  orgName,
  orgTeams,
  isAdmin,
  initialTeamId,
}: InviteModalProps) {
  const [selectedRole, setSelectedRole] = useState<Role>("coach");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initialTeamId ?? null);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);

  // Link invite state
  const [linkInvite, setLinkInvite] = useState<OrgInvite | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [settingsExpiryHours, setSettingsExpiryHours] = useState<number | null>(30 * 24);
  const [savingSettings, setSavingSettings] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setEmails([]);
      setEmailInput("");
      setShowSettings(false);
      setSelectedRole("coach");
      setSelectedTeamId(initialTeamId ?? null);
      setLinkInvite(null);
    }
  }, [open]);

  // Load link invite when role or team changes
  useEffect(() => {
    if (!open) return;
    loadLinkInvite(selectedRole, selectedTeamId);
  }, [open, selectedRole, selectedTeamId]);

  async function loadLinkInvite(role: Role, teamId: string | null) {
    setLoadingLink(true);
    try {
      const invite = await getOrCreateLinkInvite(orgId, role, teamId);
      setLinkInvite(invite);
      setSettingsExpiryHours(
        invite.expiresAt
          ? Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 3600000)
          : null
      );
    } catch {
      setLinkInvite(null);
    } finally {
      setLoadingLink(false);
    }
  }

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!isValidEmail(email)) {
      toast.error(`"${email}" is not a valid email address`);
      return;
    }
    if (emails.includes(email)) return;
    setEmails((prev) => [...prev, email]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(emailInput);
      setEmailInput("");
    } else if (e.key === "Backspace" && !emailInput && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function handleBlur() {
    if (emailInput.trim()) {
      addEmail(emailInput);
      setEmailInput("");
    }
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
  }

  async function handleSend() {
    if (emails.length === 0) return;
    setSending(true);
    try {
      const count = await sendEmailInvites(orgId, emails, selectedRole, selectedTeamId);
      toast.success(`Invitation${count !== 1 ? "s" : ""} sent to ${count} address${count !== 1 ? "es" : ""}`);
      setEmails([]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function handleCopyLink() {
    if (!linkInvite) return;
    const url = `${APP_URL}/join/${linkInvite.code}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  async function handleSaveSettings() {
    if (!linkInvite) return;
    setSavingSettings(true);
    try {
      await updateOrgInviteExpiry(linkInvite.id, settingsExpiryHours);
      toast.success("Link settings saved");
      setShowSettings(false);
      await loadLinkInvite(selectedRole, selectedTeamId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeactivate() {
    if (!linkInvite) return;
    setDeactivating(true);
    try {
      await deleteOrgInvite(linkInvite.id);
      setLinkInvite(null);
      setShowSettings(false);
      toast.success("Invite link deactivated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeactivating(false);
    }
  }

  const roleOptions: { value: Role; label: string }[] = [
    { value: "coach", label: "Coach" },
    { value: "player", label: "Player" },
    ...(isAdmin ? [{ value: "admin" as Role, label: "Admin" }] : []),
  ];

  const selectedTeamName = orgTeams.find((t) => t.id === selectedTeamId)?.name ?? null;

  const linkLabel = (() => {
    const teamPart = selectedTeamName ? ` to ${selectedTeamName}` : "";
    return `Copy ${selectedRole} link${teamPart}`;
  })();

  const expiryLabel = (() => {
    if (!linkInvite?.expiresAt) return "no expiry";
    const msLeft = new Date(linkInvite.expiresAt).getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / 86400000);
    if (daysLeft <= 0) return "expired";
    return `expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
  })();

  // ── Settings panel ──────────────────────────────────────────────────────────
  if (showSettings) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitation link settings</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-1">
            This link can be shared with multiple people.
          </p>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as Role)}
              >
                {roleOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Expires after</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={settingsExpiryHours === null ? "null" : String(settingsExpiryHours)}
                onChange={(e) => setSettingsExpiryHours(e.target.value === "null" ? null : Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.label} value={o.hours === null ? "null" : String(o.hours)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive text-xs"
              onClick={handleDeactivate}
              disabled={deactivating}
            >
              {deactivating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Deactivate link
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSettings(false)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </Button>
              <Button size="sm" onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main panel ──────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite people to {orgName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Role + Team selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as Role)}
                disabled={!isAdmin}
              >
                {roleOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {orgTeams.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Team <span className="text-muted-foreground font-normal">(optional)</span></label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedTeamId ?? ""}
                  onChange={(e) => setSelectedTeamId(e.target.value || null)}
                >
                  <option value="">No specific team</option>
                  {orgTeams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.season ? ` (${t.season})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Email chip input */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email addresses</label>
            <div
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 flex flex-wrap gap-1.5 cursor-text"
              onClick={() => inputRef.current?.focus()}
            >
              {emails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1 font-medium"
                >
                  {email}
                  <button
                    type="button"
                    className="hover:text-primary/60 transition-colors"
                    onClick={(e) => { e.stopPropagation(); removeEmail(email); }}
                    aria-label={`Remove ${email}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder={emails.length === 0 ? "Type email and press Enter…" : ""}
                className="flex-1 min-w-[160px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground">Press Enter or comma to add each address.</p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Persistent link */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-medium">{linkLabel}</span>
                {linkInvite && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({expiryLabel})</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {loadingLink ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={handleCopyLink}
                  disabled={!linkInvite}
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? "Copied!" : "Copy"}
                </Button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  onClick={() => setShowSettings(true)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Edit settings
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={emails.length === 0 || sending}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {sending ? "Sending…" : `Send${emails.length > 0 ? ` (${emails.length})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
