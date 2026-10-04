/**
 * Link a session to an official Profixio game so it surfaces as "Stats
 * available" on that game in the desktop import. Walks league → category →
 * schedule through the same `profixio` edge function the desktop uses (the
 * function returns upcoming games too), and remembers "my team" so the next
 * game is one tap.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProfixioCategories, getProfixioLeagues, getProfixioSchedule } from "@scoutable/shared/lib/profixio-client";
import type { ProfixioCatalogLeague, ProfixioCategory, ProfixioScheduleRow } from "@scoutable/shared/lib/profixio-wire";
import { profixioSourceGameId } from "@scoutable/shared/lib/profixio";
import { listStatSessionsForGames } from "@scoutable/shared/lib/stat-sessions-db";
import { supabase } from "@/lib/supabase";
import { useThemeColors } from "@/lib/theme-context";

export interface GameLink {
  sourceGameId: string;
  leagueId: string;
  stageId: string;
  homeName: string;
  awayName: string;
  /** YYYY-MM-DD from the kickoff. */
  gameDate: string;
  kickoff: string;
}

interface MyTeam {
  leagueId: string;
  leagueName: string;
  profixioLeagueId: number;
  categoryId: number;
  categoryName: string;
  teamName: string;
}

const MY_TEAM_KEY = "stats:myTeam";

export async function loadMyTeam(): Promise<MyTeam | null> {
  const raw = await AsyncStorage.getItem(MY_TEAM_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as MyTeam) : null;
}
export function saveMyTeam(t: MyTeam) {
  return AsyncStorage.setItem(MY_TEAM_KEY, JSON.stringify(t)).catch(() => {});
}

type Step = "league" | "category" | "game";

function fmtKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function GamePicker({
  onPick,
  onCancel,
}: {
  onPick: (link: GameLink, myTeamName: string | null) => void;
  onCancel: () => void;
}) {
  const colors = useThemeColors();
  const [step, setStep] = useState<Step>("league");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [leagues, setLeagues] = useState<ProfixioCatalogLeague[]>([]);
  const [league, setLeague] = useState<ProfixioCatalogLeague | null>(null);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [categories, setCategories] = useState<ProfixioCategory[]>([]);
  const [category, setCategory] = useState<ProfixioCategory | null>(null);
  const [rows, setRows] = useState<ProfixioScheduleRow[]>([]);
  const [keepers, setKeepers] = useState<Map<string, number>>(new Map());
  const [myTeam, setMyTeam] = useState<MyTeam | null>(null);

  // First open: jump straight to the remembered team's schedule.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [mt, res] = await Promise.all([loadMyTeam(), getProfixioLeagues(supabase)]);
      if (!active) return;
      if (!res.ok) {
        setError("Couldn't load the leagues. Check your connection, or add the game without a league.");
        setLoading(false);
        return;
      }
      setLeagues(res.data.leagues);
      if (mt) {
        setMyTeam(mt);
        const lg = res.data.leagues.find((l) => l.id === mt.leagueId);
        if (lg) {
          setLeague(lg);
          setCategory({ categoryId: mt.categoryId, name: mt.categoryName, matchCount: null });
          await loadSchedule(mt.profixioLeagueId, mt.categoryId);
          setQuery(mt.teamName);
          setStep("game");
          setLoading(false);
          return;
        }
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCategories(lg: ProfixioCatalogLeague, idx: number) {
    const season = lg.seasons[idx];
    if (!season) return;
    setLoading(true);
    setError(null);
    const res = await getProfixioCategories(supabase, season.profixio.leagueId);
    setLoading(false);
    if (!res.ok) return setError("Couldn't load the categories.");
    setCategories(res.data.categories.filter((c) => c.matchCount !== 0));
    setStep("category");
  }

  async function loadSchedule(profixioLeagueId: number, categoryId: number) {
    setLoading(true);
    setError(null);
    const res = await getProfixioSchedule(supabase, profixioLeagueId, categoryId);
    if (!res.ok) {
      setLoading(false);
      return setError("Couldn't load the schedule.");
    }
    const now = Date.now();
    const sorted = [...res.data.rows].sort(
      (a, b) => Math.abs(Date.parse(a.kickoff) - now) - Math.abs(Date.parse(b.kickoff) - now),
    );
    setRows(sorted);
    setLoading(false);
    // Who else is keeping stats here — a bonus, never blocking.
    void listStatSessionsForGames(supabase, sorted.slice(0, 60).map((r) => profixioSourceGameId(r.matchId)))
      .then((m) => setKeepers(new Map([...m.entries()].map(([k, v]) => [k, v.length]))))
      .catch(() => {});
  }

  const q = query.trim().toLowerCase();
  const filteredLeagues = useMemo(
    () => (q ? leagues.filter((l) => `${l.name} ${l.region ?? ""}`.toLowerCase().includes(q)) : leagues).slice(0, 80),
    [leagues, q],
  );
  const filteredRows = useMemo(
    () => (q ? rows.filter((r) => `${r.homeName} ${r.awayName}`.toLowerCase().includes(q)) : rows).slice(0, 40),
    [rows, q],
  );

  function pick(row: ProfixioScheduleRow, ours: "home" | "away" | null) {
    if (!league || !category) return;
    const season = league.seasons[seasonIdx];
    const link: GameLink = {
      sourceGameId: profixioSourceGameId(row.matchId),
      leagueId: league.id,
      stageId: String(category.categoryId),
      homeName: row.homeName,
      awayName: row.awayName,
      gameDate: row.kickoff.slice(0, 10),
      kickoff: row.kickoff,
    };
    const teamName = ours === "home" ? row.homeName : ours === "away" ? row.awayName : null;
    if (teamName && season) {
      void saveMyTeam({
        leagueId: league.id,
        leagueName: league.name,
        profixioLeagueId: season.profixio.leagueId,
        categoryId: category.categoryId,
        categoryName: category.name,
        teamName,
      });
    }
    onPick(link, teamName);
  }

  const header = (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="flex-1 font-sans-bold text-base text-foreground">
        {step === "league" ? "Which league?" : step === "category" ? `${league?.name} — which group?` : `${league?.name} · ${category?.name}`}
      </Text>
      <Pressable className="shrink-0 pt-0.5" onPress={step === "league" ? onCancel : () => { setStep(step === "game" ? "category" : "league"); setQuery(""); }}>
        <Text className="text-sm text-muted-foreground">{step === "league" ? "Not listed" : "‹ Back"}</Text>
      </Pressable>
    </View>
  );

  return (
    <View className="gap-3 rounded-xl bg-card p-3">
      {header}
      {(step === "league" || step === "game") && (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={step === "league" ? "Search league or district…" : "Search team…"}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          style={{ color: colors.foreground }}
          className="rounded-md border border-input bg-background px-3 py-2 text-base"
        />
      )}
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      {loading && <ActivityIndicator color={colors.primary} />}

      {!loading && step === "league" && (
        <ScrollView className="max-h-72" nestedScrollEnabled>
          {filteredLeagues.map((l) => (
            <Pressable key={l.id} onPress={() => { setLeague(l); setSeasonIdx(0); setQuery(""); void loadCategories(l, 0); }} className="border-b border-border py-2">
              <Text className="text-sm text-foreground">{l.name}</Text>
              <Text className="text-xs text-muted-foreground">{l.region ?? ""} · {l.seasons[0]?.label ?? ""}</Text>
            </Pressable>
          ))}
          {filteredLeagues.length === 0 && <Text className="py-2 text-sm text-muted-foreground">No league matches that.</Text>}
        </ScrollView>
      )}

      {!loading && step === "category" && league && (
        <View className="gap-2">
          {league.seasons.length > 1 && (
            <View className="flex-row flex-wrap gap-2">
              {league.seasons.map((s, i) => (
                <Pressable key={s.id} onPress={() => { setSeasonIdx(i); void loadCategories(league, i); }} className={`rounded-full px-3 py-1 ${i === seasonIdx ? "bg-primary" : "bg-muted"}`}>
                  <Text className={`text-xs ${i === seasonIdx ? "text-primary-foreground" : "text-foreground"}`}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <ScrollView className="max-h-72" nestedScrollEnabled>
            {categories.map((c) => (
              <Pressable
                key={c.categoryId}
                onPress={() => {
                  setCategory(c);
                  setQuery(myTeam?.teamName ?? "");
                  setStep("game");
                  const season = league.seasons[seasonIdx];
                  if (season) void loadSchedule(season.profixio.leagueId, c.categoryId);
                }}
                className="border-b border-border py-2"
              >
                <Text className="text-sm text-foreground">{c.name}</Text>
                {c.matchCount != null && <Text className="text-xs text-muted-foreground">{c.matchCount} games</Text>}
              </Pressable>
            ))}
            {categories.length === 0 && <Text className="py-2 text-sm text-muted-foreground">No groups with games in this season. Try another season or league.</Text>}
          </ScrollView>
        </View>
      )}

      {!loading && step === "game" && (
        <ScrollView className="max-h-80" nestedScrollEnabled>
          {filteredRows.map((r) => {
            const n = keepers.get(profixioSourceGameId(r.matchId)) ?? 0;
            return (
              <View key={r.matchId} className="border-b border-border py-2">
                <Text className="text-xs text-muted-foreground">
                  {fmtKickoff(r.kickoff)}{r.venue ? ` · ${r.venue}` : ""}{n > 0 ? ` · ${n} keeper${n > 1 ? "s" : ""} already` : ""}
                </Text>
                <Text className="text-sm text-foreground">
                  {r.homeName} – {r.awayName}
                  {r.hasResult && r.homeScore != null ? `  (${r.homeScore}–${r.awayScore})` : ""}
                </Text>
                <View className="mt-1 flex-row gap-2">
                  <Pressable onPress={() => pick(r, "home")} className="rounded-md bg-muted px-2 py-1">
                    <Text className="text-xs text-foreground">We are {r.homeName}</Text>
                  </Pressable>
                  <Pressable onPress={() => pick(r, "away")} className="rounded-md bg-muted px-2 py-1">
                    <Text className="text-xs text-foreground">We are {r.awayName}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {filteredRows.length === 0 && <Text className="py-2 text-sm text-muted-foreground">No game matches that.</Text>}
        </ScrollView>
      )}
    </View>
  );
}
