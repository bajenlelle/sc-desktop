"use client";

import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayerStats } from "@/types/match";
import type { Team } from "@/types/match";

type SortKey = keyof PlayerStats | "shooting";
type SortDir = "asc" | "desc";

export function PlayerStatsTable({
  stats,
  homeTeam,
  awayTeam,
}: {
  stats: PlayerStats[];
  homeTeam: Team;
  awayTeam: Team;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("totalActions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...stats].sort((a, b) => {
    let va: number, vb: number;
    if (sortKey === "shooting") {
      va = a.jumpShots.made + a.threePointers.made;
      vb = b.jumpShots.made + b.threePointers.made;
    } else {
      va = (a[sortKey] as number) ?? 0;
      vb = (b[sortKey] as number) ?? 0;
    }
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const teamColor = (teamId: string) =>
    teamId === homeTeam.id ? homeTeam.color : awayTeam.color;

  function SortableTh({
    label,
    field,
    className,
  }: {
    label: string;
    field: SortKey;
    className?: string;
  }) {
    return (
      <th
        className={cn("cursor-pointer select-none whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted-foreground", className)}
        onClick={() => toggle(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
        </span>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm tabular-nums">
        <thead className="border-b border-border bg-muted/80">
          <tr>
            <th className="w-[200px] px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Player</th>
            <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">#</th>
            <SortableTh label="Actions" field="totalActions" className="text-center" />
            <SortableTh label="FG" field="shooting" className="text-center" />
            <SortableTh label="3PT" field="shooting" className="text-center" />
            <SortableTh label="FT" field="shooting" className="text-center" />
            <SortableTh label="AST" field="assists" className="text-center" />
            <SortableTh label="REB" field="rebounds" className="text-center" />
            <SortableTh label="STL" field="steals" className="text-center" />
            <SortableTh label="TO" field="turnovers" className="text-center" />
            <SortableTh label="Success %" field="successRate" className="text-center" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((p) => (
            <tr
              key={p.playerId}
              className="transition-colors hover:bg-muted"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: teamColor(p.teamId) }}
                  />
                  <span className="font-medium text-foreground">
                    {p.playerName}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-center font-mono text-muted-foreground">
                {p.jerseyNumber}
              </td>
              <td className="px-4 py-2.5 text-center font-semibold">
                {p.totalActions}
              </td>
              <td className="px-4 py-2.5 text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.jumpShots.made}</span>
                <span className="text-border">/</span>
                <span className="text-muted-foreground">
                  {p.jumpShots.made + p.jumpShots.missed}
                </span>
              </td>
              <td className="px-4 py-2.5 text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.threePointers.made}</span>
                <span className="text-border">/</span>
                <span className="text-muted-foreground">
                  {p.threePointers.made + p.threePointers.missed}
                </span>
              </td>
              <td className="px-4 py-2.5 text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.freeThrows.made}</span>
                <span className="text-border">/</span>
                <span className="text-muted-foreground">
                  {p.freeThrows.made + p.freeThrows.missed}
                </span>
              </td>
              <td className="px-4 py-2.5 text-center">{p.assists}</td>
              <td className="px-4 py-2.5 text-center">{p.rebounds}</td>
              <td className="px-4 py-2.5 text-center">{p.steals}</td>
              <td className="px-4 py-2.5 text-center">{p.turnovers}</td>
              <td className="px-4 py-2.5 text-center">
                <span
                  className={cn(
                    "inline-flex min-w-[48px] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold",
                    p.successRate >= 60
                      ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400"
                      : p.successRate >= 40
                        ? "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
                        : "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400"
                  )}
                >
                  {p.successRate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
