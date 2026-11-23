import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One value a field filters by: a player, a shot type, a quarter… */
export interface MenuValue {
  value: string;
  label: string;
  /** Before the label, in its own column: a shirt number. */
  lead?: string | null;
  /** Also found by these ("23" for #23). */
  keywords?: readonly string[];
  /** The heading it is listed under on its field's page (a team, "Quarter", "Moment"). */
  group?: string;
  /** Why it can't be chosen now; it is listed, dimmed, with the reason. */
  disabledReason?: string | null;
}

/** A field of the Filter menu: its page of values and what is chosen in it. */
export interface MenuField {
  id: string;
  name: string;
  icon: LucideIcon;
  values: readonly MenuValue[];
  isOn: (value: string) => boolean;
  toggle: (value: string) => void;
  clear: () => void;
  /** How many of its values are chosen. */
  count: number;
  /** On its row when something is chosen: "Q4", "#13 Larsson", "2". */
  summary?: string;
  /** Under its page's values: the game view's "While on the floor". */
  footer?: React.ReactNode;
}

type Entry =
  | { kind: "header"; key: string; label: string }
  | { kind: "field"; key: string; field: MenuField }
  | { kind: "value"; key: string; field: MenuField; value: MenuValue; tagged: boolean };

const matches = (q: string, v: MenuValue) =>
  v.label.toLowerCase().includes(q) || (!!v.lead && v.lead === q) || !!v.keywords?.some((k) => k.toLowerCase().startsWith(q));

/**
 * The Filter menu, as Linear and Notion keep theirs: first the fields (Player, Shot type, Situation, When,
 * Labels…), each with what is chosen in it; a field opens its page of values, in the same popover. One search
 * field at the top: on the first page it finds values across every field ("#13", "Larsson", "clutch") and a
 * press puts that filter on; on a field's page it narrows that field. A value goes on or off with a press and
 * the menu stays open, so several can be chosen; a checkmark says what is on, and the list behind updates at
 * once. ↑↓ move, Return or → opens a field or toggles a value, ← or Backspace in an empty search goes back,
 * Esc goes back and then closes (the popover's own Esc, PlaysFilterBar).
 */
export function FilterMenu({
  fields,
  page,
  onPage,
  inputRef,
  footer,
}: {
  fields: readonly MenuField[];
  /** The field whose page is open; null for the fields. */
  page: string | null;
  onPage: (page: string | null) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Under the fields: Clear filters. */
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const listId = React.useId();
  const open = page ? (fields.find((f) => f.id === page) ?? null) : null;
  const localInput = React.useRef<HTMLInputElement | null>(null);

  // A new page starts with an empty search, the first row active, and the keyboard in the field.
  React.useEffect(() => {
    setQuery("");
    localInput.current?.focus();
  }, [page]);

  const entries = React.useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    if (open) {
      let group: string | undefined;
      for (const v of open.values) {
        if (q && !matches(q, v)) continue;
        if (v.group && v.group !== group) {
          group = v.group;
          out.push({ kind: "header", key: `h:${group}`, label: group });
        }
        out.push({ kind: "value", key: `v:${open.id}:${v.value}`, field: open, value: v, tagged: false });
      }
      return out;
    }
    if (!q) return fields.map((field) => ({ kind: "field", key: `f:${field.id}`, field }));
    // Searching from the top: the fields whose name matches, then every matching value under its field's name.
    for (const field of fields) if (field.name.toLowerCase().includes(q)) out.push({ kind: "field", key: `f:${field.id}`, field });
    for (const field of fields) {
      const found = field.values.filter((v) => matches(q, v));
      if (found.length === 0) continue;
      out.push({ kind: "header", key: `h:${field.id}`, label: field.name });
      for (const v of found) out.push({ kind: "value", key: `v:${field.id}:${v.value}`, field, value: v, tagged: true });
    }
    return out;
  }, [open, fields, q]);

  const choosable = entries.map((e, i) => (e.kind === "header" ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = React.useState(0);
  React.useEffect(() => setActive(0), [page, q]);
  const activeIndex = choosable[Math.min(active, choosable.length - 1)] ?? -1;
  const optionId = (i: number) => `${listId}-${i}`;
  React.useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const choose = (e: Entry | undefined) => {
    if (!e) return;
    if (e.kind === "field") onPage(e.field.id);
    else if (e.kind === "value" && !e.value.disabledReason) e.field.toggle(e.value.value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(choosable.length - 1, i + step)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(entries[activeIndex]);
    } else if (e.key === "ArrowRight" && entries[activeIndex]?.kind === "field" && e.currentTarget.selectionStart === query.length) {
      e.preventDefault();
      choose(entries[activeIndex]);
    } else if (open && query === "" && (e.key === "Backspace" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onPage(null);
    }
  };

  const setInput = (el: HTMLInputElement | null) => {
    localInput.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  const placeholder = open ? `Search ${open.name.toLowerCase()}` : "Filter by player, situation, label…";

  const renderRow = (i: number) => {
    const e = entries[i];
    if (e.kind === "header") return null;
    const isActive = i === activeIndex;
    const rowClass = cn(
      "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-foreground select-none",
      isActive && "bg-fill-2",
    );
    if (e.kind === "field") {
      const Icon = e.field.icon;
      return (
        <div
          key={e.key}
          id={optionId(i)}
          role="option"
          aria-selected={false}
          aria-label={e.field.count > 0 ? `${e.field.name}, ${e.field.summary ?? e.field.count}` : e.field.name}
          onPointerMove={() => setActive(choosable.indexOf(i))}
          // The keyboard stays in the search, so ↑↓, Return, typing and Backspace keep working after a click.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => choose(e)}
          className={rowClass}
        >
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{e.field.name}</span>
          {e.field.count > 0 && (
            <span className="max-w-28 truncate text-subheadline text-muted-foreground nums">{e.field.summary ?? e.field.count}</span>
          )}
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      );
    }
    const on = e.field.isOn(e.value.value);
    const off = !!e.value.disabledReason;
    return (
      <div
        key={e.key}
        id={optionId(i)}
        role="option"
        aria-label={e.value.lead ? `#${e.value.lead} ${e.value.label}` : e.value.label}
        aria-selected={on}
        aria-disabled={off || undefined}
        title={e.value.disabledReason ?? undefined}
        onPointerMove={() => setActive(choosable.indexOf(i))}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => choose(e)}
        className={cn(rowClass, off && "text-muted-foreground")}
      >
        {/* A number column only where the field has numbers (players), so names line up. */}
        {e.value.lead !== undefined && (
          <span aria-hidden={!e.value.lead} className="w-6 shrink-0 text-right text-subheadline text-muted-foreground nums">
            {e.value.lead ?? ""}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {e.value.label}
          {e.tagged && e.value.group && e.field.id === "players" && (
            <span className="ml-1.5 text-subheadline text-muted-foreground">{e.value.group}</span>
          )}
        </span>
        {off ? (
          <span className="max-w-32 shrink-0 truncate text-caption text-muted-foreground">{e.value.disabledReason}</span>
        ) : (
          <Check aria-hidden className={cn("size-3.5 shrink-0 text-foreground", !on && "invisible")} />
        )}
      </div>
    );
  };
  // The entries as rows under their headings: a heading opens a segment; rows before any heading (the fields)
  // make one without.
  const segments: { key: string; header: string | null; rows: number[] }[] = [];
  entries.forEach((e, i) => {
    if (e.kind === "header") segments.push({ key: e.key, header: e.label, rows: [] });
    else {
      if (segments.length === 0) segments.push({ key: "top", header: null, rows: [] });
      segments[segments.length - 1].rows.push(i);
    }
  });

  return (
    <div className="flex max-h-[min(70vh,30rem)] w-72 flex-col">
      {/* The search, with the way back and the field's Clear on a field's page. */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-separator px-2">
        {open ? (
          <button
            type="button"
            aria-label="Back to all filters"
            title="Back (←)"
            onClick={() => onPage(null)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : (
          <Search aria-hidden className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <input
          ref={setInput}
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search filters"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {open && open.count > 0 && (
          <button
            type="button"
            onClick={open.clear}
            className="shrink-0 rounded px-1.5 py-0.5 text-subheadline text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
          >
            Clear
          </button>
        )}
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label={open ? open.name : "Filters"}
        aria-multiselectable="true"
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
        {entries.length === 0 && <p className="px-3 py-6 text-center text-callout text-muted-foreground">No filters match “{query.trim()}”.</p>}
        {segments.map((seg) =>
          seg.header ? (
            // A heading and its rows, as one named group (a team's players, the quarters, a field's matches).
            <div key={seg.key} role="group" aria-label={seg.header}>
              <div role="presentation" className="px-2 pt-2 pb-1 text-caption font-medium text-muted-foreground">
                {seg.header}
              </div>
              {seg.rows.map(renderRow)}
            </div>
          ) : (
            <React.Fragment key={seg.key}>{seg.rows.map(renderRow)}</React.Fragment>
          ),
        )}
      </div>

      {(open ? open.footer : footer) && <div className="shrink-0 border-t border-separator p-2">{open ? open.footer : footer}</div>}
    </div>
  );
}
