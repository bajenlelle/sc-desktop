"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Image as ImageIcon, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GroupHeader, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { EmptyState } from "@/components/empty-state";
import { PersonAvatar } from "@/components/person-avatar";
import { AdminSections, useAdminGate } from "@/components/admin/admin-sections";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format-date";

interface FeedbackReport {
  id: string;
  created_at: string;
  email: string | null;
  app: string;
  app_version: string;
  os: string | null;
  route: string | null;
  description: string;
  sentry_event_id: string | null;
  screenshot_path: string | null;
  github_issue_number: number | null;
  status: "open" | "triaged" | "resolved";
}

type Status = FeedbackReport["status"];

const GITHUB_REPO = "bajenlelle/sc-desktop";

/** Triage order: what needs a look first. */
const STATUSES: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "triaged", label: "Triaged" },
  { value: "resolved", label: "Resolved" },
];

function ReportRow({
  report: r,
  onStatusChange,
  onOpenScreenshot,
}: {
  report: FeedbackReport;
  onStatusChange: (status: Status) => void;
  onOpenScreenshot: () => void;
}) {
  const links = r.github_issue_number || r.screenshot_path || r.sentry_event_id;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <PersonAvatar name={r.email} className="size-7" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{r.email ?? "Unknown user"}</span>
          {/* The OS is a full user agent on web and desktop: on hover, not in the line. */}
          <span className="truncate text-callout text-muted-foreground nums" title={r.os ?? undefined}>
            {`${r.app} ${r.app_version}`} · {formatDate(r.created_at)}
          </span>
        </div>
        <PopUpButton size="sm" aria-label="Status" align="end" value={r.status} onValueChange={onStatusChange} options={STATUSES} />
      </div>
      <div className="flex flex-col gap-2 pl-10">
        <p className="text-sm whitespace-pre-wrap text-foreground">{r.description}</p>
        {r.route && <p className="truncate font-mono text-callout text-muted-foreground">{r.route}</p>}
        {links && (
          <div className="flex flex-wrap items-center gap-2">
            {r.github_issue_number && (
              <Button variant="outline" size="xs" asChild>
                <a href={`https://github.com/${GITHUB_REPO}/issues/${r.github_issue_number}`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Issue #{r.github_issue_number}
                </a>
              </Button>
            )}
            {r.screenshot_path && (
              <Button variant="outline" size="xs" onClick={onOpenScreenshot}>
                <ImageIcon />
                Screenshot
              </Button>
            )}
            {r.sentry_event_id && (
              <Button variant="outline" size="xs" asChild>
                <a
                  href={`https://scoutable.sentry.io/issues/?query=id%3A${r.sentry_event_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  Sentry event
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminFeedbackPage() {
  const checked = useAdminGate();
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadReports() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_list_feedback_reports");
    if (error) toast.error(error.message);
    else setReports((data ?? []) as FeedbackReport[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!checked) return;
    loadReports();
  }, [checked]);

  async function setStatus(report: FeedbackReport, next: Status) {
    if (next === report.status) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_feedback_status", {
      p_report_id: report.id,
      p_status: next,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, status: next } : r)));
  }

  async function openScreenshot(path: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("feedback-screenshots")
      .createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) {
      toast.error("Couldn't open the screenshot");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const openCount = reports.filter((r) => r.status === "open").length;

  return (
    <Page width="medium">
      <Toolbar
        title="Admin"
        subtitle={checked && !loading ? `${openCount} open` : undefined}
        principal={<AdminSections current="feedback" />}
      />
      <PageContent className="space-y-7">
        {!checked || loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No reports yet"
            body="Problems people report from the apps show up here."
          />
        ) : (
          STATUSES.map(({ value, label }) => {
            const group = reports.filter((r) => r.status === value);
            if (group.length === 0) return null;
            return (
              <section key={value}>
                <GroupHeader
                  title={
                    <>
                      {label} <span className="font-normal text-muted-foreground nums">{group.length}</span>
                    </>
                  }
                />
                <GroupedList>
                  {group.map((r) => (
                    <ReportRow
                      key={r.id}
                      report={r}
                      onStatusChange={(s) => void setStatus(r, s)}
                      onOpenScreenshot={() => r.screenshot_path && void openScreenshot(r.screenshot_path)}
                    />
                  ))}
                </GroupedList>
              </section>
            );
          })
        )}
      </PageContent>
    </Page>
  );
}
