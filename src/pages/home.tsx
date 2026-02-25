import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, BarChart3, Users, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MatchCard } from "@/components/match-card";
import { listMatches } from "@/lib/matches-db";
import type { StoredMatch } from "@/types/match";

function QuickStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function HomePage() {
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMatches()
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, []);

  const recentMatches = matches.slice(0, 3);
  const matchesWithSync = matches.filter((m) => m.syncPoint).length;

  return (
    <div className="p-6 max-w-5xl">
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Home
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back. Here&apos;s what&apos;s in your library.
          </p>
        </div>
        <Link to="/upload">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Game
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <QuickStat
          label="Games"
          value={loading ? "—" : String(matches.length)}
          icon={Film}
        />
        <QuickStat
          label="With video"
          value={loading ? "—" : String(matchesWithSync)}
          icon={BarChart3}
        />
        <QuickStat
          label="Play-by-Play Events"
          value={loading ? "—" : String(matches.reduce((s, m) => s + m.events.length, 0))}
          icon={Users}
        />
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Recent Games
          </h2>
          <Link to="/matches">
            <Button variant="ghost" size="sm" className="text-primary">
              View all
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : recentMatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm font-medium text-foreground">No games yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload your first game to build your library.
            </p>
            <Link to="/upload" className="mt-4">
              <Button>Add Game</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
