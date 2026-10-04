import { FlatList, Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { boxScore } from "@scoutable/shared/lib/stat-session";
import { useAuth } from "@/lib/auth-context";
import { useSessions, type LocalSession } from "@/features/stat-keeper/store";
import { Button } from "@/components/Button";

function statusLabel(s: LocalSession): { text: string; tone: string } {
  if (s.state.session.status === "final") return { text: "Published", tone: "text-emerald-500" };
  if (s.lastUploadError) return { text: "Upload failed", tone: "text-destructive" };
  if (s.pendingUpload) return { text: "On this phone", tone: "text-amber-500" };
  return { text: "Uploaded", tone: "text-muted-foreground" };
}

export default function Games() {
  const { sessions, loading } = useSessions();
  const { keeperLabel, signOut } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-5 pt-2">
        <View>
          <Text className="font-heading text-3xl text-foreground">Your games</Text>
          <Text className="text-xs text-muted-foreground">Keeping stats as {keeperLabel}</Text>
        </View>
        <Pressable onPress={() => void signOut()} className="px-2 py-1">
          <Text className="text-sm text-muted-foreground">Sign out</Text>
        </Pressable>
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(s) => s.state.session.id}
        contentContainerClassName="px-5 py-4 gap-3"
        ListEmptyComponent={
          loading ? null : (
            <View className="rounded-xl bg-card p-5">
              <Text className="font-sans-bold text-base text-foreground">No games yet</Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                Start one before tip-off. You can speak (“tvåa nio”) or tap, and fix anything afterwards. Publish when the game is over and it shows up as “Stats available” in Scoutable on your computer.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const s = item.state.session;
          const box = boxScore(s, item.state.events);
          const st = statusLabel(item);
          const href = s.status === "final" ? `/session/${s.id}/review` : `/session/${s.id}`;
          return (
            <Link href={href as never} asChild>
              <Pressable className="rounded-xl bg-card p-4 active:opacity-80">
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-sans-bold text-base text-foreground" numberOfLines={1}>
                    {s.homeName} – {s.awayName}
                  </Text>
                  <Text className="font-heading text-xl text-foreground">
                    {box.team[1].pts}–{box.team[2].pts}
                  </Text>
                </View>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text className="text-xs text-muted-foreground">
                    {s.gameDate} · {item.state.events.filter((e) => e.kind !== "period" && e.voidedAt === null && e.supersededBy === null).length} events
                  </Text>
                  <Text className={`text-xs font-sans-medium ${st.tone}`}>{st.text}</Text>
                </View>
              </Pressable>
            </Link>
          );
        }}
      />

      <View className="px-5 pb-4">
        <Button title="New game" onPress={() => router.push("/new" as never)} />
      </View>
    </SafeAreaView>
  );
}
