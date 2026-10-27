import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { getReportDraft, saveReportDraft } from "@/lib/report-drafts-db";
import { emptyHistory, takeRedo, takeUndo, type History } from "@scoutable/shared/lib/playlist-history";
import { emptyDraft, pruneDraft, recordReportEdit, removeSection, restoreStructure, sectionLabel, type ReportDraft, type ReportEdit } from "@scoutable/shared/lib/report-draft";
import type { PlaylistItem } from "@/types/match";

export type DraftStatus = "loading" | "ready" | "saving" | "error";

const SAVE_DELAY_MS = 600;
/** One toast for failed saves, however many there are in a row. */
const SAVE_ERROR_TOAST = "report-draft-save";
/** One toast for the report's edits and their undo: a new one replaces the last. */
const EDIT_TOAST = "report-edit";

interface Held {
  draft: ReportDraft;
  /** No row in the database yet: the first edit writes one. */
  isNew: boolean;
}

// Module scope, not the hook's: the report view unmounts on Back and on "Open
// in playlist", and the drafts outlive it. Coming back shows the last draft at
// once, and a save still running when the view closed is waited for before
// the draft is read again, so a reopen never reads (and then overwrites with)
// the row as it was before that save.
const drafts = new Map<string, Held>();
/** Playlists whose draft has edits not yet written. */
const dirty = new Set<string>();
/** The write running per playlist; the next one waits for it. */
const writing = new Map<string, Promise<SaveOutcome>>();
/** ⌘Z / ⇧⌘Z per playlist: the report's structure (who is in it, in which order, where the clips go). */
const histories = new Map<string, History<ReportEdit>>();

type SaveOutcome = "saved" | "skipped" | { error: unknown };

/** Writes the playlist's draft if it has unsaved edits, after any write already running. Never rejects. */
function writeDraft(id: string, items: readonly PlaylistItem[]): Promise<SaveOutcome> {
  const before = writing.get(id) ?? Promise.resolve<SaveOutcome>("skipped");
  const run = before.then(async (): Promise<SaveOutcome> => {
    const held = drafts.get(id);
    if (!held || !dirty.has(id)) return "skipped";
    dirty.delete(id);
    try {
      await saveReportDraft(id, pruneDraft(held.draft, items));
      const now = drafts.get(id);
      if (now?.isNew) drafts.set(id, { ...now, isNew: false });
      return "saved";
    } catch (error) {
      dirty.add(id);
      return { error };
    }
  });
  writing.set(id, run);
  void run.then(() => {
    if (writing.get(id) === run) writing.delete(id);
  });
  return run;
}

/**
 * A playlist's report draft while the report view is open: shown from memory
 * when this session has it (and read again behind it, in case the database
 * changed, say a game merged into a club), edited optimistically, saved after
 * a pause in the typing, and saved again when the view closes or the
 * playlist changes. A draft that was never edited is never written: opening
 * the view leaves no empty rows behind. A failed save keeps the edits and is
 * retried with the next edit or when the view closes.
 *
 * An edit given a label ("Move 2 clips") can be undone: ⌘Z takes the report's
 * structure back to before it, keeping the words typed since
 * (restoreStructure). Notes and the intro keep their fields' own undo.
 */
export function useReportDraft({ playlistId, items }: { playlistId: string; items: readonly PlaylistItem[] }) {
  const [held, setHeld] = useState<Held | null>(() => drafts.get(playlistId) ?? null);
  const [status, setStatus] = useState<DraftStatus>(() => (drafts.has(playlistId) ? (dirty.has(playlistId) ? "saving" : "ready") : "loading"));
  const [reloads, setReloads] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (id: string) => {
      if (mounted.current) setStatus("saving");
      const outcome = await writeDraft(id, itemsRef.current);
      if (outcome !== "skipped" && typeof outcome === "object") {
        const tooLarge = outcome.error instanceof Error && outcome.error.message === "draft_too_large";
        toast.error(tooLarge ? "This report is too long to save. Shorten a note or remove a player." : "Couldn’t save the report. Your changes stay here and save when you’re back online.", {
          id: SAVE_ERROR_TOAST,
        });
        if (mounted.current) setStatus("error");
        return;
      }
      toast.dismiss(SAVE_ERROR_TOAST);
      if (!mounted.current) return;
      const now = drafts.get(id);
      if (now) setHeld(now);
      setStatus(dirty.has(id) ? "saving" : "ready");
    },
    [],
  );

  /** Writes what is pending now, retrying a save that failed. */
  const flush = useCallback(
    (id: string) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (dirty.has(id)) void save(id);
    },
    [save],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Read the draft (behind the remembered one, if any); flush when leaving.
  useEffect(() => {
    let cancelled = false;
    const cached = drafts.get(playlistId);
    setHeld(cached ?? null);
    if (!cached) setStatus("loading");
    void (async () => {
      // A save still running (the view was just closed) lands before the read.
      await writing.get(playlistId);
      // Unsaved edits here are newer than anything stored: they stay, and save on the next flush.
      if (cancelled || dirty.has(playlistId)) return;
      const start = drafts.get(playlistId);
      let stored: Awaited<ReturnType<typeof getReportDraft>>;
      try {
        stored = await getReportDraft(playlistId);
      } catch {
        if (cancelled) return;
        // With nothing to show, say so; a remembered draft stays on screen.
        if (!drafts.get(playlistId)) setStatus("error");
        return;
      }
      // Edited while the read was in flight: the edits win.
      if (cancelled || drafts.get(playlistId) !== start) return;
      const fresh: Held = stored ? { draft: stored.draft, isNew: false } : (start ?? { draft: emptyDraft(), isNew: true });
      drafts.set(playlistId, fresh);
      setHeld(fresh);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
      flush(playlistId);
    };
  }, [playlistId, flush, reloads]);

  /**
   * Applies a pure change to the draft and schedules the save. With a label
   * the change goes on the undo stack. True when the draft changed.
   */
  const apply = useCallback(
    (change: (draft: ReportDraft) => ReportDraft, label?: string): boolean => {
      const current = drafts.get(playlistId);
      if (!current) return false;
      const next = change(current.draft);
      if (next === current.draft) return false;
      if (label) histories.set(playlistId, recordReportEdit(histories.get(playlistId) ?? emptyHistory(), { label, before: current.draft, after: next }));
      const updated: Held = { ...current, draft: next };
      drafts.set(playlistId, updated);
      dirty.add(playlistId);
      setHeld(updated);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save(playlistId);
      }, SAVE_DELAY_MS);
      return true;
    },
    [playlistId, save],
  );

  /** ⌘Z / ⇧⌘Z: the report's structure goes back to (or forward to) an edit's. False when there is nothing to step to. */
  const stepHistory = useCallback(
    (direction: "undo" | "redo"): boolean => {
      const step = (direction === "undo" ? takeUndo : takeRedo)(histories.get(playlistId) ?? emptyHistory<ReportEdit>());
      if (!step) return false;
      histories.set(playlistId, step.history);
      apply((d) => restoreStructure(direction === "undo" ? step.edit.before : step.edit.after, d));
      toast(`${direction === "undo" ? "Undo" : "Redo"}: ${step.edit.label}`, { id: EDIT_TOAST, duration: 2000 });
      return true;
    },
    [playlistId, apply],
  );

  /** The last edit on the stack, to undo from a toast only while it is still the last. */
  const latestEdit = () => {
    const past = histories.get(playlistId)?.past ?? [];
    return past[past.length - 1] ?? null;
  };

  /** Removes a section with an Undo in the toast, the same as ⌘Z while the removal is the last edit. */
  const removeSectionWithUndo = useCallback(
    (id: string, clips: number) => {
      const section = drafts.get(playlistId)?.draft.sections.find((s) => s.id === id);
      if (!section) return;
      const name = sectionLabel(section.player);
      const hadNote = section.note.trim().length > 0;
      if (!apply((d) => removeSection(d, id), `Remove ${name}`)) return;
      const edit = latestEdit();
      trackEvent("scouting_report_section_removed", { had_note: hadNote, clips, undone: false });
      toast(`${name} removed`, {
        id: EDIT_TOAST,
        action: {
          label: "Undo",
          onClick: () => {
            if (latestEdit() !== edit || !stepHistory("undo")) return;
            trackEvent("scouting_report_section_removed", { had_note: hadNote, clips, undone: true });
          },
        },
      });
    },
    [playlistId, apply, stepHistory],
  );

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  return { draft: held?.draft ?? null, isNew: held?.isNew ?? false, status, apply, stepHistory, removeSectionWithUndo, reload };
}
