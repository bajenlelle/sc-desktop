/**
 * The order the label picker lists a vocabulary in.
 *
 * A coach who goes through a game labelling plays reaches for the same few
 * labels over and over. So the labels used last are repeated at the top, most
 * recent first, and the one used last is what Enter applies when the picker
 * has only just opened: "the same label again" is two keys.
 *
 * They are copies. The whole vocabulary stays below them in its own
 * (alphabetical) order, so every label is always where it was: an adaptive
 * list that moves or removes items costs more in searching than it saves,
 * while a small, clearly separate area of copies on top of an unchanged list
 * helps (Sears & Shneiderman's split menus, 1994, with at most four items on
 * top; Gajos et al., AVI 2006, on copying rather than moving). It is the
 * shape of a font menu: recently used on top, all fonts below.
 *
 * The picker reads this order once, when it opens, and keeps it while it is
 * open: a row never moves under the pointer.
 */
import type { Label } from "../types/labels";

/** How many recently used labels are repeated at the top. */
export const RECENT_LABELS_SHOWN = 4;
/** How many are remembered: more than are shown, since a device can hold several vocabularies and labels get deleted. */
export const RECENT_LABELS_KEPT = 24;
/** A vocabulary smaller than this is read at a glance: it stays one list, in its own order. */
export const RECENT_GROUP_MIN_LABELS = 7;

/** The remembered ids after `id` was used: it goes first, once. */
export function noteLabelUsed(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_LABELS_KEPT);
}

export interface LabelPickerOrder {
  /** Repeated at the top: the labels used last, most recent first. Empty while searching and for a small vocabulary. */
  recent: Label[];
  /** Every label in the vocabulary's order, the recent ones included; while searching, the matches, best first. */
  all: Label[];
  /** The label Enter applies before anything is moved: the one used last, else the first row. Null for an empty list. */
  first: string | null;
}

/** How well a name answers a search: 0 it starts with it, 1 one of its words does, 2 it holds it somewhere, -1 not at all. */
function matchRank(name: string, query: string): number {
  const lower = name.toLocaleLowerCase();
  if (lower.startsWith(query)) return 0;
  if (lower.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 1;
  return lower.includes(query) ? 2 : -1;
}

/**
 * `labels` in the order the vocabulary is kept in (alphabetical), `recentIds`
 * most recent first (ids that are no longer labels are skipped), `query` what
 * the coach has typed.
 */
export function labelPickerOrder(labels: readonly Label[], recentIds: readonly string[], query: string): LabelPickerOrder {
  const byId = new Map(labels.map((l) => [l.id, l]));
  const used = recentIds.filter((id, i) => byId.has(id) && recentIds.indexOf(id) === i);

  const q = query.trim().toLocaleLowerCase();
  if (q) {
    const recency = new Map(used.map((id, i) => [id, i]));
    const all = labels
      .map((label, at) => ({ label, at, rank: matchRank(label.name, q) }))
      .filter((m) => m.rank >= 0)
      // The best match first; between equal matches the one used last, then the vocabulary's order.
      .sort((a, b) => a.rank - b.rank || (recency.get(a.label.id) ?? Infinity) - (recency.get(b.label.id) ?? Infinity) || a.at - b.at)
      .map((m) => m.label);
    return { recent: [], all, first: all[0]?.id ?? null };
  }

  if (labels.length < RECENT_GROUP_MIN_LABELS) {
    // One list; the label used last is still where Enter starts.
    return { recent: [], all: [...labels], first: used[0] ?? labels[0]?.id ?? null };
  }
  const recent = used.slice(0, RECENT_LABELS_SHOWN).map((id) => byId.get(id)!);
  return { recent, all: [...labels], first: recent[0]?.id ?? labels[0]?.id ?? null };
}
