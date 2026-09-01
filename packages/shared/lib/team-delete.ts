/**
 * Copy for the "Delete team?" confirmation.
 *
 * Deleting a team is irreversible and its blast radius is not visible in the
 * UI: playlist_shares.team_id cascades, so every playlist shared with the team
 * stops being shared and those players lose the film. The counts come from the
 * team_delete_impact RPC (a definer function — the client cannot count shares
 * for a team it does not belong to).
 *
 * Ordered so the consequence an admin is least likely to expect comes first.
 */

export interface TeamDeleteImpact {
  memberCount: number;
  sharedPlaylistCount: number;
  inviteLinkCount: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One paragraph for the dialog body. Only non-zero effects are mentioned, so
 * deleting an empty team doesn't claim it removes anything — but the
 * irreversibility line is always present, because that is always true.
 */
export function teamDeleteWarning(impact: TeamDeleteImpact): string {
  const { memberCount, sharedPlaylistCount, inviteLinkCount } = impact;
  const parts: string[] = [];

  if (sharedPlaylistCount > 0) {
    parts.push(
      `Players lose access to ${plural(sharedPlaylistCount, 'playlist')} shared with this team.`,
    );
  }
  if (memberCount > 0) {
    parts.push(`This removes ${plural(memberCount, 'member')} from the team.`);
  }
  if (inviteLinkCount > 0) {
    parts.push(
      `${plural(inviteLinkCount, 'invite link')} ${inviteLinkCount === 1 ? 'stops' : 'stop'} working.`,
    );
  }
  parts.push("This can't be undone.");

  return parts.join(' ');
}
