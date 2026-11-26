/**
 * One section of a scouting report as the phone draws it, the web page's
 * report-document.tsx at phone width, in the watch screen's look: a player
 * as a trading card (photo, the jersey number on a disc in the team's
 * colour, the name); their numbers as one strip, the display face for the
 * figures; the coach's note in a card with the coach's initials (it's the
 * coach speaking); the section's own blocks (keys numbered in the team's
 * colour, How they play as rows, their games as a list); then the section's
 * clips as one rail of posters, each marked with its play's code, and a
 * Play all button. A clip
 * opens the section's clips in the player (reports/[id]/play), so a player
 * watches a section through like a playlist.
 */
import { ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { eventHue, eventShortLabel } from "@scoutable/shared/lib/events";
import { rgba } from "@scoutable/shared/lib/theme-derived";
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
import { displayStyle } from "@/lib/fonts";
import { useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Dot } from "@/components/ui/Row";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

const POSTER_W = 168;
const POSTER_H = Math.round((POSTER_W * 9) / 16);

function mediaUrl(key: string | null): string | null {
  return key ? `${MEDIA_BASE}/${key}` : null;
}

/**
 * A player's numbers as one strip, the box score's way: up to five side by
 * side (three at large text sizes), more in rows of four, hairlines between.
 */
export function StatTiles({ stats }: { stats: ReportStats }) {
  const colors = useThemeColors();
  const large = useLargeText();
  if (stats.cells.length === 0 && !stats.context) return null;
  const n = stats.cells.length;
  const cols = Math.min(large ? 3 : n <= 5 ? n : 4, Math.max(1, n));
  const rows: (typeof stats.cells)[] = [];
  for (let i = 0; i < n; i += cols) rows.push(stats.cells.slice(i, i + cols));
  return (
    <View className="gap-1.5">
      {n > 0 ? (
        <View className="overflow-hidden rounded-window bg-fill-1">
          {rows.map((row, r) => (
            <View key={r} className="flex-row" style={r > 0 ? { borderTopWidth: 0.5, borderTopColor: colors.separator } : undefined}>
              {Array.from({ length: cols }, (_, i) => {
                const c = row[i];
                return (
                  <View
                    key={c?.label ?? `empty-${i}`}
                    accessible={!!c}
                    accessibilityLabel={c ? `${c.label} ${c.value}` : undefined}
                    className="flex-1 items-center px-1 py-2.5"
                    style={i > 0 ? { borderLeftWidth: 0.5, borderLeftColor: colors.separator } : undefined}
                  >
                    {c ? (
                      <>
                        <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={[displayStyle(800), { fontSize: 26, lineHeight: 28, color: colors.foreground }]}>
                          {c.value}
                        </Text>
                        <Text variant="caption" numberOfLines={1} className="uppercase tracking-wider text-muted-foreground" style={{ fontSize: 11 }}>
                          {c.label}
                        </Text>
                      </>
                    ) : null}
                  </View>
                );
              })}
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

/** The coach's own words in a soft card, their initials in front: it's the coach speaking. */
function CoachNote({ text, coach }: { text: string; coach?: string | null }) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-window bg-fill-1 p-3">
      {coach ? <Avatar name={coach} size={24} /> : null}
      <Text variant="callout" className="min-w-0 flex-1">
        {text}
      </Text>
    </View>
  );
}

function KeysList({ items, tint }: { items: string[]; tint: string }) {
  return (
    <View className="gap-3">
      {items.map((item, i) => (
        <View key={i} className="flex-row items-baseline gap-3">
          <Text importantForAccessibility="no" className="w-5 text-right" style={[displayStyle(800), { fontSize: 24, lineHeight: 26, color: tint }]}>
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
        {/* The play's code in the top corner (broadcast scoreboards sit along the bottom): its colour as a dot on a dark chip, legible on any frame. */}
        <View className="absolute left-1.5 top-1.5 flex-row items-center gap-1 rounded-[6px] px-1.5" style={{ backgroundColor: "rgba(0,0,0,0.62)", height: 20 }}>
          <Dot size={6} color={colors.eventDot[hue]} />
          <Text maxFontSizeMultiplier={1.2} style={[displayStyle(800), { fontSize: 13, lineHeight: 16, color: "#fff" }]}>
            {eventShortLabel({ type: clip.type, subType: clip.subType, isSuccessful: clip.made ? 1 : 0 } as Parameters<typeof eventShortLabel>[0])}
          </Text>
        </View>
        {watched ? (
          <View className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
            <Icon name="check" size={14} strokeWidth={2.25} color="#fff" />
          </View>
        ) : null}
      </View>
      <View className="mt-1.5 min-w-0 flex-row items-center gap-1.5">
        <Text variant="subheadline" numberOfLines={1} className="shrink font-medium">
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

/** The section's own play button: a quiet pill (the header's cyan one is the screen's main action). */
function PlayAllButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={0.97}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={6}
      className={({ pressed }) => cn("h-8 flex-row items-center gap-1.5 rounded-full px-3", pressed ? "bg-fill-3" : "bg-fill-2")}
    >
      <Icon name="play" size={12} color={colors.foreground} />
      <Text variant="subheadline" className="font-semibold">
        {label}
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
        <PlayAllButton label={clips.length === 1 ? "Play" : "Play all"} onPress={() => onPlay(null)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
        {clips.map((c) => (
          <ClipPoster key={c.id} clip={c} watched={watched.has(c.clipKey)} onPlay={() => onPlay(c.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

const PHOTO = 64;

function SectionHeading({ section, tint }: { section: ReportSection; tint: string }) {
  const colors = useThemeColors();
  const p = section.player;
  if (p) {
    const photo = playerPhotoUrl(MEDIA_BASE, p.photoKey, "S1");
    return (
      <View
        className="flex-row items-center gap-4"
        accessible
        accessibilityRole="header"
        accessibilityLabel={[p.number ? `Number ${p.number}` : null, p.name, p.teamName].filter(Boolean).join(", ")}
      >
        {/* A trading card's corner: the photo ringed in the team's colour, the number on a disc. */}
        <View>
          <View style={{ width: PHOTO + 6, height: PHOTO + 6, borderRadius: (PHOTO + 6) / 2, borderWidth: 2, borderColor: rgba(tint, 0.55), alignItems: "center", justifyContent: "center" }}>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, backgroundColor: colors.fill2 }}
                contentFit="cover"
                transition={150}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Avatar name={p.name} size={PHOTO} />
            )}
          </View>
          {p.number ? (
            <View
              style={{
                position: "absolute",
                right: -6,
                bottom: -4,
                minWidth: 28,
                height: 28,
                paddingHorizontal: 5,
                borderRadius: 14,
                backgroundColor: tint,
                borderWidth: 2.5,
                borderColor: colors.background,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text maxFontSizeMultiplier={1.2} style={[displayStyle(800), { fontSize: 16, lineHeight: 18, color: "#fff" }]}>
                {p.number}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="min-w-0 flex-1">
          <Text variant="title3">{p.name}</Text>
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
    <Text accessibilityRole="header" style={[displayStyle(800), { fontSize: 26, lineHeight: 28, textTransform: "uppercase", color: colors.foreground }]}>
      {reportSectionTitle(section.kind, section.title)}
    </Text>
  );
}

export function ReportSectionView({
  section,
  watched,
  tint,
  coach,
  onPlay,
}: {
  section: ReportSection;
  watched: ReadonlySet<string>;
  /** The scouted team's colour (teamTint): the number disc, the keys. */
  tint: string;
  /** Who wrote it: the initials on the coach's notes. */
  coach?: string | null;
  /** Plays the section's clips from one (null: from where the reader stopped). */
  onPlay: (clipId: string | null) => void;
}) {
  const clips = sectionClips(section);
  return (
    <View className="gap-4 py-6">
      <View className="gap-4 px-4">
        <SectionHeading section={section} tint={tint} />
        {section.stats ? <StatTiles stats={section.stats} /> : null}
        {section.note ? <CoachNote text={section.note} coach={coach} /> : null}
        {section.blocks.map((b, i) => {
          switch (b.kind) {
            case "text":
              // The coach's own summary (a report from before sections keeps it here).
              return <CoachNote key={i} text={b.text} coach={coach} />;
            case "keys":
              return <KeysList key={i} items={b.items} tint={tint} />;
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
  photoFor,
}: {
  items: { id: string; label: string }[];
  current: string | null;
  onJump: (id: string) => void;
  /** A player section's photo for its chip; null for the others. */
  photoFor?: (id: string) => string | null;
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
              className={({ pressed }) =>
                cn("min-h-9 flex-row items-center gap-1.5 rounded-full pr-3.5", photoFor?.(it.id) ? "pl-1.5" : "pl-3.5", on ? "bg-fill-3" : pressed ? "bg-fill-2" : "bg-fill-1")
              }
            >
              {photoFor?.(it.id) ? (
                <Image
                  source={{ uri: photoFor(it.id)! }}
                  style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.fill2 }}
                  contentFit="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
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
