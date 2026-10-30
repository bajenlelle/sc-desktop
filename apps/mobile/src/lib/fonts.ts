/**
 * Inter, the app's typeface (chosen 2026-10-30 over the system font: the
 * Notion feel). SIL Open Font License, bundled from @expo-google-fonts/inter
 * and loaded once by the root layout before the first screen draws.
 *
 * React Native can't pick a weight inside a custom family on Android, so each
 * weight is a family of its own and text asks for one by weight
 * (`interStyle`). The matching fontWeight is set alongside, so iOS and
 * Android never synthesise a bolder face on top. Until the files are loaded,
 * or if loading fails, `interStyle` returns nothing and text stays in the
 * system font.
 */
import type { TextStyle } from "react-native";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_400Regular_Italic } from "@expo-google-fonts/inter/400Regular_Italic";

/** The four weights the app uses and the one italic (text cards in the clip list), for expo-font's useFonts. */
export const INTER_FONTS = { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_400Regular_Italic };

export type FontWeight = 400 | 500 | 600 | 700;

const FAMILY: Record<FontWeight, keyof typeof INTER_FONTS> = {
  400: "Inter_400Regular",
  500: "Inter_500Medium",
  600: "Inter_600SemiBold",
  700: "Inter_700Bold",
};

const ITALIC: TextStyle = { fontFamily: "Inter_400Regular_Italic", fontWeight: "400" };

const STYLE: Record<FontWeight, TextStyle> = {
  400: { fontFamily: FAMILY[400], fontWeight: "400" },
  500: { fontFamily: FAMILY[500], fontWeight: "500" },
  600: { fontFamily: FAMILY[600], fontWeight: "600" },
  700: { fontFamily: FAMILY[700], fontWeight: "700" },
};

let loaded = false;

/** Called by the root layout once useFonts settles. */
export function setInterLoaded(ok: boolean) {
  loaded = ok;
}

/**
 * Inter at a weight, or undefined (system font) until the files are in.
 * Italic has its own face only at 400 (the text-card rows); other weights
 * get the platform's synthetic slant.
 */
export function interStyle(weight: FontWeight = 400, italic = false): TextStyle | undefined {
  if (!loaded) return undefined;
  return italic && weight === 400 ? ITALIC : STYLE[weight];
}

const CLASS_WEIGHT: Record<string, FontWeight> = {
  "font-normal": 400,
  "font-medium": 500,
  "font-semibold": 600,
  "font-bold": 700,
};

/** The weight a merged className asks for (its last font-* class), if any. */
export function weightFromClassName(className: string | undefined): FontWeight | undefined {
  if (!className) return undefined;
  let weight: FontWeight | undefined;
  for (const c of className.split(/\s+/)) {
    if (c in CLASS_WEIGHT) weight = CLASS_WEIGHT[c];
  }
  return weight;
}
