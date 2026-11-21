import { keySentence, keysEmptyLine, type TeamKey, type TeamKeys } from "@scoutable/shared/lib/team-keys";
import { videoKeyLine } from "@scoutable/shared/lib/team-copy";
import { keyStatOf, type TeamVideo } from "@scoutable/shared/lib/team-video";
import { GroupHeader } from "@/components/ui/group";
import { WatchLink } from "./watch-link";

/** What the keys' lines from the coach's games need: the counts, and what Watch does. */
export interface KeysVideo {
  video: TeamVideo;
  onWatch: (key: TeamKey) => void;
}

/** A key's line from the coach's games, in secondary text, with Watch unless its count is 0. None for a key no kind of play answers. */
function VideoLine({ k, v }: { k: TeamKey; v: KeysVideo }) {
  const stat = keyStatOf(k.end, k.metric);
  if (!stat) return null;
  const c = v.video.stats[stat.side][stat.stat];
  const line = videoKeyLine(stat.stat, stat.side, c, v.video.games);
  return (
    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-subheadline text-muted-foreground nums">
      <span>{line}</span>
      {c.count > 0 && <WatchLink onClick={() => v.onWatch(k)} label={`Watch: ${line.replace(/^In your (\d+ )?games?: /, "")}`} />}
    </span>
  );
}

function Side({ title, keys, where, video }: { title: string; keys: TeamKey[]; where: string | null; video: KeysVideo | null }) {
  return (
    <div className="rounded-window bg-card px-4 py-3 ring-1 ring-separator">
      <h3 className="pb-1.5 text-subheadline text-muted-foreground">{title}</h3>
      {keys.length > 0 ? (
        <ul className="space-y-1.5 text-body text-foreground">
          {keys.map((k) => (
            <li key={`${k.end}-${k.metric}`}>
              <span className="block">{keySentence(k, where)}</span>
              {video && <VideoLine k={k} v={video} />}
            </li>
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
export function TeamKeysSection({ keys, where, video = null }: { keys: TeamKeys; where: string | null; video?: KeysVideo | null }) {
  const empty = keysEmptyLine(keys);
  return (
    <section aria-label="What stands out">
      <GroupHeader title="What stands out" />
      {empty ? (
        <p className="rounded-window bg-card px-4 py-3 text-body text-muted-foreground ring-1 ring-separator">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Side title="With the ball" keys={keys.withBall} where={where} video={video} />
          <Side title="Without the ball" keys={keys.withoutBall} where={where} video={video} />
        </div>
      )}
    </section>
  );
}
