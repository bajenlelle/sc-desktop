import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listPlaylists, getMyTeamPlaylists, getMyDirectPlaylists } from "@scoutable/shared/lib/playlists-db";
import type { Playlist } from "@scoutable/shared/types/match";
import { supabase } from "../../../lib/supabase";

type Tab = "mine" | "team" | "shared";

export default function PlaylistsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("mine");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      let data: Playlist[];
      if (tab === "mine") data = await listPlaylists(supabase);
      else if (tab === "team") data = await getMyTeamPlaylists(supabase);
      else data = await getMyDirectPlaylists(supabase);
      setPlaylists(data);
    } catch (err) {
      console.error("[playlists] load failed:", err);
      setPlaylists([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "mine", label: "Mine" },
    { key: "team", label: "Team" },
    { key: "shared", label: "Shared" },
  ];

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-gray-900">Playlists</Text>
      </View>

      {/* Tabs */}
      <View className="flex-row border-b border-gray-200 px-4">
        {tabs.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            className="mr-6 pb-3"
            onPress={() => setTab(key)}
          >
            <Text
              className={
                tab === key
                  ? "text-primary font-semibold text-sm border-b-2 border-primary pb-0.5"
                  : "text-gray-500 text-sm"
              }
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 py-2"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Text className="text-gray-400 text-base">No playlists yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className="py-4 border-b border-gray-100"
              onPress={() => router.push(`/(app)/playlists/${item.id}`)}
            >
              <Text className="text-gray-900 font-medium text-base">{item.name}</Text>
              <Text className="text-gray-400 text-sm mt-0.5">
                {item.items.length} {item.items.length === 1 ? "item" : "items"}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
