import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MatchCard } from "@/components/match-card";
import { listMatches } from "@/lib/matches-db";
import type { StoredMatch } from "@/types/match";

export function MatchesPage() {
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMatches()
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your Scoutable Sessions — ready to clip, analyze, and review.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            >
              <div className="h-2 w-full animate-pulse bg-slate-200 dark:bg-slate-700" />
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-2">
                <div className="h-8 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No sessions yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Create your first Scoutable Session to get started.
          </p>
          <Link to="/upload" className="mt-4">
            <Button className="bg-indigo-600 hover:bg-indigo-700">Create your first Scoutable Session</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              onDelete={() => setMatches((ms) => ms.filter((m) => m.id !== match.id))}
            />
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
