import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { useAuth } from "@/lib/auth-context";
import { getExportWatermarkDisabled, setExportWatermarkDisabled } from "@/lib/prefs";
import { trackEvent } from "@/lib/analytics";

export function SettingsPage() {
  const { activeOrgPlan } = useAuth();
  const [version, setVersion] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [watermarkOn, setWatermarkOn] = useState(() => !getExportWatermarkDisabled());
  const canToggleWatermark = activeOrgPlan === "pro" || activeOrgPlan === "franchise";

  function toggleWatermark(checked: boolean) {
    setWatermarkOn(checked);
    setExportWatermarkDisabled(!checked);
    trackEvent("watermark_toggled", { enabled: checked });
  }

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    try {
      const update = await check();
      if (update?.available) {
        toast.info(`Version ${update.version} is available — use the banner at the top to install.`);
      } else {
        toast.success("You're on the latest version.");
      }
    } catch {
      toast.error("Couldn't reach the update server. Are you online?");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">About</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Scoutable {version && `v${version}`}</p>
              <p className="text-sm text-muted-foreground">
                Updates install automatically from the banner when available.
              </p>
            </div>
            <Button variant="outline" onClick={checkForUpdates} disabled={checking}>
              {checking ? "Checking…" : "Check for Updates"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">Feedback</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Found a bug or got an idea?</p>
              <p className="text-sm text-muted-foreground">
                Send us a description and an optional screenshot — version info is attached
                automatically.
              </p>
            </div>
            <Button onClick={() => setReportOpen(true)}>Send Feedback</Button>
          </div>
        </CardContent>
      </Card>

      {canToggleWatermark && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-base font-semibold text-foreground">Exports</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="export-watermark" className="text-sm text-foreground">
                  Include the Scoutable watermark on exported videos
                </Label>
                <p className="text-sm text-muted-foreground">
                  A small mark in the corner of videos saved to your computer.
                  Clips sent to phones always include it.
                </p>
              </div>
              <input
                id="export-watermark"
                type="checkbox"
                checked={watermarkOn}
                onChange={(e) => toggleWatermark(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-primary"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />
    </div>
  );
}
