import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
      ? (options.find((o) => selected.has(o.value))?.label ?? placeholder)
      : `${selected.size} selected`;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 min-w-[130px] items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted/50 ${
          selected.size > 0 ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-full rounded-md border border-border bg-popover shadow-md">
          {selected.size > 0 && (
            <button
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-b border-border"
              onClick={() => onChange(new Set())}
            >
              Clear all
            </button>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => toggle(o.value)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
