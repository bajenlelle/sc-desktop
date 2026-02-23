import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { updateMatchMeta } from "@/lib/matches-db";
import type { StoredMatch, SyncPoint } from "@/types/match";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const TEAM_COLORS = [
  { label: "Black",  hex: "#111111" },
  { label: "White",  hex: "#ffffff" },
  { label: "Gray",   hex: "#6b7280" },
  { label: "Red",    hex: "#dc2626" },
  { label: "Orange", hex: "#ea580c" },
  { label: "Gold",   hex: "#ca8a04" },
  { label: "Green",  hex: "#16a34a" },
  { label: "Blue",   hex: "#2563eb" },
  { label: "Navy",   hex: "#1e3a8a" },
  { label: "Purple", hex: "#7c3aed" },
];

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-slate-500 dark:text-slate-400">Team colour</span>
      <div className="flex flex-wrap gap-2">
        {TEAM_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.label}
            onClick={() => onChange(c.hex)}
            className={cn(
              "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
              value === c.hex
                ? "border-indigo-500 ring-2 ring-indigo-400 ring-offset-1"
                : "border-slate-300 dark:border-slate-600",
              c.hex === "#ffffff" && "border-slate-300 dark:border-slate-500"
            )}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster helpers
// ---------------------------------------------------------------------------

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

function addRow(roster: RosterEntry[], setter: (r: RosterEntry[]) => void) {
  setter([...roster, { jerseyNumber: "", playerName: "" }]);
}

function removeRow(
  roster: RosterEntry[],
  setter: (r: RosterEntry[]) => void,
  index: number
) {
  setter(roster.filter((_, i) => i !== index));
}

function updateRow(
  roster: RosterEntry[],
  setter: (r: RosterEntry[]) => void,
  index: number,
  field: keyof RosterEntry,
  value: string
) {
  const updated = [...roster];
  updated[index] = { ...updated[index], [field]: value };
  setter(updated);
}

function RosterTable({
  label,
  roster,
  setter,
}: {
  label: string;
  roster: RosterEntry[];
  setter: (r: RosterEntry[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
          onClick={() => addRow(roster, setter)}
        >
          <Plus className="h-3.5 w-3.5" /> Add Player
        </Button>
      </div>
      <div className="space-y-2">
        {roster.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="#"
              className="w-16 text-center"
              value={entry.jerseyNumber}
              onChange={(e) => updateRow(roster, setter, i, "jerseyNumber", e.target.value)}
            />
            <Input
              placeholder="Player name"
              className="flex-1"
              value={entry.playerName}
              onChange={(e) => updateRow(roster, setter, i, "playerName", e.target.value)}
            />
            {roster.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400"
                onClick={() => removeRow(roster, setter, i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// parseMMSS
// ---------------------------------------------------------------------------

function parseMMSS(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s) || s >= 60) return null;
  return m * 60 + s;
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// EditMatchDialog
// ---------------------------------------------------------------------------

interface EditMatchDialogProps {
  match: StoredMatch;
  onSave: (updates: {
    title?: string;
    date?: string;
    homeTeam?: { name: string; color: string };
    awayTeam?: { name: string; color: string };
    homeRoster?: Array<{ jerseyNumber: string; playerName: string }>;
    awayRoster?: Array<{ jerseyNumber: string; playerName: string }>;
    syncPoint?: SyncPoint | null;
  }) => void;
}

export function EditMatchDialog({ match, onSave }: EditMatchDialogProps) {
  const [open, setOpen] = useState(false);

  // Form state — initialised from match when dialog opens
  const [title, setTitle] = useState(match.title);
  const [date, setDate] = useState(match.date);
  const [homeColor, setHomeColor] = useState(match.homeTeam.color);
  const [awayColor, setAwayColor] = useState(match.awayTeam.color);
  const [homeRoster, setHomeRoster] = useState<RosterEntry[]>(
    match.homeRoster.length ? match.homeRoster : [{ jerseyNumber: "", playerName: "" }]
  );
  const [awayRoster, setAwayRoster] = useState<RosterEntry[]>(
    match.awayRoster.length ? match.awayRoster : [{ jerseyNumber: "", playerName: "" }]
  );
  const [syncInput, setSyncInput] = useState(
    match.syncPoint ? formatMMSS(match.syncPoint.syncVideoTime) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reset to latest match values each time dialog opens
      setTitle(match.title);
      setDate(match.date);
      setHomeColor(match.homeTeam.color);
      setAwayColor(match.awayTeam.color);
      setHomeRoster(
        match.homeRoster.length ? match.homeRoster : [{ jerseyNumber: "", playerName: "" }]
      );
      setAwayRoster(
        match.awayRoster.length ? match.awayRoster : [{ jerseyNumber: "", playerName: "" }]
      );
      setSyncInput(match.syncPoint ? formatMMSS(match.syncPoint.syncVideoTime) : "");
      setSaveError(null);
    }
    setOpen(next);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    let syncPoint: SyncPoint | null = null;
    if (syncInput && match.syncPoint) {
      const secs = parseMMSS(syncInput);
      if (secs !== null) {
        syncPoint = { syncVideoTime: secs, syncRealWorldTime: match.syncPoint.syncRealWorldTime };
      }
    }

    const updates = {
      title,
      date,
      homeTeam: { name: match.homeTeam.name, color: homeColor },
      awayTeam: { name: match.awayTeam.name, color: awayColor },
      homeRoster,
      awayRoster,
      syncPoint,
    };

    try {
      await updateMatchMeta(match.id, updates);
      onSave(updates);
      setOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const syncHint = match.syncPoint?.syncRealWorldTime
    ? (() => {
        const d = new Date(match.syncPoint.syncRealWorldTime);
        return isNaN(d.getTime())
          ? null
          : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      })()
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Edit match"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Match</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Match info */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Match</h3>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </section>

          {/* Teams */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Teams</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {match.homeTeam.name} <span className="text-xs text-slate-400">(home)</span>
                </span>
                <ColorPicker value={homeColor} onChange={setHomeColor} />
              </div>
              <div className="space-y-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {match.awayTeam.name} <span className="text-xs text-slate-400">(away)</span>
                </span>
                <ColorPicker value={awayColor} onChange={setAwayColor} />
              </div>
            </div>
          </section>

          {/* Video Sync */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Video Sync</h3>
            {syncHint ? (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">
                Tip-off real-world time was <strong>{syncHint}</strong> — enter the video
                timestamp for that moment.
              </p>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                No tip-off time available (select a game with play-by-play data first).
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-sync">Video time at tip-off</Label>
                <Input
                  id="edit-sync"
                  placeholder="0:35"
                  className="w-28 font-mono"
                  value={syncInput}
                  onChange={(e) => setSyncInput(e.target.value)}
                />
              </div>
              {syncInput && parseMMSS(syncInput) === null && (
                <p className="mt-5 text-xs text-red-500">Use MM:SS format (e.g. 0:35)</p>
              )}
              {syncInput && parseMMSS(syncInput) !== null && (
                <p className="mt-5 text-xs text-emerald-600 dark:text-emerald-400">
                  Sync set at {syncInput}
                </p>
              )}
            </div>
          </section>

          {/* Rosters */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Rosters</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <RosterTable
                label={match.homeTeam.name || "Home"}
                roster={homeRoster}
                setter={setHomeRoster}
              />
              <RosterTable
                label={match.awayTeam.name || "Away"}
                roster={awayRoster}
                setter={setAwayRoster}
              />
            </div>
          </section>

          {saveError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
