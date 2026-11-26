/**
 * What the player shows before anything plays, in place of a black box: the
 * playlist as a cover, the way a music app shows an album's art: the team's
 * colour deepening to near-black, a court's lines faint over it, and a
 * frosted play disc in the middle (the whole cover plays). The name and the
 * main Play button live in the header under it, so nothing is said twice.
 * It goes the moment playback starts.
 */
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from "react-native-svg";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { pressScale } from "@/lib/motion";

export function WatchCover({
  color,
  playLabel,
  onPlay,
}: {
  /** The team's colour (hex). */
  color: string;
  /** "Play" or "Resume": the button's spoken name. */
  playLabel: string;
  /** Absent for an empty playlist: the art without the disc. */
  onPlay?: () => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="deepen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="0.55" stopColor="#000" stopOpacity={0.42} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.78} />
          </LinearGradient>
        </Defs>
        <Rect width="320" height="180" fill={color} />
        <Rect width="320" height="180" fill="url(#deepen)" />
        {/* A full court, end to end, its lines faint. */}
        <Line x1="160" y1="14" x2="160" y2="166" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} />
        <Circle cx="160" cy="90" r="28" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
        <Rect x="-2" y="14" width="324" height="152" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
        <Path d="M -2 62 H 56 V 118 H -2" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
        <Path d="M 322 62 H 264 V 118 H 322" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
        <Path d="M -2 30 H 30 A 60 60 0 0 1 30 150 H -2" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
        <Path d="M 322 30 H 290 A 60 60 0 0 0 290 150 H 322" stroke="#fff" strokeOpacity={0.16} strokeWidth={1.5} fill="none" />
      </Svg>

      {onPlay ? (
        <Tappable
          scaleTo={pressScale.control}
          accessibilityRole="button"
          accessibilityLabel={playLabel}
          hitSlop={8}
          onPress={onPlay}
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.center}>
            <View style={styles.disc}>
              <Icon name="play" size={26} color="#fff" />
            </View>
          </View>
        </Tappable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  disc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
  },
});
