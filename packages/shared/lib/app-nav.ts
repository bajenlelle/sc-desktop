/**
 * Where the web app's navigation goes, per user: the sidebar's rows on wide
 * screens and the tab bar's tabs on narrow ones. Pure, so the rules can be
 * tested for every kind of user; icons and links stay in the app.
 *
 * - Player-only users navigate by content: their playlists and their
 *   highlights, whichever space is active.
 * - Everyone else navigates the active space. A club space has its playlists
 *   (staff see them as "Shared playlists", the ones they share) and, for
 *   staff, the club itself; web is where clubs are managed. A personal space
 *   has no playlists to watch on web, so its home is the get-started page.
 * - Anyone with a game in the cloud (uploaded from the desktop or the
 *   browser) gets Games, right after their playlists; a personal space then
 *   has something to watch on web after all. So does anyone who may import a
 *   game from the browser (canImportGames), since Games is where importing
 *   starts.
 * - Platform admins also get Admin.
 * - Tabs add Profile, which the sidebar keeps in its account menu.
 */
import type { OrgMembership } from '../types/org';

export type DestinationId =
  | 'playlists'
  | 'shared-playlists'
  | 'games'
  | 'highlights'
  | 'get-started'
  | 'club'
  | 'admin'
  | 'profile';

export interface Destination {
  id: DestinationId;
  href: string;
  label: string;
}

export interface NavUser {
  /** Only `player` roles in club orgs (see isPlayerOnly in orgs.ts). */
  isPlayerOnly: boolean;
  /** The user belongs to at least one space. */
  hasSpace: boolean;
  activeOrgIsPersonal: boolean;
  activeOrgRole: OrgMembership['role'] | null;
  isPlatformAdmin: boolean;
  /** The user has at least one game in the cloud, in any state (see game-videos-db.ts). */
  hasCloudGames: boolean;
  /** The user may import a league game from the browser in the active space (canImportGames). */
  canImport: boolean;
}

/** What canImportGames decides on: the active space and the user's standing in it. */
export interface ImportUser {
  isPlayerOnly: boolean;
  hasSpace: boolean;
  activeOrgIsPersonal: boolean;
  activeOrgRole: OrgMembership['role'] | null;
  /** National-team spaces import from their own leagues, which the web doesn't offer. */
  activeOrgIsNt: boolean;
}

/**
 * Whether the browser import is offered: staff of a club space (coach or
 * admin) and anyone in their personal space; never a player-only user or a
 * player in a club space, never a national-team space.
 */
export function canImportGames(u: ImportUser): boolean {
  if (u.isPlayerOnly || !u.hasSpace || u.activeOrgIsNt) return false;
  return u.activeOrgIsPersonal || u.activeOrgRole === 'coach' || u.activeOrgRole === 'admin';
}

const PROFILE: Destination = { id: 'profile', href: '/profile', label: 'Profile' };
const GAMES: Destination = { id: 'games', href: '/games', label: 'Games' };

export function sidebarDestinations(user: NavUser): Destination[] {
  const admin: Destination[] = user.isPlatformAdmin ? [{ id: 'admin', href: '/admin', label: 'Admin' }] : [];
  const games: Destination[] = user.hasCloudGames || user.canImport ? [GAMES] : [];
  if (user.isPlayerOnly) {
    return [
      { id: 'playlists', href: '/my-playlists', label: 'My playlists' },
      ...games,
      { id: 'highlights', href: '/my-highlights', label: 'My highlights' },
      ...admin,
    ];
  }
  if (!user.hasSpace) return admin;
  if (user.activeOrgIsPersonal) {
    return [...games, { id: 'get-started', href: '/get-started', label: 'Get started' }, ...admin];
  }
  const staff = user.activeOrgRole === 'coach' || user.activeOrgRole === 'admin';
  return [
    staff
      ? { id: 'shared-playlists', href: '/my-playlists', label: 'Shared playlists' }
      : { id: 'playlists', href: '/my-playlists', label: 'My playlists' },
    ...games,
    ...(staff ? [{ id: 'club', href: '/organization', label: 'Club' } satisfies Destination] : []),
    ...admin,
  ];
}

/** The tab bar: the sidebar's destinations, then Profile. */
export function tabDestinations(user: NavUser): Destination[] {
  return [...sidebarDestinations(user), PROFILE];
}

/**
 * The destination a path belongs to: the one whose href is the path or a
 * parent of it ("/admin/orgs/1" is in Admin; "/my-playlistsx" is in nothing).
 */
export function activeDestination(pathname: string, destinations: Destination[]): DestinationId | null {
  for (const d of destinations) {
    if (pathname === d.href || pathname.startsWith(`${d.href}/`)) return d.id;
  }
  return null;
}
