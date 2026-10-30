/**
 * Settings › Devices (anti-account-sharing; the web's DevicesCard): one group
 * of the account's registered devices, the ones idle for 30 days in muted
 * text (only active ones hold a slot), each removable, and "Sign out
 * everywhere else" as the group's last row. The data and actions live in
 * useMyDevices.
 */
import { ActivityIndicator, View } from "react-native";
import { formatDate } from "@/lib/format";
import { useMyDevices } from "@/lib/use-my-devices";
import { useThemeColors } from "@/lib/theme-context";
import { GroupFooter, GroupRow, GroupedList } from "@/components/ui/Group";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import type { UserDevice } from "@scoutable/shared/lib/devices-db";
import { appKindLabel, partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";

const APP_ICON: Record<string, IconName> = { desktop: "laptop", mobile: "phone", web: "web" };

function lastActive(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  // In English like the rest of the app, with the year once it isn't this one.
  return formatDate(d, d.getFullYear() === new Date().getFullYear() ? "short" : "medium");
}

export function DevicesSection() {
  const colors = useThemeColors();
  const { devices, ownDeviceId, removingId, signingOut, confirmRemove, signOutOthers } = useMyDevices();

  if (devices === null) return <ActivityIndicator className="py-6" color={colors.mutedForeground} />;
  if (devices.length === 0) return null;

  const { active, inactive } = partitionDevicesByActivity(devices);

  const renderRow = (d: UserDevice, muted: boolean) => {
    const name = d.deviceName ?? d.platform ?? "Unknown device";
    const isThis = d.deviceId === ownDeviceId;
    return (
      <View key={d.deviceId} className="min-h-12 flex-row items-center gap-3 px-4 py-2">
        <Icon name={APP_ICON[d.app] ?? "web"} size={18} color={colors.mutedForeground} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className={muted ? "text-muted-foreground" : undefined}>
            {name}
          </Text>
          <Text variant="subheadline" className="text-muted-foreground">
            {appKindLabel(d.app)} · Last active {lastActive(d.lastSeen)}
          </Text>
        </View>
        {isThis ? (
          <Text variant="subheadline" className="text-muted-foreground">
            This device
          </Text>
        ) : removingId === d.deviceId ? (
          <ActivityIndicator color={colors.mutedForeground} />
        ) : (
          <Tappable
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name}`}
            disabled={removingId !== null}
            onPress={() => confirmRemove(d)}
            hitSlop={8}
            className="h-8 w-8 items-center justify-center"
          >
            <Icon name="removeCircle" size={19} color={colors.mutedForeground} />
          </Tappable>
        )}
      </View>
    );
  };

  return (
    <View>
      <GroupedList large inset={46}>
        {active.map((d) => renderRow(d, false))}
        {inactive.map((d) => renderRow(d, true))}
        {devices.length > 1 ? (
          <GroupRow
            label={<Text className="text-primary">{signingOut ? "Signing out…" : "Sign out everywhere else"}</Text>}
            disabled={signingOut}
            onPress={signOutOthers}
            accessibilityLabel="Sign out everywhere else"
          />
        ) : null}
      </GroupedList>
      <GroupFooter>Devices not used in the last 30 days don&apos;t count toward your device limit.</GroupFooter>
    </View>
  );
}
