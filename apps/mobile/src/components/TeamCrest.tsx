import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { initials } from "@/lib/format";
import { Text } from "@/components/ui/Text";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";

/** A team's crest. Round on purpose: spaces are never shown round. */
export function TeamCrest({ team, size = 32 }: { team: Pick<LeagueTeam, "name" | "logoUrl">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (team.logoUrl && !broken) {
    return (
      <Image
        source={{ uri: team.logoUrl }}
        style={[style, { backgroundColor: "#ffffff" }]}
        contentFit="contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <View style={style} className="items-center justify-center bg-fill-2">
      <Text
        style={{ fontSize: Math.max(8, size * 0.35), lineHeight: Math.max(10, size * 0.45) }}
        className="font-semibold text-muted-foreground"
      >
        {initials(team.name)}
      </Text>
    </View>
  );
}
