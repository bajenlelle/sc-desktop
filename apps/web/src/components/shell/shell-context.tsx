"use client";

import { createContext, useContext, useMemo } from "react";
import type { UserProfile } from "@scoutable/shared/types/org";
import type { ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { useImportQuota } from "@/lib/use-import-quota";

/**
 * What the shell's parts share: the server-rendered profile (so the account
 * and Admin paint with the first HTML) and the personal space's import
 * quota, fetched once for the sidebar's switcher and the toolbar's alike.
 */
interface ShellState {
  profile: UserProfile | null;
  importQuota: ImportQuota | null;
}

const ShellContext = createContext<ShellState>({ profile: null, importQuota: null });

export function ShellProvider({ profile, children }: { profile: UserProfile | null; children: React.ReactNode }) {
  const importQuota = useImportQuota();
  const value = useMemo(() => ({ profile, importQuota }), [profile, importQuota]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  return useContext(ShellContext);
}
