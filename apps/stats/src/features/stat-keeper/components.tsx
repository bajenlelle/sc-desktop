/**
 * Live-screen building blocks. The tap pad produces the same StatIntents as
 * speech, so the reducer has one input and the keeper can mix both freely.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { RosterEntry, StatEvent, StatIntent } from "@scoutable/shared/types/stat-session";
import type { BoxScore } from "@scoutable/shared/lib/stat-session";
import { useThemeColors } from "@/lib/theme-context";
import type { RecognizerStatus } from "./recognizer/types";

// ---------------------------------------------------------------------------

export function PeriodBar({
  period,
  tipoffMarked,
  periodCount,
  onTipoff,
  onPeriod,
}: {
  period: number;
  tipoffMarked: boolean;
  periodCount: number;
  onTipoff: () => void;
  onPeriod: (p: number) => void;
}) {
  if (!tipoffMarked) {
    return (
      <Pressable onPress={onTipoff} className="rounded-xl bg-primary px-4 py-4 active:opacity-80">
        <Text className="text-center font-sans-bold text-lg text-primary-foreground">Tip-off — start Q1</Text>
        <Text className="mt-0.5 text-center text-xs text-primary-foreground/80">Tap at the jump ball. This is what lines the video up.</Text>
      </Pressable>
    );
  }
  const periods = Array.from({ length: Math.max(periodCount, period) }, (_, i) => i + 1);
  return (
    <View className="flex-row flex-wrap gap-2">
      {periods.map((p) => (
        <Pressable
          key={p}
          onPress={() => onPeriod(p)}
          className={`rounded-full px-3 py-1.5 ${p === period ? "bg-primary" : "bg-muted"}`}
        >
          <Text className={`font-sans-medium text-sm ${p === period ? "text-primary-foreground" : "text-foreground"}`}>
            {p <= 4 ? `Q${p}` : `OT${p - 4}`}
          </Text>
        </Pressable>
      ))}
      <Pressable onPress={() => onPeriod(periods.length + 1)} className="rounded-full bg-muted px-3 py-1.5">
        <Text className="font-sans-medium text-sm text-foreground">+</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------

export function ListenButton({
  status,
  level,
  enabled,
  onToggle,
}: {
  status: RecognizerStatus;
  level: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  const on = status === "listening" || status === "restarting";
  const label = !enabled
    ? "Voice unavailable — use the pad"
    : status === "listening"
      ? "Listening"
      : status === "restarting"
        ? "Restarting…"
        : status === "error"
          ? "Microphone error — tap to retry"
          : "Tap to listen";
  return (
    <Pressable
      onPress={onToggle}
      disabled={!enabled}
      className={`items-center justify-center rounded-2xl px-4 py-5 ${on ? "bg-primary/15 border-2 border-primary" : "bg-muted border-2 border-transparent"} ${enabled ? "" : "opacity-50"}`}
    >
      <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: on ? `rgba(35,225,254,${0.25 + level * 0.75})` : undefined }}>
        <Text className="text-3xl">{on ? "🎙️" : "🔇"}</Text>
      </View>
      <Text className="mt-2 font-sans-medium text-sm text-foreground">{label}</Text>
      <Text className="text-xs text-muted-foreground">Say “tvåa nio”, “retur elva”, “ångra”</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function ConfirmStrip({
  last,
  hint,
  onUndo,
  onFlip,
}: {
  last: StatEvent | null;
  /** A parse problem or a recogniser note, shown instead of the event. */
  hint: string | null;
  onUndo: () => void;
  onFlip: (() => void) | null;
}) {
  if (hint) {
    return (
      <View className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <Text className="font-sans-medium text-sm text-foreground">{hint}</Text>
      </View>
    );
  }
  if (!last) {
    return (
      <View className="rounded-xl bg-card px-4 py-3">
        <Text className="text-sm text-muted-foreground">Nothing recorded yet.</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-card px-4 py-3">
      <View className="flex-1">
        <Text className="font-sans-bold text-base text-foreground">{eventTitle(last)}</Text>
        <Text className="text-xs text-muted-foreground">
          {last.jersey ? `#${last.jersey}${last.playerName ? ` ${last.playerName}` : ""}` : "Team"} · Q{last.period}
        </Text>
      </View>
      {onFlip && (
        <Pressable onPress={onFlip} className="rounded-md bg-muted px-3 py-2">
          <Text className="font-sans-medium text-xs text-foreground">{flipLabel(last)}</Text>
        </Pressable>
      )}
      <Pressable onPress={onUndo} className="rounded-md bg-destructive/15 px-3 py-2">
        <Text className="font-sans-medium text-xs text-destructive">Undo</Text>
      </Pressable>
    </View>
  );
}

export function eventTitle(e: StatEvent): string {
  switch (e.kind) {
    case "2pt": return e.isSuccessful ? "2PT made" : "2PT miss";
    case "3pt": return e.isSuccessful ? "3PT made" : "3PT miss";
    case "freethrow": return e.isSuccessful ? "FT made" : "FT miss";
    case "rebound": return e.subType === "offensive" ? "Off. rebound" : "Def. rebound";
    case "assist": return "Assist";
    case "steal": return "Steal";
    case "block": return "Block";
    case "turnover": return "Turnover";
    case "foul": return "Foul";
    case "foulon": return "Foul drawn";
    case "timeout": return "Timeout";
    case "period": return e.subType === "tipoff" ? "Tip-off" : `Period ${e.period}`;
  }
}

function flipLabel(e: StatEvent): string | null {
  if (e.kind === "2pt" || e.kind === "3pt" || e.kind === "freethrow") return e.isSuccessful ? "Make → miss" : "Miss → make";
  if (e.kind === "rebound") return e.subType === "offensive" ? "Off → def" : "Def → off";
  return null;
}

/** The correction a flip applies, or null when the event has nothing to flip. */
export function flipPatch(e: StatEvent): { isSuccessful?: 0 | 1; subType?: string } | null {
  if (e.kind === "2pt" || e.kind === "3pt" || e.kind === "freethrow") return { isSuccessful: e.isSuccessful === 1 ? 0 : 1 };
  if (e.kind === "rebound") return { subType: e.subType === "offensive" ? "defensive" : "offensive" };
  return null;
}

// ---------------------------------------------------------------------------

type PadKind = "2pt" | "3pt" | "ft" | "reb" | "ast" | "stl" | "blk" | "tov" | "foul" | "to";

const PAD: Array<{ kind: PadKind; label: string; needsPlayer: boolean }> = [
  { kind: "2pt", label: "2PT", needsPlayer: true },
  { kind: "3pt", label: "3PT", needsPlayer: true },
  { kind: "ft", label: "FT", needsPlayer: true },
  { kind: "reb", label: "REB", needsPlayer: true },
  { kind: "ast", label: "AST", needsPlayer: true },
  { kind: "stl", label: "STL", needsPlayer: true },
  { kind: "blk", label: "BLK", needsPlayer: true },
  { kind: "tov", label: "TO", needsPlayer: true },
  { kind: "foul", label: "FOUL", needsPlayer: true },
  { kind: "to", label: "T/O", needsPlayer: false },
];

/** Two taps per event: the action, then the jersey (shots and rebounds carry a flip). */
export function TapPad({
  roster,
  onIntent,
}: {
  roster: RosterEntry[];
  onIntent: (intent: StatIntent) => void;
}) {
  const [pending, setPending] = useState<PadKind | null>(null);
  const [made, setMade] = useState(true);
  const [offensive, setOffensive] = useState(false);

  function emit(jersey: number | null) {
    const k = pending;
    setPending(null);
    if (!k) return;
    switch (k) {
      case "2pt": return onIntent({ kind: "shot", points: 2, made, jersey });
      case "3pt": return onIntent({ kind: "shot", points: 3, made, jersey });
      case "ft": return onIntent({ kind: "shot", points: 1, made, jersey });
      case "reb": return onIntent({ kind: "rebound", offensive, jersey });
      case "ast": return onIntent({ kind: "assist", jersey });
      case "stl": return onIntent({ kind: "steal", jersey });
      case "blk": return onIntent({ kind: "block", jersey });
      case "tov": return onIntent({ kind: "turnover", jersey });
      case "foul": return onIntent({ kind: "foul", jersey });
      case "to": return onIntent({ kind: "timeout" });
    }
  }

  if (pending) {
    const isShot = pending === "2pt" || pending === "3pt" || pending === "ft";
    const numbers = roster.length > 0 ? roster.map((r) => r.jerseyNumber) : Array.from({ length: 24 }, (_, i) => String(i));
    return (
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-bold text-base text-foreground">{PAD.find((p) => p.kind === pending)?.label} — who?</Text>
          <Pressable onPress={() => setPending(null)}>
            <Text className="text-sm text-muted-foreground">Cancel</Text>
          </Pressable>
        </View>
        {isShot && (
          <View className="flex-row gap-2">
            {(["Made", "Missed"] as const).map((l) => (
              <Pressable key={l} onPress={() => setMade(l === "Made")} className={`rounded-full px-3 py-1.5 ${(l === "Made") === made ? "bg-primary" : "bg-muted"}`}>
                <Text className={`text-sm ${(l === "Made") === made ? "text-primary-foreground" : "text-foreground"}`}>{l}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {pending === "reb" && (
          <View className="flex-row gap-2">
            {(["Defensive", "Offensive"] as const).map((l) => (
              <Pressable key={l} onPress={() => setOffensive(l === "Offensive")} className={`rounded-full px-3 py-1.5 ${(l === "Offensive") === offensive ? "bg-primary" : "bg-muted"}`}>
                <Text className={`text-sm ${(l === "Offensive") === offensive ? "text-primary-foreground" : "text-foreground"}`}>{l}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View className="flex-row flex-wrap gap-2">
          {numbers.map((n) => (
            <Pressable key={n} onPress={() => emit(Number(n))} className="h-14 w-[22%] items-center justify-center rounded-lg bg-muted active:bg-primary/30">
              <Text className="font-sans-bold text-xl text-foreground">{n}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => emit(null)} className="h-14 w-[22%] items-center justify-center rounded-lg bg-muted/60">
            <Text className="text-xs text-muted-foreground">No player</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {PAD.map((p) => (
        <Pressable
          key={p.kind}
          onPress={() => (p.needsPlayer ? setPending(p.kind) : emit(null))}
          onPressIn={() => {
            if (!p.needsPlayer) setPending(p.kind);
          }}
          className="h-12 w-[18%] items-center justify-center rounded-lg bg-card border border-border active:bg-primary/20"
        >
          <Text className="font-sans-bold text-sm text-foreground">{p.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------

export function BoxScoreTable({ box, side, label }: { box: BoxScore; side: 1 | 2; label: string }) {
  const rows = box.players.filter((p) => p.side === side);
  return (
    <View className="rounded-xl bg-card p-3">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-sans-bold text-base text-foreground">{label}</Text>
        <Text className="font-heading text-2xl text-foreground">{box.team[side].pts}</Text>
      </View>
      <View className="flex-row border-b border-border pb-1">
        {["#", "Player", "PTS", "FG", "3P", "FT", "REB", "AST", "STL", "BLK", "TO", "PF"].map((h, i) => (
          <Text key={h} className={`text-[10px] text-muted-foreground ${i === 1 ? "flex-1" : "w-8 text-right"}`}>{h}</Text>
        ))}
      </View>
      {rows.length === 0 && <Text className="py-2 text-xs text-muted-foreground">No events yet.</Text>}
      {rows.map((p) => (
        <View key={`${p.side}:${p.jersey}`} className="flex-row py-1">
          <Text className="w-8 text-xs text-foreground">{p.jersey}</Text>
          <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>{p.playerName ?? ""}</Text>
          <Text className="w-8 text-right text-xs font-sans-bold text-foreground">{p.pts}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.fgm}/{p.fga}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.tpm}/{p.tpa}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.ftm}/{p.fta}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.oreb + p.dreb}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.ast}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.stl}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.blk}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.tov}</Text>
          <Text className="w-8 text-right text-xs text-foreground">{p.pf}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------

export function RosterEditor({ roster, onChange }: { roster: RosterEntry[]; onChange: (r: RosterEntry[]) => void }) {
  return (
    <View className="gap-2">
      {roster.map((r, i) => (
        <View key={i} className="flex-row items-center gap-2">
          <RosterField value={r.jerseyNumber} placeholder="#" width={56} keyboardType="number-pad" onChange={(v) => onChange(roster.map((x, j) => (j === i ? { ...x, jerseyNumber: v } : x)))} />
          <RosterField value={r.playerName} placeholder="Name (optional)" onChange={(v) => onChange(roster.map((x, j) => (j === i ? { ...x, playerName: v } : x)))} />
          <Pressable onPress={() => onChange(roster.filter((_, j) => j !== i))} className="px-2 py-2">
            <Text className="text-muted-foreground">✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => onChange([...roster, { jerseyNumber: "", playerName: "" }])} className="self-start rounded-md bg-muted px-3 py-2">
        <Text className="text-sm text-foreground">+ Add player</Text>
      </Pressable>
    </View>
  );
}

function RosterField({
  value,
  placeholder,
  width,
  keyboardType,
  onChange,
}: {
  value: string;
  placeholder: string;
  width?: number;
  keyboardType?: "number-pad" | "default";
  onChange: (v: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <TextInput
      value={value}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType ?? "default"}
      onChangeText={onChange}
      style={{ width: width ?? undefined, flex: width ? undefined : 1, color: colors.foreground }}
      className="rounded-md border border-input bg-background px-3 py-2 text-base"
    />
  );
}
