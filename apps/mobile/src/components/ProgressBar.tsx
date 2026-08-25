import { View } from "react-native";

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <View className={`h-1.5 overflow-hidden rounded-full bg-muted dark:bg-muted-dark ${className}`}>
      <View
        className="h-full rounded-full bg-primary dark:bg-primary-dark"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}
