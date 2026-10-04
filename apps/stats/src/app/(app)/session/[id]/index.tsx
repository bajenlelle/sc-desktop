import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { randomUUID } from "expo-crypto";
import { contextualStringsFor, parseStatUtterance } from "@scoutable/shared/lib/stat-grammar";
import { boxScore, currentEvents } from "@scoutable/shared/lib/stat-session";
import type { ParseContext, StatIntent } from "@scoutable/shared/types/stat-session";
import { trackEvent } from "@/lib/analytics";
import { useSessions } from "@/features/stat-keeper/store";
import { ConfirmStrip, ListenButton, PeriodBar, TapPad, flipPatch } from "@/features/stat-keeper/components";
import { ExpoSpeechRecognizer } from "@/features/stat-keeper/recognizer/expo-speech";
import type { Recognizer, RecognizerStatus } from "@/features/stat-keeper/recognizer/types";

const LOCALE = "sv-SE";

function failureHint(reason: string, jersey?: number, suggestion?: number): string {
  switch (reason) {
    case "no_event": return "Didn't catch an action — say e.g. “tvåa nio” or tap it.";
    case "ambiguous": return "Heard two numbers — which was the points and which the player?";
    case "two_numbers": return "Heard two jerseys — one player per command.";
    case "unknown_jersey": return `No #${jersey} on the roster${suggestion !== undefined ? ` — did you mean #${suggestion}?` : ""}. Tap to pick.`;
    case "opponent_disabled": return "That sounded like the other team — this game tracks yours only.";
    default: return "Didn't catch that.";
  }
}

export default function LiveSession() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { get, dispatch } = useSessions();
  const local = get(id);
  const [status, setStatus] = useState<RecognizerStatus>("idle");
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [interim, setInterim] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const recRef = useRef<Recognizer | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const session = local?.state.session;
  const events = local?.state.events ?? [];
  const period = local?.state.period ?? 1;
  const ourRoster = session ? (session.ourSide === 1 ? session.homeRoster : session.awayRoster) : [];
  const oppRoster = session ? (session.ourSide === 1 ? session.awayRoster : session.homeRoster) : [];
  const ourName = session ? (session.ourSide === 1 ? session.homeName : session.awayName) : "";
  const oppName = session ? (session.ourSide === 1 ? session.awayName : session.homeName) : "";

  const ctx = useMemo<ParseContext | null>(
    () =>
      session
        ? { roster: ourRoster, opponentRoster: oppRoster, trackBoth: session.trackingMode === "both", ourSide: session.ourSide, ourName, opponentName: oppName }
        : null,
    [session, ourRoster, oppRoster, ourName, oppName],
  );

  const showHint = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 4000);
  }, []);

  const record = useCallback(
    (intents: StatIntent[], side: "ours" | "opponent", at: string, source: "live" | "tap", extra?: { rawUtterance?: string; confidence?: number | null }) => {
      if (!session) return;
      dispatch(session.id, { type: "record", intents, side, at, source, newClientId: randomUUID }, extra);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setHint(null);
      for (const i of intents) {
        if (i.kind === "undo") trackEvent("stat_event_undone", { source });
        else if (i.kind === "tipoff") trackEvent("stat_tipoff_marked", { source });
        else trackEvent("stat_event_recorded", { kind: i.kind, source });
      }
    },
    [session, dispatch],
  );

  // Recogniser lifecycle: one instance per screen; stop on unmount.
  useEffect(() => {
    const rec = new ExpoSpeechRecognizer();
    recRef.current = rec;
    const offU = rec.onUtterance((u) => {
      if (!ctx) return;
      if (!u.isFinal) {
        setInterim(u.transcript);
        return;
      }
      setInterim("");
      const parsed = parseStatUtterance(u.transcript, ctx);
      if (parsed.ok) {
        record(parsed.intents, parsed.side, new Date(u.startedAt).toISOString(), "live", { rawUtterance: u.transcript, confidence: u.confidence });
      } else {
        showHint(failureHint(parsed.reason, parsed.jersey, parsed.suggestion));
        trackEvent("stat_utterance_unparsed", { reason: parsed.reason, tokens: u.transcript.split(/\s+/).length });
      }
    });
    const offS = rec.onStatus((s, detail) => {
      setStatus(s);
      if (s === "restarting") trackEvent("stat_recognizer_restarted", { reason: detail });
      if (s === "error" && detail) showHint(`Microphone: ${detail}`);
    });
    const offL = rec.onLevel(setLevel);
    return () => {
      offU();
      offS();
      offL();
      void rec.stop();
      recRef.current = null;
    };
    // ctx/record change when the roster changes; the listeners read the latest via closure re-subscription.
  }, [ctx, record, showHint]);

  async function toggleListening() {
    const rec = recRef.current;
    if (!rec || !ctx) return;
    if (status === "listening" || status === "restarting") {
      await rec.stop();
      trackEvent("stat_listening_toggled", { on: false });
      return;
    }
    const granted = await rec.requestPermissions();
    if (!granted) {
      setVoiceEnabled(false);
      showHint("Microphone permission denied — tap events instead.");
      return;
    }
    const a = await rec.checkAvailability(LOCALE);
    if (!a.ok) {
      setVoiceEnabled(false);
      showHint(a.reason ?? "Voice recognition unavailable.");
      return;
    }
    await rec.start({ locale: LOCALE, contextualStrings: contextualStringsFor(ourRoster, oppName), persistAudio: true });
    trackEvent("stat_listening_toggled", { on: true, on_device: a.onDevice });
  }

  if (!session || !local) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Game not found on this phone.</Text>
      </SafeAreaView>
    );
  }

  const cur = currentEvents(events);
  const last = [...cur].reverse().find((e) => e.kind !== "period") ?? null;
  const box = boxScore(session, events);
  const now = () => new Date().toISOString();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pt-2">
        <Pressable onPress={() => router.replace("/games" as never)}>
          <Text className="text-sm text-muted-foreground">‹ Games</Text>
        </Pressable>
        <Text className="font-heading text-2xl text-foreground">
          {box.team[1].pts}–{box.team[2].pts}
        </Text>
        <Pressable onPress={() => router.push(`/session/${session.id}/review` as never)}>
          <Text className="text-sm text-primary">Review ›</Text>
        </Pressable>
      </View>
      <Text className="px-5 text-xs text-muted-foreground" numberOfLines={1}>
        {session.homeName} – {session.awayName} · Q{period}
      </Text>

      <ScrollView contentContainerClassName="px-5 py-4 gap-4" keyboardShouldPersistTaps="handled">
        <PeriodBar
          period={period}
          tipoffMarked={!!session.tipoffAt}
          periodCount={session.periodCount}
          onTipoff={() => record([{ kind: "tipoff" }], "ours", now(), "tap")}
          onPeriod={(p) => record([{ kind: "period", period: p }], "ours", now(), "tap")}
        />

        <ListenButton status={status} level={level} enabled={voiceEnabled} onToggle={() => void toggleListening()} />
        {interim ? <Text className="text-center text-xs italic text-muted-foreground">“{interim}”</Text> : null}

        <ConfirmStrip
          last={last}
          hint={hint}
          onUndo={() => record([{ kind: "undo" }], "ours", now(), "tap")}
          onFlip={
            last && flipPatch(last)
              ? () => dispatch(session.id, { type: "correct", seq: last.seq, patch: flipPatch(last)!, at: now(), newClientId: randomUUID })
              : null
          }
        />

        <View className="gap-2">
          <Text className="font-sans-bold text-sm text-foreground">Tap instead</Text>
          <TapPad roster={ourRoster} onIntent={(intent) => record([intent], "ours", now(), "tap")} />
          {session.trackingMode === "both" && (
            <>
              <Text className="mt-2 font-sans-bold text-sm text-foreground">{oppName}</Text>
              <TapPad roster={oppRoster} onIntent={(intent) => record([intent], "opponent", now(), "tap")} />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
