import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { supabase } from "../../../lib/supabase";
import type { Playlist, PlaylistClipItem, PlayByPlayEvent, StoredMatch } from "@scoutable/shared/types/match";
import { getMatch } from "@scoutable/shared/lib/matches-db";

const DEFAULT_PRE_ROLL = 10; // seconds

function getVideoTime(event: PlayByPlayEvent, syncVideoTime: number, syncRealWorldTime: string): number | null {
  if (!event.realWorldTime || !syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(syncRealWorldTime).getTime();
  return syncVideoTime + (eventMs - syncMs) / 1000;
}

interface ClipInfo {
  clip: PlaylistClipItem;
  event: PlayByPlayEvent | null;
  videoTime: number | null;
  matchTitle: string;
  videoUrl: string | null;
}

export default function PlaylistViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [clipInfos, setClipInfos] = useState<ClipInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  const matchCache = useRef<Map<string, StoredMatch>>(new Map());

  // Load playlist directly from DB
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("playlists")
        .select(`
          id, user_id, name, folder_id, team_id, created_at, updated_at,
          playlist_clips (
            item_type, item_id, match_id, event_id, position,
            pre_roll_offset, post_roll_offset, note, text_content, duration_seconds, r2_url
          ),
          playlist_shares (team_id),
          playlist_user_shares (user_id)
        `)
        .eq("id", id)
        .single();

      if (error || !data) {
        setLoading(false);
        return;
      }

      const clips = [...((data as any).playlist_clips ?? [])]
        .sort((a: any, b: any) => a.position - b.position)
        .filter((c: any) => c.item_type !== "text" && c.match_id && c.event_id !== null);

      const pl: Playlist = {
        id: data.id,
        name: (data as any).name,
        items: clips.map((c: any) => ({
          type: "clip" as const,
          matchId: c.match_id,
          eventId: c.event_id,
          ...(c.pre_roll_offset !== 0 ? { preRollOffset: c.pre_roll_offset } : {}),
          ...(c.post_roll_offset !== 0 ? { postRollOffset: c.post_roll_offset } : {}),
          ...(c.note ? { note: c.note } : {}),
          ...(c.r2_url ? { r2Url: c.r2_url } : {}),
        })),
        teamIds: ((data as any).playlist_shares ?? []).map((s: any) => s.team_id),
        userIds: ((data as any).playlist_user_shares ?? []).map((s: any) => s.user_id),
        createdBy: data.user_id,
      };
      setPlaylist(pl);

      // Pre-load all unique matches
      const matchIds = [...new Set(
        pl.items
          .filter((i) => i.type === "clip")
          .map((i) => (i as PlaylistClipItem).matchId)
      )];
      await Promise.all(
        matchIds.map(async (matchId) => {
          if (!matchCache.current.has(matchId)) {
            const m = await getMatch(supabase, matchId);
            if (m) matchCache.current.set(matchId, m);
          }
        })
      );

      // Build ClipInfo for each clip
      const infos: ClipInfo[] = pl.items
        .filter((i) => i.type === "clip")
        .map((item) => {
          const clip = item as PlaylistClipItem;
          const match = matchCache.current.get(clip.matchId);
          const event = match?.events.find((e) => e.eventId === clip.eventId) ?? null;
          const videoTime =
            event && match?.syncPoint
              ? getVideoTime(event, match.syncPoint.syncVideoTime, match.syncPoint.syncRealWorldTime)
              : null;
          return {
            clip,
            event,
            videoTime,
            matchTitle: match?.title ?? "Unknown match",
            videoUrl: clip.r2Url ?? match?.videoUrl ?? null,
          };
        });
      setClipInfos(infos);
      setLoading(false);
    })();
  }, [id]);

  const activeClip = clipInfos[activeIndex];
  const videoUri = activeClip?.videoUrl ?? "";

  const player = useVideoPlayer(videoUri || "about:blank", (p) => {
    p.loop = false;
  });

  // Seek when active clip changes
  useEffect(() => {
    if (!activeClip || !videoUri) return;
    const preRoll = DEFAULT_PRE_ROLL + (activeClip.clip.preRollOffset ?? 0);
    const seekTo = activeClip.videoTime != null
      ? Math.max(0, activeClip.videoTime - preRoll)
      : 0;
    player.currentTime = seekTo;
    player.play();
  }, [activeIndex, videoUri]);

  function eventLabel(info: ClipInfo): string {
    const e = info.event;
    if (!e) return "Clip";
    const parts: string[] = [];
    if (e.type) parts.push(e.type.toUpperCase());
    if (e.subType) parts.push(e.subType);
    if (e.player) parts.push(`#${e.player.pno} ${e.player.familyName}`);
    return parts.join(" · ") || "Clip";
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!playlist) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-gray-400 text-base">Playlist not found.</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}>
          <Text className="text-primary">Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* Back button + title */}
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-primary text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-base font-semibold text-gray-900 flex-1" numberOfLines={1}>
          {playlist.name}
        </Text>
      </View>

      {/* Video player */}
      {videoUri ? (
        <View style={styles.videoContainer}>
          <VideoView
            player={player}
            style={styles.video}
            allowsFullscreen
            nativeControls
          />
        </View>
      ) : (
        <View className="w-full aspect-video bg-gray-900 items-center justify-center">
          <Text className="text-gray-400">No video available</Text>
        </View>
      )}

      {/* Clip list */}
      {clipInfos.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-400">No clips in this playlist</Text>
        </View>
      ) : (
        <FlatList
          data={clipInfos}
          keyExtractor={(_, i) => String(i)}
          contentContainerClassName="px-4 py-2"
          renderItem={({ item, index }) => (
            <TouchableOpacity
              className={`py-4 border-b border-gray-100 flex-row items-start ${
                index === activeIndex ? "bg-blue-50 -mx-4 px-4" : ""
              }`}
              onPress={() => setActiveIndex(index)}
            >
              <View
                className={`w-6 h-6 rounded-full items-center justify-center mr-3 mt-0.5 ${
                  index === activeIndex ? "bg-primary" : "bg-gray-200"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    index === activeIndex ? "text-white" : "text-gray-600"
                  }`}
                >
                  {index + 1}
                </Text>
              </View>
              <View className="flex-1">
                <Text
                  className={`font-medium ${
                    index === activeIndex ? "text-primary" : "text-gray-900"
                  }`}
                >
                  {eventLabel(item)}
                </Text>
                <Text className="text-gray-400 text-sm mt-0.5">{item.matchTitle}</Text>
                {item.clip.note && (
                  <Text className="text-gray-500 text-sm mt-1 italic">{item.clip.note}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  videoContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
});
