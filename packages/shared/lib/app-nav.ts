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
 * - Platform admins also get Admin.
 * - Tabs add Profile, which the sidebar keeps in its account menu.
 */
import type { OrgMembership } from '../types/org';

export type DestinationId =
  | 'playlists'
  | 'shared-playlists'
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
}

const PROFILE: Destination = { id: 'profile', href: '/profile', label: 'Profile' };

export function sidebarDestinations(user: NavUser): Destination[] {
  const admin: Destination[] = user.isPlatformAdmin ? [{ id: 'admin', href: '/admin', label: 'Admin' }] : [];
  if (user.isPlayerOnly) {
    return [
      { id: 'playlists', href: '/my-playlists', label: 'My playlists' },
      { id: 'highlights', href: '/my-highlights', label: 'My highlights' },
      ...admin,
    ];
  }
  if (!user.hasSpace) return admin;
  if (user.activeOrgIsPersonal) {
    return [{ id: 'get-started', href: '/get-started', label: 'Get started' }, ...admin];
  }
  const staff = user.activeOrgRole === 'coach' || user.activeOrgRole === 'admin';
  return [
    staff
      ? { id: 'shared-playlists', href: '/my-playlists', label: 'Shared playlists' }
      : { id: 'playlists', href: '/my-playlists', label: 'My playlists' },
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
