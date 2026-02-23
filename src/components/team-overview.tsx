import {
  Target,
  TrendingUp,
  Users,
  ShieldAlert,
  Timer,
  Crosshair,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { TeamStats } from "@/types/match";

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string; color?: string }>;
  color: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {value}
              {suffix && (
                <span className="text-lg font-semibold text-slate-400 dark:text-slate-500">
                  {suffix}
                </span>
              )}
            </p>
          </div>
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}15` }}
          >
            <Icon className="h-4 w-4" color={color} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBar({
  label,
  home,
  away,
  homeColor,
  awayColor,
}: {
  label: string;
  home: number;
  away: number;
  homeColor: string;
  awayColor: string;
}) {
  const total = home + away || 1;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700 dark:text-slate-300">{home}</span>
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-300">{away}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="transition-all"
          style={{
            width: `${(home / total) * 100}%`,
            backgroundColor: homeColor,
          }}
        />
        <div
          className="transition-all"
          style={{
            width: `${(away / total) * 100}%`,
            backgroundColor: awayColor,
          }}
        />
      </div>
    </div>
  );
}

export function TeamOverview({
  home,
  away,
  homeColor,
  awayColor,
}: {
  home: TeamStats;
  away: TeamStats;
  homeColor: string;
  awayColor: string;
}) {
  return (
    <div className="space-y-8">
      {/* Team headers */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: homeColor }}
          />
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {home.teamName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {away.teamName}
          </span>
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: awayColor }}
          />
        </div>
      </div>

      {/* Comparison bars */}
      <Card>
        <CardContent className="space-y-5 p-6">
          <ProgressBar
            label="Possession"
            home={home.possessionPercentage}
            away={away.possessionPercentage}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <ProgressBar
            label="Total Shots"
            home={home.totalShots}
            away={away.totalShots}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <ProgressBar
            label="Assists"
            home={home.totalAssists}
            away={away.totalAssists}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <ProgressBar
            label="Rebounds"
            home={home.totalRebounds}
            away={away.totalRebounds}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <ProgressBar
            label="Steals"
            home={home.totalSteals}
            away={away.totalSteals}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          <ProgressBar
            label="Turnovers"
            home={home.totalTurnovers}
            away={away.totalTurnovers}
            homeColor={homeColor}
            awayColor={awayColor}
          />
        </CardContent>
      </Card>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Home FG%"
          value={home.shootingPercentage}
          suffix="%"
          icon={Target}
          color={homeColor}
        />
        <StatCard
          label="Away FG%"
          value={away.shootingPercentage}
          suffix="%"
          icon={Target}
          color={awayColor}
        />
        <StatCard
          label="Home 3PT%"
          value={home.threePointPercentage}
          suffix="%"
          icon={Crosshair}
          color={homeColor}
        />
        <StatCard
          label="Away 3PT%"
          value={away.threePointPercentage}
          suffix="%"
          icon={Crosshair}
          color={awayColor}
        />
        <StatCard
          label="Home FT%"
          value={home.freeThrowPercentage}
          suffix="%"
          icon={TrendingUp}
          color={homeColor}
        />
        <StatCard
          label="Away FT%"
          value={away.freeThrowPercentage}
          suffix="%"
          icon={TrendingUp}
          color={awayColor}
        />
      </div>
    </div>
  );
}
