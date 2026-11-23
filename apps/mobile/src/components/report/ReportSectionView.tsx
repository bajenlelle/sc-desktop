/**
 * One section of a scouting report as the phone draws it, the web page's
 * report-document.tsx at phone width in the app's own type: a player's
 * photo, number and name; their numbers as big tiles that wrap rather than a
 * table that scrolls sideways; the coach's note; the section's own blocks
 * (keys numbered and large, How they play as rows, their games as a list);
 * then the section's clips as one rail of posters, with Play all. A clip
 * opens the section's clips in the player (reports/[id]/play), so a player
 * watches a section through like a playlist.
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { eventHue } from "@scoutable/shared/lib/events";
import { playerPhotoUrl, MEDIA_BASE } from "@scoutable/shared/lib/player-photos";
import { clipsProgress, reportClipLine, sectionClips } from "@scoutable/shared/lib/scouting-report-inbox";
import {
  reportSectionTitle,
  type ReportClip,
  type ReportGamesBlock,
  type ReportProfileBlock,
  type ReportSection,
  type ReportStats,
} from "@scoutable/shared/lib/scouting-report";
import { useLargeText } from "@/lib/a11y";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Dot, TextButton } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

const POSTER_W = 168;
const POSTER_H = Math.round((POSTER_W * 9) / 16);

function mediaUrl(key: string | null): string | null {
  return key ? `${MEDIA_BASE}/${key}` : null;
}

const TILE_GAP = 8;

/** A player's numbers as tiles in a fixed grid, four across (three at large text sizes), so a fifth never stretches. */
export function StatTiles({ stats }: { stats: ReportStats }) {
  const large = useLargeText();
  const [width, setWidth] = useState(0);
  if (stats.cells.length === 0 && !stats.context) return null;
  const cols = large ? 3 : 4;
  const tile = width > 0 ? Math.floor((width - TILE_GAP * (cols - 1)) / cols) : undefined;
  return (
    <View className="gap-1.5">
      {stats.cells.length > 0 ? (
        <View
          className="flex-row flex-wrap"
          style={{ gap: TILE_GAP }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {stats.cells.map((c) => (
            <View
              key={c.label}
              accessible
              accessibilityLabel={`${c.label} ${c.value}`}
              className="rounded-window bg-fill-1 px-3 py-2"
              style={{ width: tile, opacity: tile ? 1 : 0 }}
            >
              <Text variant="title2" nums>
                {c.value}
              </Text>
              <Text variant="caption" className="text-muted-foreground">
                {c.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {stats.context ? (
        <Text variant="footnote" className="text-muted-foreground">
          {stats.context}
        </Text>
      ) : null}
    </View>
  );
}

function KeysList({ items }: { items: string[] }) {
  return (
    <View className="gap-3">
      {items.map((item, i) => (
        <View key={i} className="flex-row items-baseline gap-3">
          <Text variant="title3" nums className="w-5 text-right font-semibold text-muted-foreground" importantForAccessibility="no">
            {i + 1}
          </Text>
          <Text variant="title3" className="min-w-0 flex-1">
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ProfileRows({ block }: { block: ReportProfileBlock }) {
  const colors = useThemeColors();
  const cell = (v: string, place: string | null) => (place ? `${v} · ${place}` : v);
  return (
    <View className="gap-2">
      {block.context ? (
        <Text variant="footnote" className="text-muted-foreground">
          {block.context}
        </Text>
      ) : null}
      <View className="flex-row gap-3 pb-1">
        <View className="flex-1" />
        <Text variant="footnote" className="w-[34%] text-right text-muted-foreground">
          With the ball
        </Text>
        <Text variant="footnote" className="w-[30%] text-right text-muted-foreground">
          They allow
        </Text>
      </View>
      {block.rows.map((r) => (
        <View
          key={r.label}
          accessible
          accessibilityLabel={`${r.label}: ${cell(r.own, r.ownPlace)} with the ball, they allow ${cell(r.allowed, r.allowedPlace)}`}
          className="flex-row items-baseline gap-3 py-2"
          style={{ borderTopWidth: 0.5, borderTopColor: colors.separator }}
        >
          <Text variant="callout" className="min-w-0 flex-1">
            {r.label}
          </Text>
          <Text variant="callout" nums className="w-[34%] text-right">
            {r.own}
            {r.ownPlace ? <Text variant="footnote" className="text-muted-foreground">{` · ${r.ownPlace}`}</Text> : null}
          </Text>
          <Text variant="callout" nums className="w-[30%] text-right">
            {r.allowed}
            {r.allowedPlace ? <Text variant="footnote" className="text-muted-foreground">{` · ${r.allowedPlace}`}</Text> : null}
          </Text>
        </View>
      ))}
      {block.lines.map((l) => (
        <Text key={l} variant="footnote" className="text-muted-foreground">
          {l}
        </Text>
      ))}
    </View>
  );
}

function GamesList({ block }: { block: ReportGamesBlock }) {
  const colors = useThemeColors();
  return (
    <View>
      {block.rows.map((g, i) => (
        <View
          key={i}
          className="flex-row items-baseline gap-3 py-2"
          style={i > 0 ? { borderTopWidth: 0.5, borderTopColor: colors.separator } : undefined}
        >
          <Text variant="callout" nums className="w-24 text-muted-foreground">
            {g.date}
          </Text>
          <Text variant="callout" numberOfLines={1} className="min-w-0 flex-1">
            {g.home ? "vs" : "at"} {g.opponent}
          </Text>
          <Text variant="callout" nums className={g.result ? undefined : "text-muted-foreground"}>
            {g.result ?? "To play"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ClipPoster({ clip, watched, onPlay }: { clip: ReportClip; watched: boolean; onPlay: () => void }) {
  const colors = useThemeColors();
  const large = useLargeText();
  const poster = mediaUrl(clip.posterKey);
  const hue = eventHue({ type: clip.type, isSuccessful: clip.made });
  return (
    <Tappable
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={[reportClipLine(clip), clip.note ? `note from your coach: ${clip.note}` : null, watched ? "watched" : null].filter(Boolean).join(", ")}
      onPress={onPlay}
      style={{ width: POSTER_W }}
    >
      <View style={{ width: POSTER_W, height: POSTER_H, borderRadius: 10, overflow: "hidden", backgroundColor: colors.fill2 }}>
        {poster ? <Image source={{ uri: poster }} style={{ flex: 1 }} contentFit="cover" transition={150} recyclingKey={clip.id} /> : null}
        <View className="absolute inset-0 items-center justify-center">
          <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
            <Icon name="play" size={16} color="#fff" />
          </View>
        </View>
        {watched ? (
          <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
            <Icon name="check" size={14} strokeWidth={2.25} color="#fff" />
          </View>
        ) : null}
      </View>
      <View className="mt-1.5 min-w-0 flex-row items-center gap-1.5">
        <Dot size={6} color={colors.eventDot[hue]} />
        <Text variant="subheadline" numberOfLines={1} className="shrink">
          {clip.label}
        </Text>
        {clip.note ? <Icon name="note" size={13} color={colors.mutedForeground} /> : null}
        {clip.drawings?.length ? <Icon name="draw" size={13} color={colors.mutedForeground} /> : null}
      </View>
      <Text variant="footnote" nums numberOfLines={large ? 2 : 1} className="text-muted-foreground">
        {[[clip.period, clip.clock].filter(Boolean).join(" "), clip.game].filter(Boolean).join(" · ")}
      </Text>
    </Tappable>
  );
}

function ClipRail({
  clips,
  watched,
  onPlay,
}: {
  clips: ReportClip[];
  watched: ReadonlySet<string>;
  onPlay: (clipId: string | null) => void;
}) {
  const progress = clipsProgress(clips, watched);
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3 px-4">
        <Text variant="subheadline" nums className="text-muted-foreground">
          {progress.watched > 0 ? `${progress.watched} of ${progress.total} watched` : `${clips.length} clip${clips.length === 1 ? "" : "s"}`}
        </Text>
        <TextButton label={clips.length === 1 ? "Play" : `Play all ${clips.length}`} onPress={() => onPlay(null)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
        {clips.map((c) => (
          <ClipPoster key={c.id} clip={c} watched={watched.has(c.clipKey)} onPlay={() => onPlay(c.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function SectionHeading({ section }: { section: ReportSection }) {
  const colors = useThemeColors();
  const p = section.player;
  if (p) {
    const photo = playerPhotoUrl(MEDIA_BASE, p.photoKey, "S1");
    const name = [p.number ? `#${p.number}` : null, p.name].filter(Boolean).join(" ");
    return (
      <View className="flex-row items-center gap-3" accessibilityRole="header">
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.fill2 }}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Avatar name={p.name} size={48} />
        )}
        <View className="min-w-0 flex-1">
          <Text variant="title3">{name}</Text>
          {p.teamName ? (
            <Text variant="footnote" className="text-muted-foreground">
              {p.teamName}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <Text variant="title3" accessibilityRole="header">
      {reportSectionTitle(section.kind, section.title)}
    </Text>
  );
}

export function ReportSectionView({
  section,
  watched,
  onPlay,
}: {
  section: ReportSection;
  watched: ReadonlySet<string>;
  /** Plays the section's clips from one (null: from where the reader stopped). */
  onPlay: (clipId: string | null) => void;
}) {
  const clips = sectionClips(section);
  return (
    <View className="gap-4 py-6">
      <View className="gap-4 px-4">
        <SectionHeading section={section} />
        {section.stats ? <StatTiles stats={section.stats} /> : null}
        {section.note ? <Text>{section.note}</Text> : null}
        {section.blocks.map((b, i) => {
          switch (b.kind) {
            case "text":
              return <Text key={i}>{b.text}</Text>;
            case "keys":
              return <KeysList key={i} items={b.items} />;
            case "stats":
              return (
                <View key={i} className="gap-2">
                  {b.heading ? <Text variant="headline">{b.heading}</Text> : null}
                  <StatTiles stats={b.stats} />
                </View>
              );
            case "profile":
              return <ProfileRows key={i} block={b} />;
            case "games":
              return <GamesList key={i} block={b} />;
            default:
              return null;
          }
        })}
      </View>
      {clips.length > 0 ? <ClipRail clips={clips} watched={watched} onPlay={onPlay} /> : null}
    </View>
  );
}

/** The sticky row of section chips: tap to jump, the one in view marked. */
export function JumpBar({
  items,
  current,
  onJump,
}: {
  items: { id: string; label: string }[];
  current: string | null;
  onJump: (id: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ backgroundColor: colors.background, borderBottomWidth: 0.5, borderBottomColor: colors.separator }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-4 py-2">
        {items.map((it) => {
          const on = it.id === current;
          return (
            <Tappable
              key={it.id}
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Go to ${it.label}`}
              onPress={() => onJump(it.id)}
              className={({ pressed }) => cn("min-h-9 justify-center rounded-full px-3.5", on ? "bg-fill-3" : pressed ? "bg-fill-2" : "bg-fill-1")}
            >
              <Text variant="subheadline" numberOfLines={1} className={on ? "font-semibold" : undefined}>
                {it.label}
              </Text>
            </Tappable>
          );
        })}
      </ScrollView>
    </View>
  );
}
