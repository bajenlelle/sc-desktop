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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Scoutable Sessions — ready to clip, analyze, and review.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="h-2 w-full animate-pulse bg-muted" />
              <div className="flex flex-1 flex-col gap-3 p-5">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted/70" />
                <div className="h-4 w-full animate-pulse rounded bg-muted/70" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-muted/70" />
              </div>
              <div className="border-t border-border px-3 py-2">
                <div className="h-8 w-full animate-pulse rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">No sessions yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first Scoutable Session to get started.
          </p>
          <Link to="/upload" className="mt-4">
            <Button>Create your first Scoutable Session</Button>
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
