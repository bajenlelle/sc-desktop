import { Platform, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import { SymbolView, type AndroidSymbol, type SFSymbol, type SymbolWeight } from "expo-symbols";

/**
 * Every icon in the app by meaning, as an SF Symbol on iOS and a Material
 * Symbol on Android (expo-symbols draws those from a bundled font), so each
 * platform gets its own icon language at the weight of the text beside it.
 * These replace the Unicode glyphs and emoji the old screens used, which
 * rendered differently on every device.
 */
export const ICONS = {
  play: { ios: "play.fill", android: "play_arrow" },
  pause: { ios: "pause.fill", android: "pause" },
  previous: { ios: "backward.end.fill", android: "skip_previous" },
  next: { ios: "forward.end.fill", android: "skip_next" },
  replay: { ios: "arrow.counterclockwise", android: "replay" },
  stop: { ios: "stop.fill", android: "stop" },
  enterFullscreen: { ios: "arrow.up.left.and.arrow.down.right", android: "fullscreen" },
  exitFullscreen: { ios: "arrow.down.right.and.arrow.up.left", android: "fullscreen_exit" },
  close: { ios: "xmark", android: "close" },
  check: { ios: "checkmark", android: "check" },
  checkCircle: { ios: "checkmark.circle.fill", android: "check_circle" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  chevronDown: { ios: "chevron.down", android: "expand_more" },
  chevronUpDown: { ios: "chevron.up.chevron.down", android: "unfold_more" },
  more: { ios: "ellipsis", android: "more_horiz" },
  search: { ios: "magnifyingglass", android: "search" },
  playlists: { ios: "play.rectangle.on.rectangle", android: "video_library" },
  highlights: { ios: "sparkles", android: "auto_awesome" },
  profile: { ios: "person.crop.circle", android: "account_circle" },
  person: { ios: "person", android: "person" },
  team: { ios: "person.2", android: "group" },
  club: { ios: "building.2", android: "apartment" },
  film: { ios: "film", android: "movie" },
  textCard: { ios: "textformat", android: "text_fields" },
  note: { ios: "text.bubble", android: "chat_bubble" },
  send: { ios: "paperplane", android: "send" },
  bell: { ios: "bell", android: "notifications" },
  warning: { ios: "exclamationmark.triangle", android: "warning" },
  error: { ios: "exclamationmark.circle", android: "error" },
  info: { ios: "info.circle", android: "info" },
  lock: { ios: "lock", android: "lock" },
  mail: { ios: "envelope", android: "mail" },
  feedback: { ios: "exclamationmark.bubble", android: "feedback" },
  trash: { ios: "trash", android: "delete" },
  signOut: { ios: "rectangle.portrait.and.arrow.right", android: "logout" },
  web: { ios: "globe", android: "language" },
  laptop: { ios: "laptopcomputer", android: "laptop" },
  phone: { ios: "iphone", android: "smartphone" },
  speed: { ios: "gauge.with.dots.needle.33percent", android: "speed" },
  basketball: { ios: "basketball", android: "sports_basketball" },
  plus: { ios: "plus", android: "add" },
} as const satisfies Record<string, { ios: SFSymbol; android: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 17,
  color,
  weight = "regular",
  style,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  /** iOS only; Android draws the regular Material Symbols weight. */
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color}
      weight={Platform.OS === "ios" ? weight : undefined}
      style={[{ width: size, height: size }, style]}
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}
