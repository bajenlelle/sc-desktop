import { keySentence, keysEmptyLine, type TeamKey, type TeamKeys } from "@scoutable/shared/lib/team-keys";
import { GroupHeader } from "@/components/ui/group";

function Side({ title, keys, where }: { title: string; keys: TeamKey[]; where: string | null }) {
  return (
    <div className="rounded-window bg-card px-4 py-3 ring-1 ring-separator">
      <h3 className="pb-1.5 text-subheadline text-muted-foreground">{title}</h3>
      {keys.length > 0 ? (
        <ul className="space-y-1.5 text-body text-foreground">
          {keys.map((k) => (
            <li key={`${k.end}-${k.metric}`}>{keySentence(k, where)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">Nothing stands out.</p>
      )}
    </div>
  );
}

/**
 * The team's keys at both ends, as sentences: the few things a coach would
 * tell players about this opponent. `where` names the group in a league played
 * in groups.
 */
export function TeamKeysSection({ keys, where }: { keys: TeamKeys; where: string | null }) {
  const empty = keysEmptyLine(keys);
  return (
    <section aria-label="What stands out">
      <GroupHeader title="What stands out" />
      {empty ? (
        <p className="rounded-window bg-card px-4 py-3 text-body text-muted-foreground ring-1 ring-separator">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Side title="With the ball" keys={keys.withBall} where={where} />
          <Side title="Without the ball" keys={keys.withoutBall} where={where} />
        </div>
      )}
    </section>
  );
}
