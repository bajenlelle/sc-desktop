/**
 * The signed-out screens' frame (the web's components/auth/auth-frame.tsx):
 * a narrow column on the page's background under the app's mark, the way a
 * Mac app asks you to sign in. No card around it: the page is the surface.
 * Fields sit in one rounded box with hairlines between them.
 */
import { Children, cloneElement, forwardRef, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Text } from "@/components/ui/Text";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";
import { cn } from "@/lib/cn";

/** The app's mark: the S on its tile, inverted in dark mode, the cyan dot always. */
export function LogoMark({ size = 56 }: { size?: number }) {
  const { resolvedMode } = useAppTheme();
  const dark = resolvedMode === "dark";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.23,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(0,0,0,0.08)",
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 1500 1500">
        <Rect width="1500" height="1500" fill={dark ? "#f1f5f9" : "#161b24"} />
        <G transform="translate(367.939206, 1052.359797)">
          <Path
            fill={dark ? "#161b24" : "#f1f5f9"}
            d="M 388.9375 -675.3125 C 477.300781 -675.3125 552.125 -658.007812 613.40625 -623.40625 C 674.6875 -588.8125 705.328125 -535.25 705.328125 -462.71875 L 473.96875 -462.71875 C 473.96875 -486.894531 463.128906 -503.984375 441.453125 -513.984375 C 426.441406 -522.328125 407.679688 -526.5 385.171875 -526.5 C 325.148438 -526.5 295.140625 -512.320312 295.140625 -483.96875 C 295.140625 -468.132812 305.5625 -456.878906 326.40625 -450.203125 C 347.25 -443.535156 381.429688 -436.453125 428.953125 -428.953125 C 487.304688 -420.609375 536.078125 -410.804688 575.265625 -399.546875 C 614.453125 -388.296875 648.632812 -368.289062 677.8125 -339.53125 C 706.988281 -310.769531 721.578125 -270.539062 721.578125 -218.84375 C 721.578125 -134.644531 690.101562 -74.617188 627.15625 -38.765625 C 564.21875 -2.921875 481.890625 15 380.171875 15 C 321.816406 15 266.789062 6.875 215.09375 -9.375 C 163.40625 -25.632812 121.300781 -50.851562 88.78125 -85.03125 C 56.269531 -119.21875 40.015625 -162.570312 40.015625 -215.09375 L 271.375 -215.09375 L 271.375 -210.09375 C 272.207031 -181.75 284.085938 -161.945312 307.015625 -150.6875 C 329.941406 -139.4375 354.328125 -133.8125 380.171875 -133.8125 C 449.367188 -133.8125 483.96875 -150.066406 483.96875 -182.578125 C 483.96875 -199.253906 473.128906 -211.34375 451.453125 -218.84375 C 429.773438 -226.351562 394.34375 -234.273438 345.15625 -242.609375 C 285.96875 -252.617188 237.40625 -263.457031 199.46875 -275.125 C 161.53125 -286.800781 128.390625 -306.601562 100.046875 -334.53125 C 71.703125 -362.457031 57.53125 -401.429688 57.53125 -451.453125 C 57.53125 -532.328125 88.164062 -589.851562 149.4375 -624.03125 C 210.71875 -658.21875 290.550781 -675.3125 388.9375 -675.3125 Z"
          />
        </G>
        <Circle cx="1109.441406" cy="1003.144531" r="65.869141" fill="#22d3ee" />
      </Svg>
    </View>
  );
}

/** The column: keyboard-aware, scrollable when the fields don't fit, clear of the notch and home indicator. */
export function AuthShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 16,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <View className="w-full items-stretch" style={{ maxWidth: 340 }}>
          <View className="mb-6 items-center">
            <LogoMark size={48} />
          </View>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <View className="mb-6 items-center">
      <Text variant="title2" accessibilityRole="header" className="text-center">
        {title}
      </Text>
      {description ? (
        typeof description === "string" ? (
          <Text variant="subheadline" className="mt-1 text-center text-muted-foreground">
            {description}
          </Text>
        ) : (
          description
        )
      ) : null}
    </View>
  );
}

type Edge = "only" | "first" | "middle" | "last";

/** Fields stacked in one rounded box with hairlines between them. */
export function FieldGroup({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{ edge?: Edge }>[];
  return (
    <View
      className="overflow-hidden rounded-window bg-card"
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separatorStrong }}
    >
      {rows.map((row, i) => (
        <View key={row.key ?? i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 12, backgroundColor: colors.separator }} />}
          {cloneElement(row, {
            edge: rows.length === 1 ? "only" : i === 0 ? "first" : i === rows.length - 1 ? "last" : "middle",
          })}
        </View>
      ))}
    </View>
  );
}

/** Two fields side by side in a FieldGroup row (first and last name). */
export function FieldRow({ children, edge }: { children: ReactNode; edge?: Edge }) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{ edge?: Edge }>[];
  return (
    <View className="flex-row">
      {items.map((item, i) => (
        <View key={item.key ?? i} className="flex-1 flex-row">
          {i > 0 && <View className="bg-separator" style={{ width: StyleSheet.hairlineWidth }} />}
          <View className="flex-1">{cloneElement(item, { edge })}</View>
        </View>
      ))}
    </View>
  );
}

const RADIUS = 10;

/** A borderless field for a FieldGroup; the focus ring sits inside the box. */
export const GroupField = forwardRef<TextInput, TextInputProps & { edge?: Edge; invalid?: boolean }>(function GroupField(
  { edge = "only", invalid, onFocus, onBlur, style, className, ...props },
  ref,
) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const top = edge === "only" || edge === "first" ? RADIUS - 1 : 0;
  const bottom = edge === "only" || edge === "last" ? RADIUS - 1 : 0;
  return (
    <View>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn("h-11 w-full px-3 text-foreground", className)}
        style={[{ fontSize: 17 }, style]}
        {...props}
      />
      {(focused || invalid) && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            borderWidth: 2,
            borderColor: invalid && !focused ? colors.destructive : colors.primary,
            borderTopLeftRadius: top,
            borderTopRightRadius: top,
            borderBottomLeftRadius: bottom,
            borderBottomRightRadius: bottom,
            opacity: invalid && !focused ? 0.5 : 1,
          }}
        />
      )}
    </View>
  );
});

/**
 * "Check your inbox" and its kind: a quiet icon, the title, one paragraph
 * (with the address in semibold), the way back under it. No tinted circle.
 */
export function AuthStatus({ icon = "mail", title, children }: { icon?: IconName; title: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View className="items-center">
      <View className="mb-3">
        <Icon name={icon} size={28} color={colors.mutedForeground} />
      </View>
      <Text variant="title2" accessibilityRole="header" className="text-center">
        {title}
      </Text>
      <Text variant="subheadline" className="mt-1 text-center text-muted-foreground">
        {children}
      </Text>
    </View>
  );
}

/** An inline error under a form: announced, never a box. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text variant="footnote" accessibilityRole="alert" accessibilityLiveRegion="polite" className="px-1 text-destructive">
      {message}
    </Text>
  );
}

export function AuthDivider() {
  return (
    <View className="my-5 flex-row items-center gap-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="flex-1 bg-separator" style={{ height: StyleSheet.hairlineWidth }} />
      <Text variant="footnote" className="text-muted-foreground">
        or
      </Text>
      <View className="flex-1 bg-separator" style={{ height: StyleSheet.hairlineWidth }} />
    </View>
  );
}

/** "New to Scoutable? Create an account": a line with its link at the end. */
export function AuthFootnote({ children }: { children: ReactNode }) {
  return <View className="mt-6 flex-row flex-wrap items-center justify-center gap-1">{children}</View>;
}

export function GoogleLogo({ size = 17 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

export function AppleLogo({ size = 17, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </Svg>
  );
}
