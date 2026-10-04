import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { boxScore, currentEvents } from "@scoutable/shared/lib/stat-session";
import { useSessions } from "@/features/stat-keeper/store";
import { BoxScoreTable, eventTitle } from "@/features/stat-keeper/components";
import { Button } from "@/components/Button";

export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { get, dispatch, upload, publish, reopen, remove } = useSessions();
  const local = get(id);
  const [busy, setBusy] = useState<"upload" | "publish" | "reopen" | null>(null);

  if (!local) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Game not found on this phone.</Text>
      </SafeAreaView>
    );
  }
  const s = local.state.session;
  const box = boxScore(s, local.state.events);
  const rows = currentEvents(local.state.events).filter((e) => e.kind !== "period").reverse();
  const isFinal = s.status === "final";

  async function run(kind: "upload" | "publish" | "reopen") {
    setBusy(kind);
    try {
      if (kind === "upload") await upload(s.id);
      if (kind === "publish") await publish(s.id);
      if (kind === "reopen") await reopen(s.id);
    } finally {
      setBusy(null);
    }
  }

  function confirmPublish() {
    Alert.alert(
      "Publish these stats?",
      "Everyone using Scoutable can then pick them for this game when importing it on their computer. You can reopen the game to make corrections.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Publish", onPress: () => void run("publish") },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert("Delete this game from the phone?", isFinal ? "The published stats stay online." : "Nothing has been published yet, so it is gone for good.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void remove(s.id).then(() => router.replace("/games" as never));
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pt-2">
        <Pressable onPress={() => (isFinal ? router.replace("/games" as never) : router.back())}>
          <Text className="text-sm text-muted-foreground">‹ {isFinal ? "Games" : "Live"}</Text>
        </Pressable>
        <Text className="mx-3 flex-1 text-center font-sans-bold text-base text-foreground" numberOfLines={1}>
          {s.homeName} – {s.awayName}
        </Text>
        <Pressable onPress={confirmDelete}>
          <Text className="text-sm text-destructive">Delete</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-5 py-4 gap-4">
        <View className="gap-2 rounded-xl bg-card p-4">
          <Text className="font-sans-bold text-base text-foreground">
            {isFinal ? "Published" : local.pendingUpload ? "Saved on this phone" : "Uploaded, not published"}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {s.tipoffAt ? "Tip-off marked." : "Tip-off not marked — publish needs it or at least one made basket of yours."}
            {" "}
            {isFinal
              ? s.sourceGameId
                ? `Revision ${s.revision}. On your computer, import this game from its league in Scoutable — it now shows “Stats available”.`
                : `Revision ${s.revision}. On your computer, open Scoutable → Import game → “My recorded games”.`
              : "Publishing makes the stats available to everyone for this game."}
          </Text>
          {local.lastUploadError && <Text className="text-xs text-destructive">{local.lastUploadError}</Text>}
          <View className="mt-1 flex-row gap-2">
            {!isFinal && <Button title="Save to cloud" variant="outline" onPress={() => void run("upload")} loading={busy === "upload"} />}
            {!isFinal && <Button title="Publish" onPress={confirmPublish} loading={busy === "publish"} />}
            {isFinal && <Button title="Reopen for corrections" variant="outline" onPress={() => void run("reopen")} loading={busy === "reopen"} />}
          </View>
        </View>

        <BoxScoreTable box={box} side={s.ourSide} label={s.ourSide === 1 ? s.homeName : s.awayName} />
        {s.trackingMode === "both" && (
          <BoxScoreTable box={box} side={s.ourSide === 1 ? 2 : 1} label={s.ourSide === 1 ? s.awayName : s.homeName} />
        )}

        <View className="gap-1">
          <Text className="font-sans-bold text-base text-foreground">Events</Text>
          {rows.length === 0 && <Text className="text-xs text-muted-foreground">No events.</Text>}
          {rows.map((e) => (
            <View key={e.seq} className="flex-row items-center gap-3 rounded-lg bg-card px-3 py-2">
              <Text className="w-8 text-xs text-muted-foreground">Q{e.period}</Text>
              <View className="flex-1">
                <Text className="text-sm text-foreground">{eventTitle(e)}</Text>
                <Text className="text-xs text-muted-foreground">
                  {e.jersey ? `#${e.jersey}${e.playerName ? ` ${e.playerName}` : ""}` : "Team"} · {new Date(e.recordedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </Text>
              </View>
              {!isFinal && (
                <Pressable onPress={() => dispatch(s.id, { type: "void", seq: e.seq, at: new Date().toISOString() })} className="px-2 py-1">
                  <Text className="text-xs text-destructive">Remove</Text>
                </Pressable>
              )}
            </View>
          ))}
          {isFinal && rows.length > 0 && (
            <Text className="text-xs text-muted-foreground">Reopen the game to change events.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
