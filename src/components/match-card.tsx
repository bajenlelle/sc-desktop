import { Link } from "react-router-dom";
import { Calendar, ArrowRight, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import type { StoredMatch } from "@/types/match";

export function MatchCard({ match, onDelete }: { match: StoredMatch; onDelete?: () => void }) {
  return (
    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
      <Card className="group flex flex-col overflow-hidden gap-0 py-0 transition-shadow hover:shadow-md">
        {/* Team color bar — flush to top, clipped by card's rounded corners */}
        <div className="flex h-2 shrink-0">
          <div className="w-1/2" style={{ backgroundColor: match.homeTeam.color }} />
          <div className="w-1/2" style={{ backgroundColor: match.awayTeam.color }} />
        </div>

        {/* Card body */}
        <CardContent className="flex flex-1 flex-col gap-3 p-5">
          {/* Title + badge */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="min-w-0 truncate font-display text-base font-bold leading-snug tracking-wide text-foreground">
              {match.title}
            </h3>
            <Badge className="shrink-0 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400 dark:hover:bg-emerald-950">
              Imported
            </Badge>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {new Date(match.date).toLocaleDateString("sv-SE", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>

          {/* Teams matchup */}
          <div className="flex items-center gap-2 text-sm">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {match.homeTeam.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: match.homeTeam.color }}
                />
              )}
              <span className="truncate font-display font-semibold tracking-wide text-foreground/80">
                {match.homeTeam.name}
              </span>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">vs</span>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <span className="truncate text-right font-display font-semibold tracking-wide text-foreground/80">
                {match.awayTeam.name}
              </span>
              {match.awayTeam.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: match.awayTeam.color }}
                />
              )}
            </div>
          </div>

          {/* Meta: events / playlists / sync — pushed to bottom of body */}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{match.events.length} events</span>
            {match.syncPoint && (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Synced
              </span>
            )}
          </div>
        </CardContent>

        {/* Footer CTA — separated by a border, always at the bottom */}
        <div className="border-t border-border px-3 py-2 flex items-center gap-1">
          <Link to={`/matches/${match.id}`} className="flex-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-primary hover:bg-primary/10 hover:text-primary"
            >
              Browse Clips
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          {onDelete && (
            <DeleteMatchDialog
              matchId={match.id}
              matchTitle={match.title}
              trigger={
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                  title="Delete game"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              }
              onDeleted={onDelete}
            />
          )}
        </div>
      </Card>
    </motion.div>
  );
}
