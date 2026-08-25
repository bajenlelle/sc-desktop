import { Text, View } from "react-native";
import { Image } from "expo-image";
import { initials } from "@/lib/format";

export function Avatar({
  name,
  url,
  size = 20,
}: {
  name?: string | null;
  url?: string | null;
  size?: number;
}) {
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-muted dark:bg-muted-dark"
    >
      <Text
        style={{ fontSize: Math.max(8, size * 0.4) }}
        className="font-semibold text-muted-foreground dark:text-muted-foreground-dark"
      >
        {initials(name)}
      </Text>
    </View>
  );
}
