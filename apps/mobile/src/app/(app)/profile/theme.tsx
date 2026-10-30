import { COLOR_THEMES } from "@scoutable/shared/lib/themes";
import { useAppTheme } from "@/lib/theme-context";
import { ThemeGrid } from "@/components/AppearanceSection";
import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { Text } from "@/components/ui/Text";

/** Settings › Theme: one theme for light mode and one for dark, as swatches. */
export default function ThemePage() {
  const { slots } = useAppTheme();
  return (
    <Screen title="Theme" sheet leading={<SheetBackButton />} grouped contentClassName="pt-0">
      <ThemeGrid heading="Light" themes={COLOR_THEMES.filter((t) => t.mode === "light")} chosen={slots.light} />
      <ThemeGrid heading="Dark" themes={COLOR_THEMES.filter((t) => t.mode === "dark")} chosen={slots.dark} />
      <Text variant="footnote" className="px-4 pb-2 pt-5 text-muted-foreground">
        One theme for light mode and one for dark. Your picks follow you to the desktop app and the web.
      </Text>
    </Screen>
  );
}
