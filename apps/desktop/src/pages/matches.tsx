import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MatchRow } from "@/components/match-row";
import { listMatches } from "@/lib/matches-db";
import { useAuth } from "@/lib/auth-context";
import type { StoredMatch } from "@/types/match";

export function MatchesPage() {
  const { activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return matches;
    const q = search.toLowerCase();
    return matches.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.homeTeam.name.toLowerCase().includes(q) ||
        m.awayTeam.name.toLowerCase().includes(q)
    );
  }, [matches, search]);

  useEffect(() => {
    if (!canAccess) return;
    setLoading(true);
    const load = () =>
      listMatches(activeOrgId ?? undefined, { ownOnly: true })
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setLoading(false));
    load();
    // The sample game is seeded fire-and-forget on first launch and may land
    // after this page already rendered.
    window.addEventListener("demo-seeded", load);
    return () => window.removeEventListener("demo-seeded", load);
  }, [activeOrgId, canAccess]);

  if (!profileLoading && !canAccess) return null;

  return (
    <div className="p-6">
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse imported games and their clips
          </p>
        </div>
        <Link to="/upload">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Import game
          </Button>
        </Link>
      </div>

      {!loading && matches.length > 0 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search games…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full pl-8"
          />
        </div>
      )}

      {loading ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-8 w-1 animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
                <div className="flex-1" />
                <div className="hidden h-3 w-24 animate-pulse rounded bg-muted/70 sm:block" />
                <div className="hidden h-3 w-20 animate-pulse rounded bg-muted/70 md:block" />
                <div className="h-3 w-12 animate-pulse rounded bg-muted/70" />
              </div>
            ))}
          </div>
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">No games yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Import a game to get started.
          </p>
          <Link to="/upload" className="mt-4">
            <Button>Import game</Button>
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">No games match your search</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different title or team name.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {filtered.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                onDelete={() => setMatches((ms) => ms.filter((m) => m.id !== match.id))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
