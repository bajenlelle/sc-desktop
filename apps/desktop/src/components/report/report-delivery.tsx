/**
 * The share sheet's players part: a live report in a club space goes to
 * players' phones (docs/scouting-reports.md, "On players' phones"). Before it
 * is sent, one line and Send to players; choosing whom reuses the playlists'
 * picker (teams, then members). Once sent: who it went to, each removable,
 * and Seen by, a row per person it reaches with how far they got ("7 of 16",
 * "Opened", "Not yet"), furthest first. After Update link the players already
 * see the new version; Notify players sends one push to say so.
 *
 * Coaches see reading because the players are told in the app that they do;
 * nothing here ranks or flags anyone.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, Plus, Send, Users, X } from "lucide-react";
import { readerStatus, seenByCount, sortReaders, type ReportDelivery } from "@scoutable/shared/lib/scouting-report-inbox";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { Button } from "@/components/ui/button";
import { GroupedList } from "@/components/ui/group";
import { ShareRecipients } from "@/components/playlist/share-recipients";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { getOrgContextForOrg } from "@/lib/profile-db";
import { ReportSendError, getReportDelivery, notifyReportUpdate, sendReport, unsendReport } from "@/lib/scouting-report-inbox-db";

function sendErrorMessage(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You’re offline. Connect to the internet to send the report.";
  if (e instanceof ReportSendError) {
    if (e.code === "license_locked") return "This club’s licence has ended, so sending is paused. Ask an admin to renew it.";
    if (e.code === "report_not_live") return "This report isn’t shared any more. Share it again to send it.";
  }
  return "Couldn’t send the report. Try again.";
}

export function ReportDelivery({
  reportId,
  orgId,
  personal,
  updated,
}: {
  reportId: string;
  /** The space the report's playlist is in. */
  orgId: string | null;
  /** A personal space: players' phones are for club reports only. */
  personal: boolean;
  /** The report was just updated in this sheet: offer to tell the players. */
  updated: boolean;
}) {
  const [delivery, setDelivery] = useState<ReportDelivery | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [userIds, setUserIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"send" | "notify" | null>(null);
  const [notified, setNotified] = useState(false);

  const reload = useCallback(() => {
    setFailed(false);
    return getReportDelivery(reportId)
      .then(setDelivery)
      .catch(() => setFailed(true));
  }, [reportId]);

  useEffect(() => {
    if (personal) return;
    setDelivery(null);
    void reload();
  }, [reload, personal]);

  // The club's teams and members, read when the picker first opens.
  useEffect(() => {
    if (!picking || !orgId || teams.length + members.length > 0) return;
    getOrgContextForOrg(orgId)
      .then((ctx) => {
        setTeams(ctx.allOrgTeams);
        setMembers(ctx.orgMembers.filter((m) => m.id !== ctx.profile.id).sort((a, b) => Number(a.role !== "player") - Number(b.role !== "player")));
      })
      .catch(() => toast.error("Couldn’t load the club’s teams. Try again."));
  }, [picking, orgId, teams.length, members.length]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  async function send() {
    setBusy("send");
    try {
      const r = await sendReport(reportId, { teamIds: [...teamIds], userIds: [...userIds] });
      trackEvent("scouting_report_sent", { teams: teamIds.size, people: userIds.size, reached: r.reached });
      toast(r.notified > 0 ? `Sent to ${r.notified} ${r.notified === 1 ? "person" : "people"}` : "Already sent to everyone you picked");
      setPicking(false);
      setTeamIds(new Set());
      setUserIds(new Set());
      await reload();
    } catch (e) {
      toast.error(sendErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(target: { teamId: string } | { userId: string }) {
    try {
      await unsendReport(reportId, target);
      await reload();
    } catch {
      toast.error("Couldn’t remove. Try again.");
    }
  }

  async function notify() {
    setBusy("notify");
    try {
      const n = await notifyReportUpdate(reportId);
      trackEvent("scouting_report_update_notified", { people: n });
      setNotified(true);
      toast(`Notified ${n} ${n === 1 ? "person" : "people"}`);
    } catch (e) {
      toast.error(e instanceof ReportSendError && e.code === "license_locked" ? sendErrorMessage(e) : "Couldn’t notify players. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const readers = useMemo(() => (delivery ? sortReaders(delivery.readers) : []), [delivery]);
  const seen = seenByCount(readers);

  if (personal) {
    return <p className="text-center text-callout text-muted-foreground">Share from a club space to send reports to players’ phones.</p>;
  }

  const sent = (delivery?.targets.length ?? 0) > 0;
  const chosen = teamIds.size + userIds.size;

  return (
    <section aria-label="Players" className="flex w-full flex-col gap-3 border-t border-separator pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-subheadline font-medium text-foreground">Players’ phones</h3>
        {sent && (
          <span className="text-callout text-muted-foreground nums">
            Seen by {seen.seen} of {seen.total}
          </span>
        )}
      </div>

      {failed ? (
        <p className="text-callout text-muted-foreground">
          Couldn’t load who it was sent to.{" "}
          <Button variant="link" className="inline h-auto p-0 align-baseline text-callout font-medium" onClick={() => void reload()}>
            Try again
          </Button>
        </p>
      ) : !delivery ? (
        <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />
      ) : picking ? (
        <div className="flex flex-col gap-3">
          <ShareRecipients
            teams={teams}
            members={members.map((m) => ({ id: m.id, fullName: m.fullName, email: m.email, avatarUrl: m.avatarUrl }))}
            teamIds={teamIds}
            userIds={userIds}
            onToggleTeam={(id) => setTeamIds((s) => toggle(s, id))}
            onToggleUser={(id) => setUserIds((s) => toggle(s, id))}
            emptyMembers="No one else in this club yet."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={chosen === 0 || busy === "send"} onClick={() => void send()}>
              {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}
              Send
            </Button>
          </div>
        </div>
      ) : !sent ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-callout text-muted-foreground">Players get it in the app with a notification and can watch every clip.</p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setPicking(true)}>
            <Send />
            Send to players
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {delivery.targets.map((t) => (
              <span key={t.teamId ?? t.userId} className="inline-flex h-7 items-center gap-1 rounded-full bg-fill-1 pl-2.5 pr-1 text-callout text-foreground">
                {t.teamId && <Users className="size-3.5 text-muted-foreground" />}
                <span className="max-w-40 truncate">{t.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-fill-2 hover:text-foreground"
                  onClick={() => void remove(t.teamId ? { teamId: t.teamId } : { userId: t.userId! })}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPicking(true)}>
              <Plus />
              Add
            </Button>
          </div>

          {updated && !notified && (
            <div className="flex items-center justify-between gap-3 rounded-window bg-fill-1 px-3 py-2">
              <p className="text-callout text-muted-foreground">Players already see the new version.</p>
              <Button variant="outline" size="sm" className="shrink-0" disabled={busy === "notify"} onClick={() => void notify()}>
                {busy === "notify" ? <Loader2 className="animate-spin" /> : <Bell />}
                Notify players
              </Button>
            </div>
          )}

          {readers.length > 0 ? (
            <GroupedList className="max-h-56 overflow-y-auto">
              {readers.map((r) => (
                <div key={r.userId} className="flex min-h-9 items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
                  {r.teamName && <span className="max-w-32 truncate text-callout text-muted-foreground">{r.teamName}</span>}
                  <span className={cn("w-16 text-right text-callout nums", r.openedAt ? "text-foreground" : "text-muted-foreground")}>
                    {readerStatus(r, delivery.clips)}
                  </span>
                </div>
              ))}
            </GroupedList>
          ) : (
            <p className="text-callout text-muted-foreground">No one in these teams yet.</p>
          )}
          <p className="text-footnote text-muted-foreground">Players see in the app that you can see what they opened.</p>
        </>
      )}
    </section>
  );
}
