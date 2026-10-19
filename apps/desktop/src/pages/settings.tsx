import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "next-themes";
import { interactiveUpdateCheck } from "@/lib/updates";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GroupedList, GroupHeader, GroupRow } from "@/components/ui/group";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { ThemePicker } from "@/components/theme-picker";
import { useAuth } from "@/lib/auth-context";
import { getExportWatermarkDisabled, setExportWatermarkDisabled } from "@/lib/prefs";
import { trackEvent } from "@/lib/analytics";

type Appearance = "system" | "light" | "dark";

const APPEARANCE_OPTIONS: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const { activeOrg, activeOrgCanManage, activeOrgPlan } = useAuth();
  const { theme, setTheme } = useTheme();
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
      await interactiveUpdateCheck();
    } finally {
      setChecking(false);
    }
  }

  const appearance: Appearance =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  return (
    <Page>
      <Toolbar title="Settings" />
      <PageContent width="narrow">
        <div className="space-y-7">
          {/* Space-level settings first; the groups below are app chrome. */}
          {activeOrgCanManage && activeOrg && (
            <section>
              <GroupHeader title="Organization" />
              <GroupedList>
                <GroupRow
                  label={activeOrg.orgName}
                  description="Teams, members, invites and license"
                  trailing={
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/organization">Manage…</Link>
                    </Button>
                  }
                />
              </GroupedList>
            </section>
          )}

          <section>
            <GroupHeader title="About" />
            <GroupedList>
              <GroupRow
                label={`Scoutable ${version && `${version}`}`}
                description="Updates install from the sidebar when one is available."
                trailing={
                  <Button variant="outline" size="sm" onClick={checkForUpdates} disabled={checking}>
                    {checking ? "Checking…" : "Check for Updates…"}
                  </Button>
                }
              />
            </GroupedList>
          </section>

          <section>
            <GroupHeader title="Appearance" />
            <GroupedList>
              <GroupRow
                label="Appearance"
                description="Light, dark, or follow the system"
                trailing={
                  <SegmentedControl
                    aria-label="Appearance"
                    value={appearance}
                    onValueChange={(v) => setTheme(v)}
                    options={APPEARANCE_OPTIONS}
                  />
                }
              />
              <div className="px-4 py-3">
                <p className="mb-3 text-sm text-foreground">Theme</p>
                <ThemePicker />
              </div>
            </GroupedList>
          </section>

          <section>
            <GroupHeader title="Feedback" />
            <GroupedList>
              <GroupRow
                label="Found a bug or got an idea?"
                description="Send a description and an optional screenshot. Version info is attached automatically."
                trailing={
                  <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
                    Send Feedback…
                  </Button>
                }
              />
            </GroupedList>
          </section>

          {canToggleWatermark && (
            <section>
              <GroupHeader title="Exports" />
              <GroupedList>
                <GroupRow
                  label="Watermark on exported videos"
                  description="A small mark in the corner of videos saved to your computer. Clips sent to phones always include it."
                  trailing={
                    <Switch
                      aria-label="Include the Scoutable watermark on exported videos"
                      checked={watermarkOn}
                      onCheckedChange={toggleWatermark}
                    />
                  }
                />
              </GroupedList>
            </section>
          )}
        </div>
        <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />
      </PageContent>
    </Page>
  );
}
