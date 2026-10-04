import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RosterEntry } from "@scoutable/shared/types/stat-session";
import { useAuth } from "@/lib/auth-context";
import { useSessions } from "@/features/stat-keeper/store";
import { RosterEditor } from "@/features/stat-keeper/components";
import { ExpoSpeechRecognizer } from "@/features/stat-keeper/recognizer/expo-speech";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Game setup. Linking to the league schedule (Profixio) comes next; for now
 * the keeper types the teams, and the desktop lists the game under
 * "My recorded games".
 */
export default function NewGame() {
  const { create, recallRoster, rememberRoster } = useSessions();
  const { keeperLabel } = useAuth();
  const [ourName, setOurName] = useState("");
  const [oppName, setOppName] = useState("");
  const [ourSide, setOurSide] = useState<1 | 2>(1);
  const [gameDate, setGameDate] = useState(today());
  const [trackBoth, setTrackBoth] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([{ jerseyNumber: "", playerName: "" }]);
  const [mic, setMic] = useState<{ checked: boolean; ok: boolean; onDevice: boolean; reason?: string }>({ checked: false, ok: false, onDevice: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the roster from the last game of this team once the name is typed.
  useEffect(() => {
    if (ourName.trim().length < 3) return;
    let active = true;
    void recallRoster(ourName).then((r) => {
      if (active && r && r.length > 0 && roster.every((x) => !x.jerseyNumber)) setRoster(r);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ourName]);

  async function checkMic() {
    const rec = new ExpoSpeechRecognizer();
    try {
      const granted = await rec.requestPermissions();
      if (!granted) return setMic({ checked: true, ok: false, onDevice: false, reason: "Microphone permission was not granted. You can still tap every event." });
      const a = await rec.checkAvailability("sv-SE");
      setMic({ checked: true, ok: a.ok, onDevice: a.onDevice, reason: a.reason });
    } catch (e) {
      setMic({ checked: true, ok: false, onDevice: false, reason: e instanceof Error ? e.message : "Speech check failed" });
    }
  }

  async function start() {
    setError(null);
    if (!ourName.trim() || !oppName.trim()) return setError("Enter both team names.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return setError("Date must be YYYY-MM-DD.");
    const cleanRoster = roster
      .map((r) => ({ jerseyNumber: r.jerseyNumber.trim(), playerName: r.playerName.trim() }))
      .filter((r) => r.jerseyNumber !== "");
    setBusy(true);
    try {
      await rememberRoster(ourName, cleanRoster);
      const id = await create({
        sourceGameId: null,
        homeName: ourSide === 1 ? ourName.trim() : oppName.trim(),
        awayName: ourSide === 1 ? oppName.trim() : ourName.trim(),
        ourSide,
        trackingMode: trackBoth ? "both" : "ours",
        homeRoster: ourSide === 1 ? cleanRoster : [],
        awayRoster: ourSide === 2 ? cleanRoster : [],
        gameDate,
        keeperLabel,
        captureMeta: { recognizer: mic.ok ? (mic.onDevice ? "expo-speech-on-device" : "expo-speech-network") : "tap", platform: Platform.OS },
      });
      router.replace(`/session/${id}` as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the game.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerClassName="px-5 py-4 gap-5" keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center justify-between">
            <Text className="font-heading text-3xl text-foreground">New game</Text>
            <Pressable onPress={() => router.back()}>
              <Text className="text-sm text-muted-foreground">Cancel</Text>
            </Pressable>
          </View>

          <View className="gap-3">
            <Input label="Your team" value={ourName} onChangeText={setOurName} placeholder="Fryshuset Svart" />
            <Input label="Opponent" value={oppName} onChangeText={setOppName} placeholder="Örebro" />
            <View>
              <Text className="mb-1 text-xs text-muted-foreground">Your team plays</Text>
              <View className="flex-row gap-2">
                {([1, 2] as const).map((s) => (
                  <Pressable key={s} onPress={() => setOurSide(s)} className={`rounded-full px-4 py-2 ${ourSide === s ? "bg-primary" : "bg-muted"}`}>
                    <Text className={ourSide === s ? "text-primary-foreground" : "text-foreground"}>{s === 1 ? "Home" : "Away"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Input label="Date" value={gameDate} onChangeText={setGameDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          </View>

          <View className="gap-2">
            <Text className="font-sans-bold text-base text-foreground">Roster</Text>
            <Text className="text-xs text-muted-foreground">Numbers are enough; names make the clips easier to find later.</Text>
            <RosterEditor roster={roster} onChange={setRoster} />
          </View>

          <View className="gap-2">
            <Text className="font-sans-bold text-base text-foreground">What you track</Text>
            <View className="flex-row gap-2">
              {[false, true].map((b) => (
                <Pressable key={String(b)} onPress={() => setTrackBoth(b)} className={`rounded-full px-4 py-2 ${trackBoth === b ? "bg-primary" : "bg-muted"}`}>
                  <Text className={trackBoth === b ? "text-primary-foreground" : "text-foreground"}>{b ? "Both teams" : `${ourName.trim() || "Your team"} only`}</Text>
                </Pressable>
              ))}
            </View>
            {trackBoth && <Text className="text-xs text-muted-foreground">Say “dom” (or the opponent's name) first for their events: “dom tvåa fem”.</Text>}
          </View>

          <View className="gap-2">
            <Text className="font-sans-bold text-base text-foreground">Microphone</Text>
            {!mic.checked ? (
              <Button title="Check voice recognition" variant="outline" onPress={checkMic} />
            ) : mic.ok ? (
              <Text className="text-sm text-emerald-500">{mic.onDevice ? "On-device Swedish recognition is ready." : (mic.reason ?? "Ready.")}</Text>
            ) : (
              <Text className="text-sm text-amber-500">{mic.reason ?? "Voice unavailable."} You can tap every event instead.</Text>
            )}
          </View>

          {error && <Text className="text-sm text-destructive">{error}</Text>}
          <Button title="Start game" onPress={start} loading={busy} disabled={!ourName.trim() || !oppName.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
