"use client";

/**
 * Theme picker for the Settings Appearance card: swatch cards in two labeled
 * radiogroups (Dark / Light), applied on click or Enter/Space. Arrow keys move
 * focus WITHOUT selecting — the ARIA radio "selection follows focus" default
 * is deliberately not used here because selecting has app-wide side effects
 * (palette swap, possible light/dark mode flip, analytics), which the ARIA
 * authoring practices call out as the case for explicit activation. Rows are
 * separate groups so keyboard traversal can't cross the mode boundary by
 * accident. Radix RadioGroup isn't installed and isn't worth adding for this.
 */
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_THEMES, type ColorTheme } from "@scoutable/shared/lib/themes";
import { useColorTheme } from "@/components/color-theme-provider";

function ThemeRow({
  heading,
  themes,
  activeThemeId,
  onSelect,
}: {
  heading: string;
  themes: ColorTheme[];
  activeThemeId: string;
  onSelect: (id: string) => void;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const headingId = `theme-row-${heading.toLowerCase()}`;

  // Roving tabindex: the row's single tab stop is the last-focused card,
  // else the active theme (if it lives in this row), else the first card.
  const tabStopId =
    (focusedId && themes.some((t) => t.id === focusedId) && focusedId) ||
    (themes.some((t) => t.id === activeThemeId) && activeThemeId) ||
    themes[0].id;

  function handleKeyDown(e: React.KeyboardEvent) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = themes.findIndex((t) => t.id === tabStopId);
    const next = themes[(i + step + themes.length) % themes.length];
    setFocusedId(next.id);
    buttonsRef.current.get(next.id)?.focus();
  }

  return (
    <div className="space-y-1.5">
      <p id={headingId} className="text-xs font-medium text-muted-foreground">
        {heading}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
        className="grid grid-cols-4 gap-3"
      >
        {themes.map((theme) => {
          const active = theme.id === activeThemeId;
          return (
            <button
              key={theme.id}
              ref={(el) => {
                if (el) buttonsRef.current.set(theme.id, el);
                else buttonsRef.current.delete(theme.id);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={theme.id === tabStopId ? 0 : -1}
              onClick={() => onSelect(theme.id)}
              onFocus={() => setFocusedId(theme.id)}
              className={cn(
                "overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active
                  ? "border-primary ring-2 ring-primary"
                  : "border-border hover:border-muted-foreground/50",
              )}
            >
              <div className="h-14 p-2" style={{ backgroundColor: theme.swatch.bg }}>
                <div
                  className="flex h-full flex-col justify-between rounded-sm px-1.5 py-1"
                  style={{ backgroundColor: theme.swatch.surface }}
                >
                  <span
                    className="block h-1.5 w-8 rounded-full"
                    style={{ backgroundColor: theme.swatch.primary }}
                  />
                  <span
                    className="block h-1.5 w-5 rounded-full"
                    style={{ backgroundColor: theme.swatch.accent }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
                <span className="truncate text-xs text-foreground">{theme.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ThemePicker() {
  const { activeThemeId, setColorTheme } = useColorTheme();
  return (
    <div className="space-y-3">
      <ThemeRow
        heading="Dark"
        themes={COLOR_THEMES.filter((t) => t.mode === "dark")}
        activeThemeId={activeThemeId}
        onSelect={setColorTheme}
      />
      <ThemeRow
        heading="Light"
        themes={COLOR_THEMES.filter((t) => t.mode === "light")}
        activeThemeId={activeThemeId}
        onSelect={setColorTheme}
      />
    </div>
  );
}
