import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, BarChart3, Users, Trophy } from "lucide-react";
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
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950">
          <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Welcome back. Here&apos;s an overview of your basketball analytics.
          </p>
        </div>
        <Link to="/upload">
          <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4" />
            Import New Match
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <QuickStat
          label="Total Matches"
          value={loading ? "—" : String(matches.length)}
          icon={Trophy}
        />
        <QuickStat
          label="Synced"
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Recent Matches
          </h2>
          <Link to="/matches">
            <Button variant="ghost" size="sm" className="text-indigo-600 dark:text-indigo-400">
              View all
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : recentMatches.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No matches yet</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Import your first match to get started.
            </p>
            <Link to="/upload" className="mt-4">
              <Button className="bg-indigo-600 hover:bg-indigo-700">Import your first match</Button>
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
