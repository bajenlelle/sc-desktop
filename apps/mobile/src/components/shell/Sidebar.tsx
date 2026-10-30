import { useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { feedCounts, recentPlaylists } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { usePlaylistOpener } from "@/lib/use-playlist-opener";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PopoverMenu } from "@/components/ui/PopoverMenu";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { Wordmark } from "@/components/ui/Wordmark";

const ROLE_LABEL = {
  admin: "Admin",
  coach: "Coach",
  player: "Player",
} as const;
const RECENT_COUNT = 6;

type CoachView = "by-me" | "with-me";

interface Destination {
  key: string;
  label: string;
  icon: IconName;
  /** Where it goes: a route, or the coach's view of /playlists. */
  pathname: "/playlists" | "/highlights";
  view?: CoachView;
  count?: number;
}

/**
 * The sidebar, as Claude's: the wordmark, the club (switchable when there
 * are several), the destinations (players: My playlists and My highlights;
 * coaches: Shared by me and Shared with me, two views of one route), the
 * playlists watched most recently, and the account at the foot, which opens
 * the settings sheet. Replaces the tab bar. The drawer navigator draws it beside the
 * current screen and closes it on Android back.
 */
export function Sidebar({ navigation, playerOnly }: DrawerContentComponentProps & { playerOnly: boolean }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { profile, myOrgs, activeOrg, activeOrgId, activeOrgRole, isPlayerOnly, setActiveOrg, reloadProfile } =
    useAuth();
  const { feedItems } = usePlaylists();
  const { resumePlaylist } = usePlaylistOpener();
  const pathname = usePathname();
  const { view } = useGlobalSearchParams<{ view?: string }>();
  const [clubsOpen, setClubsOpen] = useState(false);
  const clubAnchor = useRef<View>(null);

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  const recent = useMemo(() => recentPlaylists(feedItems, RECENT_COUNT), [feedItems]);
  // Clubs only: a personal space is never selectable (see resolveActiveOrg).
  const clubOptions = useMemo(
    () => myOrgs.filter((o) => !o.isPersonal).map((o) => ({ value: o.orgId, label: o.orgName })),
    [myOrgs],
  );

  const destinations: Destination[] = isCoachOrAdmin
    ? [
        {
          key: "by-me",
          label: "Shared by me",
          icon: "send",
          pathname: "/playlists",
          view: "by-me",
        },
        {
          key: "with-me",
          label: "Shared with me",
          icon: "inbox",
          pathname: "/playlists",
          view: "with-me",
          count: newCount,
        },
      ]
    : [
        {
          key: "playlists",
          label: "My playlists",
          icon: "playlists",
          pathname: "/playlists",
          count: newCount,
        },
        ...(playerOnly
          ? [
              {
                key: "highlights",
                label: "My highlights",
                icon: "highlights",
                pathname: "/highlights",
              } as Destination,
            ]
          : []),
      ];

  const currentView: CoachView = view === "with-me" ? "with-me" : "by-me";
  const isActive = (d: Destination) =>
    d.pathname === "/playlists"
      ? pathname === "/playlists" && (!d.view || d.view === currentView)
      : pathname === d.pathname;

  const go = (d: Destination) => {
    navigation.closeDrawer();
    if (d.pathname === "/playlists" && pathname === "/playlists") {
      // Already there: switch the view in place rather than stacking a second copy.
      if (d.view) router.setParams({ view: d.view });
      return;
    }
    router.navigate(d.view ? { pathname: d.pathname, params: { view: d.view } } : d.pathname);
  };

  const role = activeOrgRole ? ROLE_LABEL[activeOrgRole] : null;
  const name = profile?.fullName ?? profile?.email ?? "Account";
  const subtitle = [role, !isPlayerOnly && activeOrg && !activeOrg.isPersonal ? activeOrg.orgName : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View className="px-5 pb-4 pt-5">
          <Wordmark height={24} />
        </View>

        {!isPlayerOnly && clubOptions.length > 1 && activeOrg ? (
          <View ref={clubAnchor} collapsable={false}>
            <Tappable
              scaleTo={1}
              accessibilityRole="button"
              accessibilityLabel={`Club: ${activeOrg.orgName}. Switch club`}
              onPress={() => setClubsOpen(true)}
              className={({ pressed }) =>
                cn("mx-2 mb-2 min-h-11 flex-row items-center gap-3 rounded-window px-3", pressed && "bg-fill-1")
              }
            >
              <Icon name="club" size={20} color={colors.mutedForeground} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-muted-foreground">
                {activeOrg.orgName}
              </Text>
              <Icon name="chevronUpDown" size={16} color={colors.mutedForeground} />
            </Tappable>
          </View>
        ) : null}

        <View className="gap-0.5">
          {destinations.map((d) => {
            const active = isActive(d);
            return (
              <Tappable
                key={d.key}
                scaleTo={1}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={d.count ? `${d.label}, ${d.count} new` : d.label}
                onPress={() => go(d)}
                className={({ pressed }) =>
                  cn(
                    "mx-2 min-h-12 flex-row items-center gap-3.5 rounded-window px-3",
                    active ? "bg-fill-2" : pressed && "bg-fill-1",
                  )
                }
              >
                <Icon name={d.icon} size={22} color={colors.foreground} />
                <Text numberOfLines={1} className="min-w-0 flex-1">
                  {d.label}
                </Text>
                {d.count ? (
                  <Text variant="subheadline" nums className="text-muted-foreground">
                    {d.count > 99 ? "99+" : String(d.count)}
                  </Text>
                ) : null}
              </Tappable>
            );
          })}
        </View>

        {recent.length > 0 ? (
          <View className="pt-6">
            <Text variant="subheadline" accessibilityRole="header" className="px-5 pb-1.5 text-muted-foreground">
              Recent
            </Text>
            {recent.map((p) => (
              <Tappable
                key={p.id}
                scaleTo={1}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}, ${p.watchedCount} of ${p.clipCount} watched`}
                onPress={() => {
                  navigation.closeDrawer();
                  resumePlaylist(p.id);
                }}
                className={({ pressed }) =>
                  cn("mx-2 min-h-11 flex-row items-center gap-3.5 rounded-window px-3", pressed && "bg-fill-1")
                }
              >
                <Icon name="listVideo" size={20} color={colors.mutedForeground} />
                <Text numberOfLines={1} className="min-w-0 flex-1">
                  {p.name}
                </Text>
              </Tappable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 8 }} className="px-2 pt-2">
        <Tappable
          scaleTo={1}
          accessibilityRole="button"
          accessibilityLabel={`Settings, ${name}`}
          onPress={() => {
            // Settings rise as a sheet over the screen the sidebar slides back to.
            navigation.closeDrawer();
            router.push("/profile");
          }}
          className={({ pressed }) =>
            cn("min-h-14 flex-row items-center gap-3 rounded-window px-3 py-2", pressed && "bg-fill-1")
          }
        >
          <Avatar name={name} url={profile?.avatarUrl} size={36} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="font-medium">
              {name}
            </Text>
            {subtitle ? (
              <Text variant="footnote" numberOfLines={1} className="text-muted-foreground">
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Tappable>
      </View>

      <PopoverMenu
        visible={clubsOpen}
        onClose={() => setClubsOpen(false)}
        anchorRef={clubAnchor}
        accessibilityLabel="Club"
        groups={[
          {
            key: "clubs",
            items: clubOptions.map((o) => ({
              key: o.value,
              label: o.label,
              icon: "club" as const,
              checked: o.value === activeOrgId,
              onSelect: () => {
                if (o.value === activeOrgId) return;
                setActiveOrg(o.value);
                void reloadProfile();
              },
            })),
          },
        ]}
      />
    </View>
  );
}
