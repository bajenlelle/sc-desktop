import { Text, View } from "react-native";
import type { PlaylistTextCard } from "@scoutable/shared/types/match";

/** Black overlay over the video area while a text card holds the queue. */
export function TextCardOverlay({ card }: { card: PlaylistTextCard }) {
  return (
    <View className="absolute inset-0 items-center justify-center bg-black/80 px-6">
      <Text className="text-center text-2xl font-bold text-white">{card.text}</Text>
    </View>
  );
}
