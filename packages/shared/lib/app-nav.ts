/**
 * Where the web app's navigation goes, per user: the sidebar's rows on wide
 * screens and the tab bar's tabs on narrow ones. Pure, so the rules can be
 * tested for every kind of user; icons and links stay in the app.
 *
 * The web mirrors the desktop's structure since milestone 3 of the cloud
 * game videos: Home, Playlists (the user's own, with the editor), Shared
 * playlists (the ones a club's staff share), Library (every game of the
 * space with its video), then the web-only Club and Admin.
 *
 * - Player-only users navigate by content: their playlists and their
 *   highlights, whichever space is active, plus the Library once they have a
 *   game in the cloud.
 * - A player in a club space who coaches elsewhere gets the playlists shared
 *   with them, and the Library once they have a game in the cloud.
 * - Club staff (coach or admin) and anyone in their personal space get the
 *   desktop's order: Home, Playlists, Shared playlists (club spaces only),
 *   Library, Club (staff), Admin (platform admins).
 * - Tabs hold at most five: Club and Admin are dropped first (the Profile
 *   page lists them instead, see overflowDestinations), and Profile is
 *   always the last tab.
 */
import type { OrgMembership } from '../types/org';

export type DestinationId =
  | 'home'
  /** The user's own playlists and the editor. */
  | 'editor'
  /** The playlists shared with the user (players' "My playlists"). */
  | 'playlists'
  | 'shared-playlists'
  | 'library'
  | 'highlights'
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

const HOME: Destination = { id: 'home', href: '/home', label: 'Home' };
const EDITOR: Destination = { id: 'editor', href: '/playlists', label: 'Playlists' };
const MY_PLAYLISTS: Destination = { id: 'playlists', href: '/my-playlists', label: 'My playlists' };
const SHARED_PLAYLISTS: Destination = { id: 'shared-playlists', href: '/my-playlists', label: 'Shared playlists' };
const LIBRARY: Destination = { id: 'library', href: '/library', label: 'Library' };
const HIGHLIGHTS: Destination = { id: 'highlights', href: '/my-highlights', label: 'My highlights' };
const CLUB: Destination = { id: 'club', href: '/organization', label: 'Club' };
const ADMIN: Destination = { id: 'admin', href: '/admin', label: 'Admin' };
const PROFILE: Destination = { id: 'profile', href: '/profile', label: 'Profile' };

/** Whether the user builds playlists on the web: club staff, or anyone in their personal space. */
export function isEditorUser(user: NavUser): boolean {
  if (user.isPlayerOnly || !user.hasSpace) return false;
  return user.activeOrgIsPersonal || user.activeOrgRole === 'coach' || user.activeOrgRole === 'admin';
}

export function sidebarDestinations(user: NavUser): Destination[] {
  const admin: Destination[] = user.isPlatformAdmin ? [ADMIN] : [];
  if (user.isPlayerOnly) {
    return [MY_PLAYLISTS, ...(user.hasCloudGames ? [LIBRARY] : []), HIGHLIGHTS, ...admin];
  }
  if (!user.hasSpace) return admin;
  if (!isEditorUser(user)) {
    // A player in a club space: the playlists shared with them, and the Library when they have a game.
    return [MY_PLAYLISTS, ...(user.hasCloudGames ? [LIBRARY] : []), ...admin];
  }
  return [
    HOME,
    EDITOR,
    ...(user.activeOrgIsPersonal ? [] : [SHARED_PLAYLISTS]),
    LIBRARY,
    ...(user.activeOrgIsPersonal ? [] : [CLUB]),
    ...admin,
  ];
}

/** The most tabs the bar holds, Profile included. */
export const MAX_TABS = 5;

/** The order in which destinations leave the tab bar when there are too many. */
const DROP_ORDER: readonly DestinationId[] = ['admin', 'club'];

/** The tab bar: the sidebar's destinations, then Profile, at most MAX_TABS; Club and Admin leave first. */
export function tabDestinations(user: NavUser): Destination[] {
  const tabs = sidebarDestinations(user);
  const dropped = new Set(overflowDestinations(user).map((d) => d.id));
  return [...tabs.filter((d) => !dropped.has(d.id)), PROFILE];
}

/**
 * The sidebar destinations the tab bar has no room for, in sidebar order,
 * so the Profile page can list them.
 */
export function overflowDestinations(user: NavUser): Destination[] {
  const tabs = sidebarDestinations(user);
  let over = tabs.length + 1 - MAX_TABS;
  if (over <= 0) return [];
  const dropped = new Set<DestinationId>();
  for (const id of DROP_ORDER) {
    if (over <= 0) break;
    if (tabs.some((d) => d.id === id)) {
      dropped.add(id);
      over -= 1;
    }
  }
  return tabs.filter((d) => dropped.has(d.id));
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
