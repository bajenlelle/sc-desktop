import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useThemeColors } from "@/lib/theme-context";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

export const ROLE_LABEL = { admin: "Admin", coach: "Coach", player: "Player" } as const;

/** "Admin · Basketball Club": the role, and the club when one is active (players' feeds gather every club). */
export function useRoleLine(): string | null {
  const { activeOrg, activeOrgRole, isPlayerOnly } = useAuth();
  const role = activeOrgRole ? ROLE_LABEL[activeOrgRole] : null;
  const club = !isPlayerOnly && activeOrg && !activeOrg.isPersonal ? activeOrg.orgName : null;
  const line = [role, club].filter(Boolean).join(" · ");
  return line || null;
}

/**
 * Who you are, at the top of Settings, as iOS Settings and Claude open
 * theirs: the picture, the name, the email and your role. The whole card
 * opens Profile.
 */
export function AccountCard() {
  const { user, profile } = useAuth();
  const colors = useThemeColors();
  const roleLine = useRoleLine();
  const name = profile?.fullName || user?.email?.split("@")[0] || "Your profile";
  return (
    <View
      className="overflow-hidden rounded-[22px] bg-card"
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator }}
    >
    <Tappable
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={["Profile", name, user?.email, roleLine].filter(Boolean).join(", ")}
      onPress={() => router.push("/profile/details")}
      className={({ pressed }) => cn("flex-row items-center gap-3.5 px-4 py-3.5", pressed && "bg-fill-2")}
    >
      <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={52} />
      <View className="min-w-0 flex-1">
        <Text variant="headline" numberOfLines={2}>
          {name}
        </Text>
        {user?.email ? (
          <Text variant="subheadline" numberOfLines={1} className="text-muted-foreground">
            {user.email}
          </Text>
        ) : null}
        {roleLine ? (
          <Text variant="subheadline" numberOfLines={1} className="text-muted-foreground">
            {roleLine}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} strokeWidth={2} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
    </Tappable>
    </View>
  );
}
