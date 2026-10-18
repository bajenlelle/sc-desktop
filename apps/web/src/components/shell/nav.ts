"use client";

import {
  BookOpen,
  Building2,
  CircleUserRound,
  Film,
  Home,
  ListVideo,
  Share2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { canImportGames, type DestinationId, type NavUser } from "@scoutable/shared/lib/app-nav";
import { useAuth } from "@/components/auth-context";
import { useMyGameVideos } from "@/lib/game-videos";
import { useShell } from "./shell-context";

export const DESTINATION_ICON: Record<DestinationId, LucideIcon> = {
  home: Home,
  editor: ListVideo,
  playlists: BookOpen,
  "shared-playlists": Share2,
  library: Film,
  highlights: Sparkles,
  club: Building2,
  admin: ShieldCheck,
  profile: CircleUserRound,
};

/** The navigation's view of the signed-in user; null until the profile and spaces have loaded. */
export function useNavUser(): NavUser | null {
  const {
    user,
    profile: loadedProfile,
    profileLoading,
    myOrgs,
    activeOrgId,
    activeOrg,
    activeOrgIsPersonal,
    activeOrgRole,
    isPlayerOnly,
  } = useAuth();
  const { profile } = useShell();
  // Games shows once the user has a game in the cloud, in any state (an
  // upload under way counts): in the active space, or anywhere for a
  // player-only user, whose navigation spans their clubs. It also shows for
  // anyone who may import from the browser, since that is where it starts.
  const { games } = useMyGameVideos({ orgId: isPlayerOnly ? null : activeOrgId, enabled: !!user && !profileLoading });
  if (!user || profileLoading) return null;
  const hasSpace = myOrgs.length > 0;
  return {
    isPlayerOnly,
    hasSpace,
    activeOrgIsPersonal,
    activeOrgRole,
    isPlatformAdmin: !!(profile?.isPlatformAdmin || loadedProfile?.isPlatformAdmin),
    hasCloudGames: (games?.length ?? 0) > 0,
    canImport: canImportGames({
      isPlayerOnly,
      hasSpace,
      activeOrgIsPersonal,
      activeOrgRole,
      activeOrgIsNt: activeOrg?.isNtOrg ?? false,
    }),
  };
}
