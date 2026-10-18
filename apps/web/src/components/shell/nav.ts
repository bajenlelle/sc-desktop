"use client";

import {
  BookOpen,
  Building2,
  CircleUserRound,
  Clapperboard,
  Compass,
  Share2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { DestinationId, NavUser } from "@scoutable/shared/lib/app-nav";
import { useAuth } from "@/components/auth-context";
import { useMyCloudGames } from "@/lib/game-videos";
import { useShell } from "./shell-context";

export const DESTINATION_ICON: Record<DestinationId, LucideIcon> = {
  playlists: BookOpen,
  "shared-playlists": Share2,
  games: Clapperboard,
  highlights: Sparkles,
  "get-started": Compass,
  club: Building2,
  admin: ShieldCheck,
  profile: CircleUserRound,
};

/** The navigation's view of the signed-in user; null until the profile and spaces have loaded. */
export function useNavUser(): NavUser | null {
  const { user, profile: loadedProfile, profileLoading, myOrgs, activeOrgId, activeOrgIsPersonal, activeOrgRole, isPlayerOnly } =
    useAuth();
  const { profile } = useShell();
  // Games shows once the user has a copy in the cloud: in the active space,
  // or anywhere for a player-only user, whose navigation spans their clubs.
  const { games } = useMyCloudGames({ orgId: isPlayerOnly ? null : activeOrgId, enabled: !!user && !profileLoading });
  if (!user || profileLoading) return null;
  return {
    isPlayerOnly,
    hasSpace: myOrgs.length > 0,
    activeOrgIsPersonal,
    activeOrgRole,
    isPlatformAdmin: !!(profile?.isPlatformAdmin || loadedProfile?.isPlatformAdmin),
    hasCloudGames: (games?.length ?? 0) > 0,
  };
}
