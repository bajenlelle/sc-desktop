"use client";

import { useCallback, useState } from "react";

/**
 * A dialog's open flag with the data it shows. Closing keeps the data, so
 * the dialog leaves with the title and text it had instead of blanking
 * during its exit animation; the next `show` replaces it.
 */
export function useDialogState<T>(): { data: T | null; open: boolean; show: (data: T) => void; close: () => void } {
  const [state, setState] = useState<{ data: T | null; open: boolean }>({ data: null, open: false });
  const show = useCallback((data: T) => setState({ data, open: true }), []);
  const close = useCallback(() => setState((s) => (s.open ? { ...s, open: false } : s)), []);
  return { data: state.data, open: state.open, show, close };
}
