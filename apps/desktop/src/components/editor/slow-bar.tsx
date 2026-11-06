/**
 * A slow-motion section's bar under the player, in place of the clip's own
 * row: its speed, its length, moving its start to the playhead, and Remove
 * / Done. The footage keeps playing as usual meanwhile, so the effect shows.
 */
import { Trash2 } from "lucide-react";
import { formatClipTime } from "@scoutable/shared/lib/clip-timing";
import { SLOW_MIN_LENGTH, SLOW_STEP, type SlowRate, type SlowSection } from "@scoutable/shared/lib/clip-timeline";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";

const RATES: { rate: SlowRate; label: string; aria: string }[] = [
  { rate: 0.5, label: "½×", aria: "Half speed" },
  { rate: 0.25, label: "¼×", aria: "Quarter speed" },
];

const seconds = (n: number) => `${Number(n.toFixed(1))} s`;

export function SlowBar({
  section,
  clipStart,
  maxLength,
  onRate,
  onLength,
  onStartHere,
  onRemove,
  onDone,
}: {
  section: SlowSection;
  /** The clip's start in the source video, for the times shown. */
  clipStart: number;
  /** As long as the section may be from its start: to the clip's end or the next section. */
  maxLength: number;
  onRate: (rate: SlowRate) => void;
  onLength: (seconds: number) => void;
  onStartHere: () => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-callout text-muted-foreground">Slow motion</span>
        <div role="radiogroup" aria-label="Speed" className="flex items-center gap-0.5 rounded-lg bg-fill-1 p-0.5">
          {RATES.map(({ rate, label, aria }) => (
            <Button
              key={rate}
              role="radio"
              aria-checked={section.rate === rate}
              aria-label={aria}
              title={aria}
              variant={section.rate === rate ? "default" : "ghost"}
              size="xs"
              onClick={() => onRate(rate)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-callout text-muted-foreground">Length</span>
          <Stepper
            label="Seconds of the clip played slowly"
            value={section.length}
            min={SLOW_MIN_LENGTH}
            max={Math.max(SLOW_MIN_LENGTH, maxLength)}
            step={SLOW_STEP}
            onChange={onLength}
            format={seconds}
          />
        </div>
        <Button variant="ghost" size="xs" onClick={onStartHere} title="Move the start to the playhead">
          Start here
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={onRemove}>
            <Trash2 />
            Remove
          </Button>
          <Button size="xs" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
      <p className="text-caption text-muted-foreground">
        {`From ${formatClipTime(Math.max(0, section.t - clipStart))} for ${seconds(section.length)}, at ${section.rate === 0.5 ? "half" : "quarter"} speed. The sound slows down too.`}
      </p>
    </div>
  );
}
