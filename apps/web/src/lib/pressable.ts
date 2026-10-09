import type * as React from "react";

/**
 * Props that make a div behave like a button: focusable, activated by a
 * click, Return or Space.
 *
 * For clickable rows whose text must truncate. WebKit lays a <button>'s
 * children out inside an anonymous box of its own that can't shrink below
 * its content, so a long title in a button row runs on under the trailing
 * controls instead of ending in an ellipsis; a div shrinks as flex items
 * should. Plain buttons (icons, short labels) stay <button>s.
 */
export function pressable(
  onPress: () => void,
  opts: {
    disabled?: boolean;
    role?: "button" | "checkbox";
    checked?: boolean;
    /** False in a player's list, where Space belongs to play/pause and Return plays the row. */
    space?: boolean;
  } = {},
) {
  const { disabled = false, role = "button", checked, space = true } = opts;
  return {
    role,
    tabIndex: disabled ? -1 : 0,
    "aria-disabled": disabled || undefined,
    "aria-checked": role === "checkbox" ? !!checked : undefined,
    onClick: disabled ? undefined : onPress,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (disabled || e.target !== e.currentTarget) return;
      if (e.key === "Enter" || (space && e.key === " ")) {
        e.preventDefault();
        onPress();
      }
    },
  };
}
