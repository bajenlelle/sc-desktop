/**
 * Local-first store for stat sessions: every action goes through the shared
 * reducer, every state change is written to AsyncStorage (one record per
 * session), and the cloud is updated explicitly (Upload / Publish) or on
 * foreground when something is pending. A crash mid-game loses nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import {
  createStatSession,
  initialState,
  reduceStatSession,
  type StatAction,
  type StatSessionState,
} from "@scoutable/shared/lib/stat-session";
import type { StatEventPrivate, StatSession } from "@scoutable/shared/types/stat-session";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { describeSyncError, publishSession, unpublishSession, uploadSession } from "./sync";

export interface LocalSession {
  state: StatSessionState;
  privateRows: StatEventPrivate[];
  /** Local changes not yet uploaded. */
  pendingUpload: boolean;
  lastUploadError: string | null;
  updatedAt: number;
}

export type NewSessionInput = Omit<
  Parameters<typeof createStatSession>[0],
  "id" | "createdBy" | "status" | "finalizedAt" | "revision" | "eventCount"
>;

interface SessionsContextValue {
  loading: boolean;
  sessions: LocalSession[];
  get: (id: string) => LocalSession | undefined;
  create: (input: NewSessionInput) => Promise<string>;
  dispatch: (id: string, action: StatAction, extra?: { rawUtterance?: string; confidence?: number | null }) => void;
  upload: (id: string) => Promise<boolean>;
  publish: (id: string) => Promise<boolean>;
  reopen: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /** Last roster typed for a team name, so the next game starts filled in. */
  rememberRoster: (teamName: string, roster: StatSession["homeRoster"]) => Promise<void>;
  recallRoster: (teamName: string) => Promise<StatSession["homeRoster"] | null>;
}

const Ctx = createContext<SessionsContextValue | null>(null);

const indexKey = (userId: string) => `stats:index:${userId}`;
const sessionKey = (id: string) => `stats:session:${id}`;
const rosterKey = (team: string) => `stats:roster:${team.trim().toLowerCase()}`;

export function SessionsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState<Map<string, LocalSession>>(new Map());
  const mapRef = useRef(map);
  mapRef.current = map;
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load everything for this user once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(indexKey(userId));
        const ids: string[] = raw ? JSON.parse(raw) : [];
        const pairs = await AsyncStorage.multiGet(ids.map(sessionKey));
        const next = new Map<string, LocalSession>();
        for (const [, v] of pairs) {
          if (!v) continue;
          try {
            const parsed = JSON.parse(v) as LocalSession;
            next.set(parsed.state.session.id, parsed);
          } catch {
            // A corrupt record is skipped, never fatal.
          }
        }
        if (!cancelled) setMap(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = useCallback(
    (local: LocalSession) => {
      const id = local.state.session.id;
      const existing = writeTimers.current.get(id);
      if (existing) clearTimeout(existing);
      writeTimers.current.set(
        id,
        setTimeout(() => {
          AsyncStorage.setItem(sessionKey(id), JSON.stringify(local)).catch((e) => console.warn("[stats] persist", e));
          writeTimers.current.delete(id);
        }, 150),
      );
    },
    [],
  );

  const persistIndex = useCallback(
    (ids: string[]) => AsyncStorage.setItem(indexKey(userId), JSON.stringify(ids)).catch(() => {}),
    [userId],
  );

  const update = useCallback(
    (id: string, fn: (prev: LocalSession) => LocalSession) => {
      setMap((prev) => {
        const cur = prev.get(id);
        if (!cur) return prev;
        const nextLocal = fn(cur);
        const next = new Map(prev);
        next.set(id, nextLocal);
        persist(nextLocal);
        return next;
      });
    },
    [persist],
  );

  const create = useCallback(
    async (input: NewSessionInput) => {
      const session = createStatSession({ ...input, id: randomUUID(), createdBy: userId });
      const local: LocalSession = {
        state: initialState(session),
        privateRows: [],
        pendingUpload: true,
        lastUploadError: null,
        updatedAt: Date.now(),
      };
      const next = new Map(mapRef.current);
      next.set(session.id, local);
      setMap(next);
      await AsyncStorage.setItem(sessionKey(session.id), JSON.stringify(local));
      await persistIndex([...next.keys()]);
      trackEvent("stat_session_created", {
        tracking_mode: session.trackingMode,
        roster_size: session.ourSide === 1 ? session.homeRoster.length : session.awayRoster.length,
        linked: !!session.sourceGameId,
      });
      return session.id;
    },
    [userId, persistIndex],
  );

  const dispatch = useCallback<SessionsContextValue["dispatch"]>(
    (id, action, extra) => {
      update(id, (prev) => {
        const before = prev.state.nextSeq;
        const state = reduceStatSession(prev.state, action);
        let privateRows = prev.privateRows;
        if (extra?.rawUtterance !== undefined) {
          // Every row this action appended gets the transcript (an assist and
          // its shot share one utterance).
          const added = state.events.filter((e) => e.seq >= before);
          privateRows = [
            ...privateRows,
            ...added.map((e) => ({
              sessionId: e.sessionId,
              seq: e.seq,
              rawUtterance: extra.rawUtterance ?? "",
              confidence: extra.confidence ?? null,
            })),
          ];
        }
        return { ...prev, state, privateRows, pendingUpload: true, updatedAt: Date.now() };
      });
    },
    [update],
  );

  const upload = useCallback(
    async (id: string) => {
      const local = mapRef.current.get(id);
      if (!local) return false;
      try {
        await uploadSession(supabase, local.state.session, local.state.events, local.privateRows);
        update(id, (p) => ({ ...p, pendingUpload: false, lastUploadError: null }));
        trackEvent("stat_session_uploaded", { event_count: local.state.events.length });
        return true;
      } catch (e) {
        const msg = describeSyncError(e);
        update(id, (p) => ({ ...p, lastUploadError: msg }));
        trackEvent("stat_session_upload_failed", { error: msg.slice(0, 120) });
        return false;
      }
    },
    [update],
  );

  const publish = useCallback(
    async (id: string) => {
      const local = mapRef.current.get(id);
      if (!local) return false;
      try {
        const r = await publishSession(supabase, local.state.session, local.state.events, local.privateRows);
        update(id, (p) => ({
          ...p,
          pendingUpload: false,
          lastUploadError: null,
          state: {
            ...p.state,
            session: { ...p.state.session, status: "final", revision: r.revision, eventCount: r.eventCount, finalizedAt: new Date().toISOString() },
          },
        }));
        trackEvent("stat_session_published", { event_count: r.eventCount, linked: !!local.state.session.sourceGameId });
        return true;
      } catch (e) {
        update(id, (p) => ({ ...p, lastUploadError: describeSyncError(e) }));
        return false;
      }
    },
    [update],
  );

  const reopen = useCallback(
    async (id: string) => {
      try {
        const r = await unpublishSession(supabase, id);
        update(id, (p) => ({
          ...p,
          state: { ...p.state, session: { ...p.state.session, status: "live", revision: r.revision, finalizedAt: null } },
        }));
        return true;
      } catch (e) {
        update(id, (p) => ({ ...p, lastUploadError: describeSyncError(e) }));
        return false;
      }
    },
    [update],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = new Map(mapRef.current);
      next.delete(id);
      setMap(next);
      await AsyncStorage.removeItem(sessionKey(id));
      await persistIndex([...next.keys()]);
    },
    [persistIndex],
  );

  // Retry pending uploads when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      for (const [id, local] of mapRef.current) {
        if (local.pendingUpload && local.state.events.length > 0) void upload(id);
      }
    });
    return () => sub.remove();
  }, [upload]);

  const value = useMemo<SessionsContextValue>(
    () => ({
      loading,
      sessions: [...map.values()].sort((a, b) => b.state.session.gameDate.localeCompare(a.state.session.gameDate) || b.updatedAt - a.updatedAt),
      get: (id) => map.get(id),
      create,
      dispatch,
      upload,
      publish,
      reopen,
      remove,
      rememberRoster: (team, roster) => AsyncStorage.setItem(rosterKey(team), JSON.stringify(roster)).catch(() => {}),
      recallRoster: async (team) => {
        const raw = await AsyncStorage.getItem(rosterKey(team)).catch(() => null);
        return raw ? (JSON.parse(raw) as StatSession["homeRoster"]) : null;
      },
    }),
    [loading, map, create, dispatch, upload, publish, reopen, remove],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSessions outside SessionsProvider");
  return v;
}
