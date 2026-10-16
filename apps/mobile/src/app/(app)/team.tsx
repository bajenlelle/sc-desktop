import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SectionList,
  Text,
  View,
} from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam, useSpaceSuggestions, useTeamCatalog } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { useThemeColors } from "@/lib/theme-context";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { LeagueChip, TeamCrest } from "@/components/TeamCrest";
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
 * "Which team do you coach / play for?" — the once-per-space step (mode=step,
 * opened by the tabs layout) and Profile's Change (mode=change). One answer
 * per space; the boxes below the list copy it to the user's other spaces.
 */
export default function TeamScreen() {
  const params = useLocalSearchParams<{ mode?: string; orgId?: string }>();
  const mode = params.mode === "change" ? "change" : "step";
  const { myOrgs, profile } = useAuth();
  const { choices, save } = useMyTeam();
  const { teams, failed, retry } = useTeamCatalog();
  const colors = useThemeColors();

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

  const renderTeam = ({ item }: { item: LeagueTeam }) => {
    const selected = item.id === selectedId;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => setSelectedId(item.id)}
        className={`flex-row items-center gap-3 px-3 py-2.5 ${selected ? "bg-primary/10" : "active:bg-muted"}`}
      >
        <TeamCrest team={item} />
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-base font-medium text-foreground" numberOfLines={1}>
              {item.name}
            </Text>
            <LeagueChip name={item.leagueName} />
          </View>
          {item.clubName && item.clubName !== item.name ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {item.clubName}
            </Text>
          ) : null}
        </View>
        {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <View className="gap-1 px-4 pb-3 pt-4">
          <Text className="text-xs font-medium text-muted-foreground">
            In <Text className="text-foreground">{spaceLabel(org)}</Text>
          </Text>
          <Text className="font-heading text-3xl text-foreground">{teamStepTitle(role)}</Text>
          <Text className="text-sm text-muted-foreground">
            {mode === "step" ? TEAM_STEP_SUBTITLE : "We'll use it to find your games when you import."}
          </Text>
        </View>

        {noteMode ? (
          <View className="flex-1 gap-2 px-4">
            <Input
              label="Team and league"
              value={note}
              onChangeText={setNote}
              maxLength={120}
              autoFocus
              placeholder="e.g. Sollentuna U16, Division 2"
              onSubmitEditing={handleSave}
            />
            <Text className="text-xs text-muted-foreground">
              We only cover a few leagues so far. Telling us yours helps us decide which to add next.
            </Text>
          </View>
        ) : (
          <View className="flex-1 px-4">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search teams or clubs"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {failed ? (
              <View className="items-center gap-3 py-10">
                <Text className="text-sm text-muted-foreground">Couldn't load the teams.</Text>
                <Button title="Try again" variant="outline" onPress={retry} />
              </View>
            ) : teams === null ? (
              <ActivityIndicator className="py-10" color={colors.primary} />
            ) : (
              <SectionList
                className="mt-3 flex-1 rounded-lg border border-border"
                sections={sections}
                keyExtractor={(t) => t.id}
                renderItem={renderTeam}
                keyboardShouldPersistTaps="handled"
                stickySectionHeadersEnabled
                renderSectionHeader={({ section }) => (
                  <Text className="bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {section.title}
                  </Text>
                )}
                ListEmptyComponent={
                  <Text className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No teams match “{query.trim()}”. Try the club name, or tell us your team isn't listed.
                  </Text>
                }
              />
            )}
          </View>
        )}

        <View className="gap-3 px-4 pb-2 pt-3">
          {setup.others.map((o) => {
            const on = checked.has(o.orgId);
            return (
              <Pressable
                key={o.orgId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(o.orgId)}
                className="flex-row items-center gap-2"
              >
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.mutedForeground} />
                <Text className="flex-1 text-sm text-foreground">{alsoUseLabel(o)}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setNoteMode((v) => !v)} accessibilityRole="button">
            <Text className="text-sm text-primary">{noteMode ? "Back to the list" : "My team isn't listed"}</Text>
          </Pressable>
          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              variant="ghost"
              title={mode === "step" ? "Skip for now" : "Cancel"}
              onPress={mode === "step" ? handleSkip : leave}
              disabled={saving}
            />
            <Button
              className="flex-1"
              title={noteMode ? "Send" : mode === "step" ? "Continue" : "Save"}
              onPress={handleSave}
              disabled={!canSave}
              loading={saving}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
