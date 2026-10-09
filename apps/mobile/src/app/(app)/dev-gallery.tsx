/**
 * DEV ONLY — the redesign's primitives on one screen, for checking them on
 * both platforms. Not reachable in store builds; removed before merge.
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Callout, FormRow, GroupFooter, GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PopUpButton } from "@/components/ui/PopUpButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatCells } from "@/components/ui/StatCells";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/Avatar";
import { useThemeColors } from "@/lib/theme-context";

export default function DevGallery() {
  const colors = useThemeColors();
  const [seg, setSeg] = useState<"all" | "new" | "progress" | "watched">("all");
  const [view, setView] = useState<"by" | "with">("by");
  const [team, setTeam] = useState("all");
  const [p, setP] = useState(0.4);
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-background" contentContainerClassName="gap-7 px-4 py-4">
      <Stack.Screen options={{ headerShown: true, title: "Gallery", headerLargeTitleEnabled: false }} />
      <View className="gap-1">
        <Text variant="largeTitle">Large title</Text>
        <Text variant="title1">Title 1</Text>
        <Text variant="title2">Title 2</Text>
        <Text variant="title3">Title 3</Text>
        <Text variant="headline">Headline</Text>
        <Text>Body text, 17 points</Text>
        <Text variant="callout" className="text-muted-foreground">Callout, muted</Text>
        <Text variant="subheadline" className="text-muted-foreground">Subheadline</Text>
        <Text variant="footnote" nums className="text-muted-foreground">Footnote 0:07.4 · 12 of 66</Text>
      </View>

      <SegmentedControl
        fullWidth
        size="md"
        value={view}
        onValueChange={setView}
        segments={[{ value: "by", label: "Shared by me" }, { value: "with", label: "Shared with me" }]}
      />
      <SegmentedControl
        value={seg}
        onValueChange={setSeg}
        segments={[
          { value: "all", label: "All", detail: 7 },
          { value: "new", label: "New", detail: 4 },
          { value: "progress", label: "In progress", detail: 1 },
          { value: "watched", label: "Watched", detail: 2 },
        ]}
      />
      <View className="flex-row flex-wrap gap-2">
        <PopUpButton
          accessibilityLabel="Team"
          value={team}
          onValueChange={setTeam}
          options={[{ value: "all", label: "All teams" }, { value: "dam", label: "Basketettan Dam" }, { value: "herr", label: "Superettan Herr" }]}
        />
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Button icon={<Icon name="play" size={16} color={colors.primaryForeground} />}>Continue watching</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary" size="sm">Secondary</Button>
        <Button variant="ghost" size="xs" textClassName="text-primary">Ghost xs</Button>
        <Button variant="destructive" size="sm">Delete</Button>
        <Button loading>Saving</Button>
        <Button disabled variant="outline">Disabled</Button>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Badge>New</Badge>
        <Badge variant="secondary">In progress</Badge>
        <Badge variant="success">Finished</Badge>
        <Badge variant="warning">3 days left</Badge>
        <Badge variant="destructive">Expired</Badge>
        <Badge variant="outline">Not started</Badge>
      </View>

      <StatCells
        cells={[
          { value: 9, label: "playlists shared" },
          { value: 3, label: "players reached" },
          { value: 3, label: "players haven't finished", warn: true, onPress: () => {} },
        ]}
      />

      <View>
        <GroupHeader title="Grouped list" action={<Button size="xs" variant="ghost" textClassName="text-primary">Edit</Button>} />
        <GroupedList>
          <GroupRow
            leading={<ProgressRing value={0} />}
            label="Viby makes"
            description="Johannes Forbes · Basketettan Dam · 66 clips"
            chevron
            onPress={() => setP((x) => (x >= 1 ? 0 : x + 0.3))}
          />
          <GroupRow leading={<ProgressRing value={p} />} label="In progress (tap the row above)" trailing="2 left" />
          <GroupRow leading={<ProgressRing value={1} />} label="Watched" trailing={<Icon name="check" size={14} color={colors.mutedForeground} />} />
          <GroupRow leading={<Avatar name="Pedro Hook" size={28} />} label="Pedro Hook" description="Player" />
          <GroupRow icon="signOut" label="Sign out" onPress={() => {}} />
          <GroupRow icon="trash" label="Delete account…" destructive onPress={() => {}} />
          <FormRow label="Name">
            <Text className="text-muted-foreground">Johannes</Text>
          </FormRow>
        </GroupedList>
        <GroupFooter>A footnote under the group explains what the rows do.</GroupFooter>
      </View>

      <ProgressBar value={p} />
      <Callout icon="info">A neutral note between groups.</Callout>
      <Callout tone="warning" icon="warning" action={<Button size="xs" variant="outline">Show</Button>}>
        1 playlist has clips recipients can&apos;t see yet.
      </Callout>
      <Callout tone="destructive" icon="error">The license has expired.</Callout>
      <Callout tone="success" icon="checkCircle">Reminder sent.</Callout>
      <EmptyState icon="playlists" title="No playlists yet" body="When your coach shares clips with you, they show up here." />
    </ScrollView>
  );
}
