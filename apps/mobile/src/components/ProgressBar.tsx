import { View } from "react-native";

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <View className={`h-1.5 overflow-hidden rounded-full bg-muted ${className}`}>
      <View
        className="h-full rounded-full bg-primary"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}
