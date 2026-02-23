"use client";

import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const SortableHead = ({
    label,
    field,
    className,
  }: {
    label: string;
    field: SortKey;
    className?: string;
  }) => (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
      onClick={() => toggle(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3 text-slate-400 dark:text-slate-500" />
      </span>
    </TableHead>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80 dark:bg-slate-800/80">
            <TableHead className="w-[200px]">Player</TableHead>
            <TableHead className="text-center">#</TableHead>
            <SortableHead label="Actions" field="totalActions" className="text-center" />
            <SortableHead label="FG" field="shooting" className="text-center" />
            <SortableHead label="3PT" field="shooting" className="text-center" />
            <SortableHead label="FT" field="shooting" className="text-center" />
            <SortableHead label="AST" field="assists" className="text-center" />
            <SortableHead label="REB" field="rebounds" className="text-center" />
            <SortableHead label="STL" field="steals" className="text-center" />
            <SortableHead label="TO" field="turnovers" className="text-center" />
            <SortableHead label="Success %" field="successRate" className="text-center" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => (
            <TableRow
              key={p.playerId}
              className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: teamColor(p.teamId) }}
                  />
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {p.playerName}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-center font-mono text-slate-600 dark:text-slate-400">
                {p.jerseyNumber}
              </TableCell>
              <TableCell className="text-center font-semibold">
                {p.totalActions}
              </TableCell>
              <TableCell className="text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.jumpShots.made}</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {p.jumpShots.made + p.jumpShots.missed}
                </span>
              </TableCell>
              <TableCell className="text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.threePointers.made}</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {p.threePointers.made + p.threePointers.missed}
                </span>
              </TableCell>
              <TableCell className="text-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400">{p.freeThrows.made}</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {p.freeThrows.made + p.freeThrows.missed}
                </span>
              </TableCell>
              <TableCell className="text-center">{p.assists}</TableCell>
              <TableCell className="text-center">{p.rebounds}</TableCell>
              <TableCell className="text-center">{p.steals}</TableCell>
              <TableCell className="text-center">{p.turnovers}</TableCell>
              <TableCell className="text-center">
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
