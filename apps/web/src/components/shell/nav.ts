"use client";

import {
  BookOpen,
  Building2,
  CircleUserRound,
  Compass,
  Share2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { DestinationId, NavUser } from "@scoutable/shared/lib/app-nav";
import { useAuth } from "@/components/auth-context";
import { useShell } from "./shell-context";

export const DESTINATION_ICON: Record<DestinationId, LucideIcon> = {
  playlists: BookOpen,
  "shared-playlists": Share2,
  highlights: Sparkles,
  "get-started": Compass,
  club: Building2,
  admin: ShieldCheck,
  profile: CircleUserRound,
};

/** The navigation's view of the signed-in user; null until the profile and spaces have loaded. */
export function useNavUser(): NavUser | null {
  const { user, profile: loadedProfile, profileLoading, myOrgs, activeOrgIsPersonal, activeOrgRole, isPlayerOnly } =
    useAuth();
  const { profile } = useShell();
  if (!user || profileLoading) return null;
  return {
    isPlayerOnly,
    hasSpace: myOrgs.length > 0,
    activeOrgIsPersonal,
    activeOrgRole,
    isPlatformAdmin: !!(profile?.isPlatformAdmin || loadedProfile?.isPlatformAdmin),
  };
}
