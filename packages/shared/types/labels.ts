// =============================================================================
// Clip Labels — per-(user, org) vocabulary with per-clip assignments
// =============================================================================

export type LabelColor =
  | "slate"
  | "red"
  | "orange"
  | "amber"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "fuchsia";

export const LABEL_COLORS: LabelColor[] = [
  "slate",
  "red",
  "orange",
  "amber",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
];

export interface Label {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  color: LabelColor;
  createdAt: string;
}

export interface ClipLabelAssignment {
  userId: string;
  orgId: string;
  matchId: string;
  eventId: number;
  labelId: string;
  assignedAt: string;
}

/** Composite clip identity used throughout the app. */
export interface ClipKey {
  matchId: string;
  eventId: number;
}
