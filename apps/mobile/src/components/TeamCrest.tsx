import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { initials } from "@/lib/format";
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
    <View style={style} className="items-center justify-center bg-muted">
      <Text style={{ fontSize: Math.max(8, size * 0.35) }} className="font-semibold text-muted-foreground">
        {initials(team.name)}
      </Text>
    </View>
  );
}

/** The league chip that tells a team apart from a space of the same name. */
export function LeagueChip({ name }: { name: string }) {
  return (
    <View className="rounded-full border border-border px-2 py-0.5">
      <Text className="text-xs text-muted-foreground">{name}</Text>
    </View>
  );
}
