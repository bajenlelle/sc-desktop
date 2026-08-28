"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getOrgContext } from "@/lib/profile-db";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { ExternalLink, Image as ImageIcon, Loader2 } from "lucide-react";

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

const GITHUB_REPO = "bajenlelle/sc-desktop";
const NEXT_STATUS: Record<FeedbackReport["status"], FeedbackReport["status"]> = {
  open: "triaged",
  triaged: "resolved",
  resolved: "open",
};

const STATUS_STYLE: Record<FeedbackReport["status"], string> = {
  open: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  triaged: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

export default function AdminFeedbackPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getOrgContext()
      .then((ctx) => {
        if (!ctx.profile.isPlatformAdmin) router.replace("/organization");
        else setChecked(true);
      })
      .catch(() => router.replace("/organization"));
  }, [user, router]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  async function cycleStatus(report: FeedbackReport) {
    const next = NEXT_STATUS[report.status];
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

  if (!checked) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          User-submitted problem reports. Click a status to advance it (open → triaged →
          resolved).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No reports yet. That&apos;s either very good or very bad.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <button
                    onClick={() => cycleStatus(r)}
                    className={`rounded-full px-2 py-0.5 font-medium capitalize transition-opacity hover:opacity-75 ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </button>
                  <span className="font-medium text-foreground">{r.email ?? "unknown user"}</span>
                  <span>
                    {r.app} {r.app_version}
                  </span>
                  {r.route && <span className="font-mono">{r.route}</span>}
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{r.description}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {r.github_issue_number && (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={`https://github.com/${GITHUB_REPO}/issues/${r.github_issue_number}`}
                        target="_blank"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Issue #{r.github_issue_number}
                      </Link>
                    </Button>
                  )}
                  {r.screenshot_path && (
                    <Button variant="outline" size="sm" onClick={() => openScreenshot(r.screenshot_path!)}>
                      <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                      Screenshot
                    </Button>
                  )}
                  {r.sentry_event_id && (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={`https://scoutable.sentry.io/issues/?query=id%3A${r.sentry_event_id}`}
                        target="_blank"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Sentry event
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
