import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SectionList, StyleSheet, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam, useSpaceSuggestions, useTeamCatalog } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { useThemeColors } from "@/lib/theme-context";
import { useLargeText } from "@/lib/a11y";
import { TeamCrest } from "@/components/TeamCrest";
import { Screen } from "@/components/shell/Screen";
import { BackButton } from "@/components/shell/BackButton";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/cn";
import {
  TEAM_STEP_SUBTITLE,
  alsoUseLabel,
  groupTeams,
  searchTeams,
  spaceLabel,
  spacesSharingAnswer,
  spacesWithoutChoice,
  teamRoleIn,
  teamSpaces,
  teamStepTitle,
} from "@scoutable/shared/lib/league-teams";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";

/**
 * "Which team do you coach / play for?": the once-per-space step (mode=step,
 * opened by the tabs layout) and Profile's Change (mode=change). One answer
 * per space; the boxes at the bottom copy it to the user's other spaces.
 * The teams are grouped lists (your club's teams first, then by league)
 * under the platform's own search field.
 */
export default function TeamScreen() {
  const params = useLocalSearchParams<{ mode?: string; orgId?: string }>();
  const mode = params.mode === "change" ? "change" : "step";
  const { myOrgs, profile } = useAuth();
  const { choices, save } = useMyTeam();
  const { teams, failed, retry } = useTeamCatalog();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const largeText = useLargeText();

  const spaces = useMemo(() => sortOrgsClubFirst(teamSpaces(myOrgs)), [myOrgs]);
  const org = spaces.find((o) => o.orgId === params.orgId) ?? null;
  const suggestedIds = useSpaceSuggestions(org?.orgId ?? null, org?.isPersonal ?? true);

  // Fixed when the screen opens, so saving doesn't reshuffle the boxes.
  const [setup] = useState(() => {
    if (!org) return { others: [], checked: [] as string[], initialTeamId: null as string | null };
    if (mode === "step") {
      const others = spacesWithoutChoice(spaces, choices, org.orgId);
      return {
        others,
        checked: others.map((o) => o.orgId),
        // Joined a club after answering elsewhere: start from that team.
        initialTeamId: choices.find((c) => c.team)?.team?.id ?? null,
      };
    }
    return {
      others: spaces.filter((o) => o.orgId !== org.orgId),
      checked: spacesSharingAnswer(spaces, choices, org.orgId).filter((id) => id !== org.orgId),
      initialTeamId: choices.find((c) => c.orgId === org.orgId)?.team?.id ?? null,
    };
  });

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(setup.initialTeamId);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(setup.checked));
  const [noteMode, setNoteMode] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const sections = useMemo(
    () =>
      groupTeams(searchTeams(teams ?? [], query), suggestedIds).map((s) => ({
        key: s.kind === "club" ? "club" : s.leagueId,
        title: s.kind === "club" ? "Your club's teams" : s.leagueName,
        data: s.teams,
      })),
    [teams, query, suggestedIds],
  );

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/playlists");
  }

  if (!org) return <Redirect href="/playlists" />;

  const role = teamRoleIn(org, profile?.declaredRole);
  const surface = mode === "step" ? "step" : "profile";
  const canSave = noteMode ? note.trim().length > 0 : selectedId !== null;

  async function handleSave() {
    if (!org || !canSave || saving) return;
    const ids = [org.orgId, ...setup.others.filter((o) => checked.has(o.orgId)).map((o) => o.orgId)];
    setSaving(true);
    try {
      if (noteMode) {
        await save(ids, { unlistedTeam: note.trim() });
        trackEvent("team_unlisted", { surface, spaces: ids.length });
        Alert.alert("Thanks, we've noted it.");
      } else {
        const team = teams?.find((t) => t.id === selectedId);
        await save(ids, { teamId: selectedId });
        trackEvent("team_selected", {
          surface,
          league_id: team?.leagueId ?? null,
          team_name: team?.name ?? null,
          suggested: selectedId !== null && suggestedIds.has(selectedId),
          spaces: ids.length,
          includes_personal: [org, ...setup.others].some((o) => o.isPersonal && ids.includes(o.orgId)),
        });
      }
      leave();
    } catch (e) {
      console.error("[team] save failed:", e);
      Alert.alert("Couldn't save your team", "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (!org) return;
    setSaving(true);
    try {
      await save([org.orgId], {});
      trackEvent("team_step_skipped");
    } catch (e) {
      console.error("[team] skip failed:", e); // it comes back next launch
    } finally {
      setSaving(false);
      leave();
    }
  }

  function toggle(orgId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }

  const intro = (
    <View className="gap-1 px-4 pb-2 pt-2">
      <Text variant="footnote" className="text-muted-foreground">
        In <Text variant="footnote">{spaceLabel(org)}</Text>
      </Text>
      <Text variant="title2" accessibilityRole="header">
        {teamStepTitle(role)}
      </Text>
      <Text variant="subheadline" className="text-muted-foreground">
        {mode === "step" ? TEAM_STEP_SUBTITLE : "We'll use it to find your games when you import."}
      </Text>
    </View>
  );

  const renderTeam = ({ item, index, section }: { item: LeagueTeam; index: number; section: { data: readonly LeagueTeam[] } }) => {
    const selected = item.id === selectedId;
    const first = index === 0;
    const last = index === section.data.length - 1;
    return (
      <View>
        {index > 0 && <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 60, backgroundColor: colors.separator }} />}
        <Tappable
          scaleTo={1}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={[item.name, item.leagueName, item.clubName !== item.name ? item.clubName : null].filter(Boolean).join(", ")}
          onPress={() => setSelectedId(item.id)}
          className={({ pressed }) => cn("min-h-14 flex-row items-center gap-3 px-4 py-2", pressed && "bg-fill-1")}
        >
          <TeamCrest team={item} size={32} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={largeText ? 3 : 1}>
              {item.name}
              {item.leagueName ? <Text className="text-muted-foreground">{` · ${item.leagueName}`}</Text> : null}
            </Text>
            {item.clubName && item.clubName !== item.name ? (
              <Text variant="subheadline" numberOfLines={1} className="text-muted-foreground">
                {item.clubName}
              </Text>
            ) : null}
          </View>
          {selected ? <Icon name="check" size={18} strokeWidth={2.5} color={colors.primary} /> : null}
        </Tappable>
      </View>
    );
  };

  return (
    <Screen
      title={mode === "step" ? "Your team" : "Change team"}
      // The step at launch is answered or skipped, not backed out of.
      leading={mode === "change" ? <BackButton label="Profile" onPress={leave} /> : undefined}
      scroll={false}
    >
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
      {noteMode ? (
        <View className="flex-1 gap-4 pt-2">
          {intro}
          <View className="px-4">
          <TextField
            label="Team and league"
            value={note}
            onChangeText={setNote}
            maxLength={120}
            autoFocus
            placeholder="e.g. Sollentuna U16, Division 2"
            returnKeyType="send"
            onSubmitEditing={handleSave}
          />
          </View>
          <Text variant="subheadline" className="px-4 text-muted-foreground">
            We only cover a few leagues so far. Telling us yours helps us decide which to add next.
          </Text>
        </View>
      ) : failed ? (
        <View className="flex-1 pt-2">
          {intro}
          <View className="items-center gap-3 py-10">
            <Text variant="subheadline" className="text-muted-foreground">
              Couldn&apos;t load the teams.
            </Text>
            <Button variant="secondary" size="sm" onPress={retry}>
              Try again
            </Button>
          </View>
        </View>
      ) : teams === null ? (
        <View className="flex-1 pt-2">
          {intro}
          <ActivityIndicator className="py-10" color={colors.mutedForeground} />
        </View>
      ) : (
        <SectionList
          className="flex-1"
          contentContainerClassName="pb-6"
          sections={sections}
          keyExtractor={(t) => t.id}
          renderItem={renderTeam}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View>
              {intro}
              <View className="px-4 pb-1 pt-2">
                <SearchField value={query} onChangeText={setQuery} placeholder="Search teams or clubs" accessibilityLabel="Search teams or clubs" />
              </View>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text variant="headline" accessibilityRole="header" className="px-4 pb-1.5 pt-6">
              {section.title}
            </Text>
          )}
          ListEmptyComponent={
            <Text variant="subheadline" className="px-6 py-8 text-center text-muted-foreground">
              No teams match “{query.trim()}”. Try the club name, or tell us your team isn&apos;t listed.
            </Text>
          }
        />
      )}

      <View
        className="gap-3 bg-background px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }}
      >
        {setup.others.map((o) => {
          const on = checked.has(o.orgId);
          return (
            <Tappable
              key={o.orgId}
              scaleTo={1}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(o.orgId)}
              className="min-h-9 flex-row items-center gap-2.5"
            >
              <Icon name={on ? "checkboxOn" : "checkboxOff"} size={20} color={on ? colors.primary : colors.mutedForeground} />
              <Text variant="subheadline" className="flex-1">
                {alsoUseLabel(o)}
              </Text>
            </Tappable>
          );
        })}
        <Button variant="link" size="sm" className="self-start px-0" onPress={() => setNoteMode((v) => !v)}>
          {noteMode ? "Back to the list" : "My team isn't listed"}
        </Button>
        <View className={largeText ? "flex-col-reverse gap-2" : "flex-row gap-3"}>
          <Button className={largeText ? undefined : "flex-1"} variant="ghost" onPress={mode === "step" ? handleSkip : leave} disabled={saving}>
            {mode === "step" ? "Skip for now" : "Cancel"}
          </Button>
          <Button className={largeText ? undefined : "flex-1"} onPress={handleSave} disabled={!canSave} loading={saving}>
            {noteMode ? "Send" : mode === "step" ? "Continue" : "Save"}
          </Button>
        </View>
      </View>
    </KeyboardAvoidingView>
    </Screen>
  );
}
