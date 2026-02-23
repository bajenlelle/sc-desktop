import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure your AI analytics preferences.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            API Configuration
          </h2>
          <div className="space-y-2">
            <Label htmlFor="rf-key">Roboflow API Key</Label>
            <Input
              id="rf-key"
              type="password"
              placeholder="Enter your API key"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hf-token">HuggingFace Token</Label>
            <Input
              id="hf-token"
              type="password"
              placeholder="Enter your token"
            />
          </div>
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Detection Model
          </h2>
          <div className="space-y-2">
            <Label htmlFor="det-model">Player Detection Model ID</Label>
            <Input
              id="det-model"
              defaultValue="basketball-player-detection-3-ycjdo-cia11/5"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="conf">Confidence Threshold</Label>
              <Input id="conf" type="number" defaultValue="0.4" step="0.05" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iou">IoU Threshold</Label>
              <Input id="iou" type="number" defaultValue="0.9" step="0.05" />
            </div>
          </div>
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            Update Models
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
