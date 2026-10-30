import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import {
  Bell,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleUserRound,
  Ellipsis,
  Film,
  Gauge,
  Globe,
  Info,
  Laptop,
  ListVideo,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  MessageCircle,
  MessageSquare,
  Minimize2,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Share,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquareCheck,
  Trash2,
  TriangleAlert,
  Type,
  TextAlignStart,
  Inbox,
  Circle as CircleOutline,
  User,
  Users,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react-native";

/**
 * Every icon in the app by meaning, drawn with lucide: the same glyphs the
 * desktop app and the web use (`lucide-react` there), at the same 1.75 stroke,
 * so the three apps share one icon language. One map for iOS and Android.
 * Basketball has no lucide glyph and is drawn below in lucide's style.
 */
export const ICONS = {
  play: Play,
  pause: Pause,
  previous: SkipBack,
  next: SkipForward,
  replay: RotateCcw,
  stop: Square,
  enterFullscreen: Maximize2,
  exitFullscreen: Minimize2,
  close: X,
  check: Check,
  checkCircle: CircleCheck,
  checkboxOn: SquareCheck,
  checkboxOff: Square,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  chevronUpDown: ChevronsUpDown,
  more: Ellipsis,
  search: Search,
  sliders: SlidersHorizontal,
  playlists: BookOpen,
  sharedPlaylists: Share2,
  listVideo: ListVideo,
  highlights: Sparkles,
  profile: CircleUserRound,
  person: User,
  team: Users,
  club: Building2,
  film: Film,
  textCard: Type,
  note: MessageCircle,
  send: Send,
  bell: Bell,
  warning: TriangleAlert,
  error: CircleAlert,
  info: Info,
  lock: Lock,
  mail: Mail,
  feedback: MessageSquare,
  trash: Trash2,
  removeCircle: CircleMinus,
  signOut: LogOut,
  web: Globe,
  laptop: Laptop,
  phone: Smartphone,
  speed: Gauge,
  basketball: "basketball",
  plus: Plus,
  wand: WandSparkles,
  share: Share,
  computer: Monitor,
  menu: TextAlignStart,
  inbox: Inbox,
  circle: CircleOutline,
} as const satisfies Record<string, LucideIcon | "basketball">;

export type IconName = keyof typeof ICONS;

/** Transport glyphs are solid, as in every player (and as desktop and web draw them). */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(["play", "pause", "previous", "next", "stop"]);

/** Stroke per weight, so an icon can sit at the weight of the text beside it. */
const WEIGHT_STROKE = { light: 1.5, regular: 1.75, medium: 2, semibold: 2.25, bold: 2.75 } as const;
export type IconWeight = keyof typeof WEIGHT_STROKE;

/** Icons are decorative: the control around one carries its name. */
const DECORATIVE = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

export function Icon({
  name,
  size = 16,
  color,
  weight = "regular",
  strokeWidth,
  style,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  /** Maps to a stroke width; `strokeWidth` wins when both are given. */
  weight?: IconWeight;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const stroke = strokeWidth ?? WEIGHT_STROKE[weight];
  const tint = (color ?? "#000000") as string;
  const glyph = ICONS[name];
  if (glyph === "basketball") {
    return (
      <Svg
        {...DECORATIVE}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={tint}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
      >
        <Circle cx={12} cy={12} r={10} />
        <Path d="M2 12h20" />
        <Path d="M12 2v20" />
        <Path d="M4.9 4.9a10 10 0 0 1 0 14.2" />
        <Path d="M19.1 4.9a10 10 0 0 0 0 14.2" />
      </Svg>
    );
  }
  const Glyph = glyph;
  return (
    <Glyph
      {...DECORATIVE}
      size={size}
      color={tint}
      strokeWidth={stroke}
      fill={FILLED.has(name) ? tint : "none"}
      style={style}
    />
  );
}
