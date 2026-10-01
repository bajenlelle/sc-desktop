import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, Link2, Loader2, Settings2, X } from "lucide-react";
import {
  classifyInviteEmails,
  inviteSummary,
  isValidEmail,
  MAX_INVITES_PER_SEND,
  parseEmailList,
  skippedSummary,
  type InviteEntry,
} from "@scoutable/shared/lib/email-list";
import { seatsLeftLabel } from "@scoutable/shared/lib/license-state";
import {
  sendEmailInvites,
  resendOrgInvite,
  listOrgInvites,
  getOrCreateLinkInvite,
  updateOrgInviteExpiry,
  deleteOrgInvite,
  markOrgInviteCopied,
} from "@/lib/profile-db";
import type { OrgInvite, OrgTeam, UserProfile } from "@/types/org";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

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
  orgMembers: UserProfile[];
  isAdmin: boolean;
  initialTeamId?: string;
  /** Preselect a role (e.g. the admin setup checklist's invite steps). */
  initialRole?: Role;
  licenseExpired?: boolean;
  /** For the "more invites than seats" warning; omitted or null = no limit. */
  coachSeatLimit?: number | null;
  playerSeatLimit?: number | null;
}

const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "7 days", hours: 7 * 24 },
  { label: "30 days", hours: 30 * 24 },
  { label: "Never", hours: null },
];

/** Not expired and not used up: the invite still blocks a second one. */
function isLiveInvite(i: OrgInvite, now = Date.now()): boolean {
  return (
    (i.expiresAt === null || new Date(i.expiresAt).getTime() > now) &&
    (i.maxUses === null || i.usedCount < i.maxUses)
  );
}

const APP_URL = "https://app.scoutable.se";

// ---------------------------------------------------------------------------
// InviteModal
// ---------------------------------------------------------------------------

export function InviteModal({
  open,
  onClose,
  orgId,
  orgName,
  orgTeams,
  orgMembers,
  isAdmin,
  initialTeamId,
  initialRole,
  licenseExpired,
  coachSeatLimit,
  playerSeatLimit,
}: InviteModalProps) {
  const [selectedRole, setSelectedRole] = useState<Role>(initialRole ?? "coach");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initialTeamId ?? null);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);

  // Pending email invites (for duplicate detection)
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>([]);

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
  // Whether this send used a paste, for analytics.
  const pastedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setEmails([]);
      setEmailInput("");
      pastedRef.current = false;
      setShowSettings(false);
      setSelectedRole(initialRole ?? "coach");
      setSelectedTeamId(initialTeamId ?? null);
      setLinkInvite(null);
      listOrgInvites(orgId).then((invites) =>
        setPendingInvites(invites.filter((i) => !!i.email && i.maxUses === 1))
      );
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    loadLinkInvite(selectedRole, selectedTeamId);
  }, [open, selectedRole, selectedTeamId]);

  async function loadLinkInvite(role: Role, teamId: string | null) {
    if (licenseExpired) {
      setLinkInvite(null);
      return;
    }
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

  function findPendingInvite(email: string): OrgInvite | null {
    return pendingInvites.find((i) => i.email?.toLowerCase() === email && isLiveInvite(i)) ?? null;
  }

  // Status per chip, derived so it stays right if the invite list loads late.
  const liveInviteEmails = useMemo(
    () => pendingInvites.flatMap((i) => (i.email && isLiveInvite(i) ? [i.email] : [])),
    [pendingInvites]
  );
  const entries: InviteEntry[] = useMemo(
    () =>
      classifyInviteEmails(emails, {
        memberEmails: orgMembers.flatMap((m) => (m.email ? [m.email] : [])),
        invitedEmails: liveInviteEmails,
      }),
    [emails, orgMembers, liveInviteEmails]
  );
  const toInvite = entries.filter((e) => e.status === "new").map((e) => e.email);
  const invalidCount = entries.filter((e) => e.status === "invalid").length;
  const overCap = toInvite.length > MAX_INVITES_PER_SEND;

  // Seats are taken when people join, not when they're invited, so this only
  // warns. Coach seats cover admins too (join_by_code counts them together).
  const seatRole = selectedRole === "player" ? "player" : "coach";
  const seatLimit = seatRole === "player" ? playerSeatLimit : coachSeatLimit;
  const seatsUsed = orgMembers.filter((m) =>
    seatRole === "player" ? m.role === "player" : m.role !== "player"
  ).length;
  const seatsLeft = seatLimit == null ? null : Math.max(0, seatLimit - seatsUsed);
  const overSeats = seatsLeft !== null && toInvite.length > seatsLeft;

  /** Adds every address in text; a typed word without "@" becomes a red chip. */
  function addFromText(text: string) {
    const parsed = parseEmailList(text);
    const found = [...parsed.emails, ...parsed.invalid];
    const added = found.length > 0 ? found : text.trim() ? [text.trim().toLowerCase()] : [];
    if (added.length === 0) return;
    setEmails((prev) => {
      const seen = new Set(prev);
      return [...prev, ...added.filter((e) => !seen.has(e))];
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      addFromText(emailInput);
      setEmailInput("");
    } else if (e.key === "Backspace" && !emailInput && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    // One plain address pastes as text, so it can still be edited before Enter.
    if (!/[,;\s]/.test(text.trim())) return;
    e.preventDefault();
    pastedRef.current = true;
    addFromText(`${emailInput} ${text}`);
    setEmailInput("");
  }

  function handleBlur() {
    if (emailInput.trim()) {
      addFromText(emailInput);
      setEmailInput("");
    }
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
  }

  /** Invalid chip → back into the input for fixing. */
  function editEmail(email: string) {
    removeEmail(email);
    setEmailInput(email);
    inputRef.current?.focus();
  }

  async function handleResend(email: string) {
    const invite = findPendingInvite(email);
    if (!invite) return;
    try {
      await resendOrgInvite(invite.id);
      removeEmail(email);
      window.dispatchEvent(new CustomEvent("org-setup-changed"));
      toast.success(`Invite resent to ${email}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleSend() {
    if (toInvite.length === 0 || overCap) return;
    setSending(true);
    try {
      const result = await sendEmailInvites(orgId, toInvite, selectedRole, selectedTeamId);
      const sent = result.sent.length;
      const skipped = (reason: string) => result.skipped.filter((x) => x.reason === reason).length;
      trackEvent("invite_emails_sent", {
        count: sent,
        submitted: toInvite.length,
        skipped_member: entries.filter((x) => x.status === "member").length + skipped("already_member"),
        skipped_invited: entries.filter((x) => x.status === "invited").length + skipped("already_invited"),
        invalid: invalidCount + skipped("invalid"),
        role: selectedRole,
        has_team: !!selectedTeamId,
        pasted: pastedRef.current,
      });
      window.dispatchEvent(new CustomEvent("org-setup-changed"));
      const description = skippedSummary(result.skipped) ?? undefined;
      if (sent > 0) {
        toast.success(`${sent} invite${sent === 1 ? "" : "s"} sent`, { description });
        setEmails([]);
        onClose();
      } else {
        toast.error("No invites sent", { description });
      }
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
    trackEvent("invite_link_copied", { role: selectedRole });
    // Copying IS the "invite your coaches/players" onboarding action — stamp
    // it (fire-and-forget, never blocking the copy UX) so the admin setup
    // checklist can check the step, and poke any mounted checklist to refresh.
    markOrgInviteCopied(linkInvite.id)
      .then(() => window.dispatchEvent(new CustomEvent("org-setup-changed")))
      .catch(() => {});
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
      setShowSettings(false);
      toast.success("Invite link deactivated");
      await loadLinkInvite(selectedRole, selectedTeamId);
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

        {licenseExpired && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <p className="font-semibold text-destructive">License expired</p>
            <p className="text-muted-foreground mt-0.5">
              New invites are paused until your license is renewed.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {/* Role + Team selectors */}
          <div className="grid grid-cols-2 gap-3">
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

          <p className="text-xs text-muted-foreground">
            Coaches can invite players and other coaches themselves — you don&apos;t have to
            send every invite.
          </p>

          {/* Email chip input: type, or paste a whole list */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium">
                Email addresses
                {emails.length > 0 && (
                  <span className="font-normal text-muted-foreground"> ({emails.length})</span>
                )}
              </label>
              {emails.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEmails([])}
                >
                  Clear all
                </button>
              )}
            </div>
            <div
              className="min-h-[80px] max-h-40 overflow-y-auto w-full rounded-md border border-input bg-background px-3 py-2 flex flex-wrap content-start gap-1.5 cursor-text"
              onClick={() => inputRef.current?.focus()}
            >
              {entries.map((entry) => (
                <EmailChip
                  key={entry.email}
                  entry={entry}
                  onRemove={() => removeEmail(entry.email)}
                  onEdit={() => editEmail(entry.email)}
                  onResend={() => handleResend(entry.email)}
                />
              ))}
              <input
                ref={inputRef}
                type="text"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={handleBlur}
                placeholder={emails.length === 0 ? "Paste a list or type an email…" : ""}
                className="flex-1 min-w-[160px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {entries.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {inviteSummary(entries)}
                {invalidCount > 0 && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setEmails((prev) => prev.filter(isValidEmail))}
                    >
                      Remove not valid
                    </button>
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Paste a list from a spreadsheet, an email or a file, or type addresses and press Enter.
              </p>
            )}
            {overCap && (
              <p className="text-xs text-destructive">
                You can send up to {MAX_INVITES_PER_SEND} invites at a time. Remove some, or send the rest
                afterwards.
              </p>
            )}
            {!overCap && overSeats && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                {toInvite.length} {seatRole} invites, {seatsLeftLabel(seatsUsed, seatLimit, seatRole)}.
                Invites past the limit can&apos;t be accepted until seats free up.
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Persistent link */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex items-center gap-2 min-w-0 text-left group disabled:opacity-50"
              onClick={handleCopyLink}
              disabled={!linkInvite || loadingLink || licenseExpired}
              title={licenseExpired ? "License expired" : undefined}
            >
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-medium group-hover:underline underline-offset-2">
                  {copiedLink ? "Copied!" : linkLabel}
                </span>
                {linkInvite && !copiedLink && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({expiryLabel})</span>
                )}
              </div>
              {loadingLink
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                : copiedLink
                ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                : null}
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Edit settings
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={toInvite.length === 0 || overCap || sending || licenseExpired}
            title={licenseExpired ? "License expired — inviting is paused" : undefined}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            {sending
              ? "Sending…"
              : toInvite.length > 0
                ? `Send ${toInvite.length} invite${toInvite.length === 1 ? "" : "s"}`
                : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// EmailChip — one address in the input, styled by what will happen to it
// ---------------------------------------------------------------------------

function EmailChip({
  entry,
  onRemove,
  onEdit,
  onResend,
}: {
  entry: InviteEntry;
  onRemove: () => void;
  onEdit: () => void;
  onResend: () => void;
}) {
  const tone =
    entry.status === "new"
      ? "bg-primary/10 text-primary"
      : entry.status === "invalid"
        ? "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30"
        : "bg-muted text-muted-foreground";
  const title =
    entry.status === "invalid"
      ? "Not a valid email address. Click to edit."
      : entry.status === "member"
        ? "Already a member of this organization"
        : entry.status === "invited"
          ? "Already has a pending invite"
          : undefined;

  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 rounded-full text-xs px-2.5 py-1 font-medium ${tone}`}
    >
      {entry.status === "invalid" ? (
        <button
          type="button"
          className="truncate"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          {entry.email}
        </button>
      ) : (
        <span className="truncate">{entry.email}</span>
      )}
      {entry.status === "member" && <span className="font-normal">· member</span>}
      {entry.status === "invited" && (
        <>
          <span className="font-normal">· invited</span>
          <button
            type="button"
            className="font-normal underline underline-offset-2 hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onResend(); }}
          >
            Resend
          </button>
        </>
      )}
      <button
        type="button"
        className="opacity-70 hover:opacity-100 transition-opacity"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove ${entry.email}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
