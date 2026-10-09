"use client";

import { useState } from "react";
import { Check, Users } from "lucide-react";
import { initials } from "@scoutable/shared/lib/playlist-feed";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GroupedList } from "@/components/ui/group";
import { SearchField } from "@/components/ui/search-field";
import { pressable } from "@/lib/pressable";
import { cn } from "@/lib/utils";

export interface ShareTeam {
  id: string;
  name: string;
}

export interface ShareMember {
  id: string;
  fullName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

/** Search earns its place once the members stop fitting in the list. */
const SEARCH_THRESHOLD = 8;

/** A person's picture, or their initials while there is none. */
export function PersonAvatar({ name, url, className }: { name?: string | null; url?: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-6", className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary/15 text-caption font-semibold text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function ToggleRow({
  checked,
  onToggle,
  leading,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  leading: React.ReactNode;
  label: string;
}) {
  return (
    <div
      {...pressable(onToggle, { role: "checkbox", checked })}
      className="flex min-h-9 w-full cursor-default items-center gap-2.5 px-3 py-1.5 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection pointer-coarse:min-h-11"
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Check
        aria-hidden
        className={cn(
          "size-4 shrink-0 stroke-[2.5] text-primary transition-[opacity,transform] duration-150",
          checked ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </div>
  );
}

/**
 * Who a playlist is shared with: teams first, then individual members, each
 * a row that toggles with a check, as in the desktop app's Share dialog.
 */
export function ShareRecipients({
  teams,
  members,
  teamIds,
  userIds,
  onToggleTeam,
  onToggleUser,
  emptyMembers = "No team members to share with.",
}: {
  teams: ShareTeam[];
  members: ShareMember[];
  teamIds: Set<string>;
  userIds: Set<string>;
  onToggleTeam: (id: string) => void;
  onToggleUser: (id: string) => void;
  emptyMembers?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shownMembers = q
    ? members.filter((m) => `${m.fullName ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q))
    : members;

  return (
    <div className="flex flex-col gap-4">
      {teams.length > 0 && (
        <section>
          <h3 className="mb-1.5 px-1 text-subheadline font-medium text-muted-foreground">Teams</h3>
          <GroupedList>
            {teams.map((team) => (
              <ToggleRow
                key={team.id}
                checked={teamIds.has(team.id)}
                onToggle={() => onToggleTeam(team.id)}
                leading={<Users className="size-4 shrink-0 text-muted-foreground" />}
                label={team.name}
              />
            ))}
          </GroupedList>
        </section>
      )}

      <section>
        <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
          <h3 className="text-subheadline font-medium text-muted-foreground">Members</h3>
          {userIds.size > 0 && (
            <span className="text-subheadline text-muted-foreground nums">{userIds.size} selected</span>
          )}
        </div>
        {members.length === 0 ? (
          <p className="px-1 text-callout text-muted-foreground">{emptyMembers}</p>
        ) : (
          <>
            {members.length > SEARCH_THRESHOLD && (
              <SearchField
                className="mb-2"
                placeholder="Search members"
                aria-label="Search members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <GroupedList className="max-h-56 overflow-y-auto">
              {shownMembers.length === 0 ? (
                <p className="px-3 py-2.5 text-callout text-muted-foreground">No one matches “{query}”.</p>
              ) : (
                shownMembers.map((m) => (
                  <ToggleRow
                    key={m.id}
                    checked={userIds.has(m.id)}
                    onToggle={() => onToggleUser(m.id)}
                    leading={<PersonAvatar name={m.fullName ?? m.email} url={m.avatarUrl} />}
                    label={m.fullName ?? m.email ?? "Unknown"}
                  />
                ))
              )}
            </GroupedList>
          </>
        )}
      </section>
    </div>
  );
}
