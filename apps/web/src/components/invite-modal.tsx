"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
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
import type { OrgInvite, OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { trackEvent } from "@/lib/analytics";
import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout, FormRow, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";

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

const EXPIRY_OPTIONS = [
  { value: String(7 * 24), label: "7 days" },
  { value: String(30 * 24), label: "30 days" },
  { value: "never", label: "Never" },
] as const;

/** Not expired and not used up: the invite still blocks a second one. */
function isLiveInvite(i: OrgInvite, now = Date.now()): boolean {
  return (
    (i.expiresAt === null || new Date(i.expiresAt).getTime() > now) &&
    (i.maxUses === null || i.usedCount < i.maxUses)
  );
}

const APP_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}`
    : "https://app.scoutable.se";
const NO_TEAM = "none";

/**
 * Inviting people to a club: by email (a token field that takes a pasted
 * list) or with a link anyone can use. The link's settings are a second page
 * of the same dialog that cross-fades in, rather than a second dialog.
 */
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
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>([]);

  const [linkInvite, setLinkInvite] = useState<OrgInvite | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const [page, setPage] = useState<"main" | "link">("main");
  const [settingsExpiryHours, setSettingsExpiryHours] = useState<number | null>(30 * 24);
  const [savingSettings, setSavingSettings] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  /** Whether this send used a paste, for analytics. */
  const pastedRef = useRef(false);

  // Reset on open + load pending email invites for duplicate detection
  useEffect(() => {
    if (!open) return;
    setEmails([]);
    setEmailInput("");
    pastedRef.current = false;
    setPage("main");
    setSelectedRole(initialRole ?? "coach");
    setSelectedTeamId(initialTeamId ?? null);
    setLinkInvite(null);
    listOrgInvites(orgId)
      .then((invites) => setPendingInvites(invites.filter((i) => !!i.email && i.maxUses === 1)))
      .catch(() => setPendingInvites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load link invite when role or team changes
  useEffect(() => {
    if (!open) return;
    void loadLinkInvite(selectedRole, selectedTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        invite.expiresAt ? Math.round((new Date(invite.expiresAt).getTime() - Date.now()) / 3600000) : null,
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
    [pendingInvites],
  );
  const entries: InviteEntry[] = useMemo(
    () =>
      classifyInviteEmails(emails, {
        memberEmails: orgMembers.flatMap((m) => (m.email ? [m.email] : [])),
        invitedEmails: liveInviteEmails,
      }),
    [emails, orgMembers, liveInviteEmails],
  );
  const toInvite = entries.filter((e) => e.status === "new").map((e) => e.email);
  const invalidCount = entries.filter((e) => e.status === "invalid").length;
  const overCap = toInvite.length > MAX_INVITES_PER_SEND;

  // Seats are taken when people join, not when they're invited, so this only
  // warns. Coach seats cover admins too (join_by_code counts them together).
  const seatRole = selectedRole === "player" ? "player" : "coach";
  const seatLimit = seatRole === "player" ? playerSeatLimit : coachSeatLimit;
  const seatsUsed = orgMembers.filter((m) => (seatRole === "player" ? m.role === "player" : m.role !== "player")).length;
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
    // One plain address pastes as text, so it can still be edited before Return.
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

  /** An address that isn't valid goes back into the field for fixing. */
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
    void navigator.clipboard.writeText(`${APP_URL}/join/${linkInvite.code}`);
    trackEvent("invite_link_copied", { role: selectedRole });
    // Copying is the "invite your coaches/players" onboarding step: stamp it
    // (never blocking the copy) so the admin setup checklist can tick it.
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
      setPage("main");
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
      setPage("main");
      toast.success("Invite link turned off");
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
  const teamOptions = [
    { value: NO_TEAM, label: "No specific team" },
    ...orgTeams.map((t) => ({ value: t.id, label: t.season ? `${t.name} (${t.season})` : t.name })),
  ];
  const selectedTeamName = orgTeams.find((t) => t.id === selectedTeamId)?.name ?? null;
  const roleWord = roleOptions.find((o) => o.value === selectedRole)?.label ?? "Coach";

  const expiryText = (() => {
    if (!linkInvite?.expiresAt) return "Never expires";
    const daysLeft = Math.ceil((new Date(linkInvite.expiresAt).getTime() - Date.now()) / 86400000);
    if (daysLeft <= 0) return "Expired";
    return `Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
  })();

  const rolePopUp = (id: string) => (
    <PopUpButton id={id} aria-label="Role" value={selectedRole} onValueChange={setSelectedRole} options={roleOptions} />
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            {page === "link" ? (
              <motion.div key="link" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="grid gap-4">
                <DialogHeader>
                  <DialogTitle>Invite link settings</DialogTitle>
                  <DialogDescription>Anyone with the link can join {orgName} as a {roleWord.toLowerCase()}.</DialogDescription>
                </DialogHeader>
                <GroupedList>
                  <FormRow label="Role" htmlFor="invite-link-role">
                    {rolePopUp("invite-link-role")}
                  </FormRow>
                  <FormRow label="Expires after" htmlFor="invite-link-expiry">
                    <PopUpButton
                      id="invite-link-expiry"
                      aria-label="Expires after"
                      value={
                        settingsExpiryHours === null
                          ? "never"
                          : (EXPIRY_OPTIONS.find((o) => o.value === String(settingsExpiryHours))?.value ?? null)
                      }
                      placeholder={settingsExpiryHours === null ? "Never" : `${Math.round(settingsExpiryHours / 24)} days`}
                      onValueChange={(v) => setSettingsExpiryHours(v === "never" ? null : Number(v))}
                      options={EXPIRY_OPTIONS}
                    />
                  </FormRow>
                </GroupedList>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    className="mr-auto text-destructive"
                    onClick={handleDeactivate}
                    disabled={deactivating || !linkInvite}
                  >
                    {deactivating && <Loader2 className="animate-spin" />}
                    Turn off link
                  </Button>
                  <Button variant="outline" onClick={() => setPage("main")}>
                    <ChevronLeft />
                    Back
                  </Button>
                  <Button onClick={handleSaveSettings} disabled={savingSettings || !linkInvite}>
                    {savingSettings && <Loader2 className="animate-spin" />}
                    Save
                  </Button>
                </DialogFooter>
              </motion.div>
            ) : (
              <motion.div key="main" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="grid gap-4">
                <DialogHeader>
                  <DialogTitle>Invite people to {orgName}</DialogTitle>
                  <DialogDescription>
                    Each person gets an email with a link to join. Coaches can invite players and other coaches
                    themselves.
                  </DialogDescription>
                </DialogHeader>

                {licenseExpired && (
                  <Callout tone="destructive">Inviting is paused until the license is renewed.</Callout>
                )}

                <GroupedList>
                  <FormRow label="Role" htmlFor="invite-role">
                    {rolePopUp("invite-role")}
                  </FormRow>
                  {orgTeams.length > 0 && (
                    <FormRow label="Team" htmlFor="invite-team">
                      <PopUpButton
                        id="invite-team"
                        aria-label="Team"
                        value={selectedTeamId ?? NO_TEAM}
                        onValueChange={(v) => setSelectedTeamId(v === NO_TEAM ? null : v)}
                        options={teamOptions}
                      />
                    </FormRow>
                  )}
                </GroupedList>

                {/* A token field: type and press Return, or paste a whole list. */}
                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between px-1">
                    <label htmlFor="invite-emails" className="text-headline">
                      Email addresses
                      {emails.length > 0 && <span className="font-normal text-muted-foreground nums"> {emails.length}</span>}
                    </label>
                    {emails.length > 0 && (
                      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setEmails([])}>
                        Clear all
                      </Button>
                    )}
                  </div>
                  <div
                    className="flex max-h-40 min-h-20 w-full cursor-text flex-wrap content-start gap-1.5 overflow-y-auto rounded-window bg-card px-2.5 py-2 shadow-xs ring-1 ring-separator transition-shadow focus-within:ring-2 focus-within:ring-selection"
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
                      id="invite-emails"
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
                      placeholder={emails.length === 0 ? "Paste a list or type an address" : ""}
                      className="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="px-1 text-callout text-muted-foreground">
                    {entries.length > 0 ? (
                      <>
                        {inviteSummary(entries)}
                        {invalidCount > 0 && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="text-primary outline-none hover:underline focus-visible:underline"
                              onClick={() => setEmails((prev) => prev.filter(isValidEmail))}
                            >
                              Remove the ones that aren&apos;t valid
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      "From a spreadsheet, an email or a file; or type an address and press Return."
                    )}
                  </p>
                  {overCap && (
                    <Callout tone="destructive">
                      You can send up to {MAX_INVITES_PER_SEND} invites at a time. Remove some, or send the rest
                      afterwards.
                    </Callout>
                  )}
                  {!overCap && overSeats && (
                    <Callout tone="warning">
                      {toInvite.length} {seatRole} invites, {seatsLeftLabel(seatsUsed, seatLimit, seatRole)}. Invites past
                      the limit can&apos;t be accepted until seats free up.
                    </Callout>
                  )}
                </div>

                {/* The reusable link */}
                {!licenseExpired && (
                  <div className="grid gap-1.5">
                    <p className="px-1 text-headline">Or share a link</p>
                    <GroupedList>
                      <div className="flex min-h-11 items-center gap-3 px-3 py-2">
                        <Link2 className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm">
                            {roleWord} link{selectedTeamName ? ` to ${selectedTeamName}` : ""}
                          </span>
                          <span className="text-callout text-muted-foreground nums">
                            {loadingLink ? "Getting the link…" : linkInvite ? expiryText : "No link available"}
                          </span>
                        </div>
                        <Button variant="ghost" size="xs" onClick={() => setPage("link")} disabled={!linkInvite}>
                          Settings…
                        </Button>
                        <Button size="xs" variant="secondary" onClick={handleCopyLink} disabled={!linkInvite || loadingLink}>
                          {copiedLink ? <Check className="text-success" /> : <Link2 />}
                          {copiedLink ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </GroupedList>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleSend} disabled={toInvite.length === 0 || overCap || sending || licenseExpired}>
                    {sending && <Loader2 className="animate-spin" />}
                    {sending
                      ? "Sending…"
                      : toInvite.length > 0
                        ? `Send ${toInvite.length} invite${toInvite.length === 1 ? "" : "s"}`
                        : "Send"}
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
          </AnimatePresence>
        </AutoHeight>
      </DialogContent>
    </Dialog>
  );
}

/** One address in the token field, tinted by what will happen to it. */
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
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-callout font-medium",
        entry.status === "new" && "bg-primary/12 text-primary",
        entry.status === "invalid" && "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/30",
        (entry.status === "member" || entry.status === "invited") && "bg-fill-2 text-muted-foreground",
      )}
    >
      {entry.status === "invalid" ? (
        <button
          type="button"
          className="truncate outline-none"
          aria-label={`${entry.email} isn't a valid address; edit it`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          {entry.email}
        </button>
      ) : (
        <span className="truncate">{entry.email}</span>
      )}
      {entry.status === "member" && <span className="font-normal">· already a member</span>}
      {entry.status === "invited" && (
        <>
          <span className="font-normal">· invited</span>
          <button
            type="button"
            className="font-normal text-primary outline-none hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onResend();
            }}
          >
            Resend
          </button>
        </>
      )}
      <button
        type="button"
        className="flex size-4 items-center justify-center rounded-full opacity-70 transition-opacity hover:bg-fill-3 hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${entry.email}`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
