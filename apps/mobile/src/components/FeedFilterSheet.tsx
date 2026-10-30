import { View } from "react-native";
import { activeFeedFilterCount, type WatchFilter } from "@scoutable/shared/lib/playlist-feed";
import { NO_FEED_FILTERS, type FeedFilters } from "@/components/PlaylistFeed";
import { Button } from "@/components/ui/Button";
import { RadioGroup, type RadioOption } from "@/components/ui/RadioGroup";
import { TextButton } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";

/**
 * The feed's filters in one sheet, opened from the title bar's filter button:
 * Show (with counts), Team and From when there is more than one to pick.
 * Choices apply at once; Done closes, Reset clears them.
 */
export function FeedFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  counts,
  sourceOptions,
  sharerOptions,
}: {
  visible: boolean;
  onClose: () => void;
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  counts: Record<WatchFilter, number>;
  sourceOptions: RadioOption<string>[];
  sharerOptions: RadioOption<string>[];
}) {
  const active = activeFeedFilterCount(filters) > 0;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      scrollable
      trailing={active ? <TextButton label="Reset" size="body" onPress={() => onChange(NO_FEED_FILTERS)} /> : undefined}
    >
      <RadioGroup<WatchFilter>
        title="Show"
        value={filters.watch}
        onSelect={(watch) => onChange({ ...filters, watch })}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "new", label: "New", count: counts.new },
          { value: "progress", label: "In progress", count: counts.progress },
          { value: "watched", label: "Watched", count: counts.watched },
        ]}
      />
      {sourceOptions.length > 1 && (
        <RadioGroup title="Team" value={filters.source} onSelect={(source) => onChange({ ...filters, source })} options={sourceOptions} />
      )}
      {sharerOptions.length > 1 && (
        <RadioGroup title="From" value={filters.sharer} onSelect={(sharer) => onChange({ ...filters, sharer })} options={sharerOptions} />
      )}
      <View className="px-4 pt-5">
        <Button onPress={onClose}>Done</Button>
      </View>
    </Sheet>
  );
}
