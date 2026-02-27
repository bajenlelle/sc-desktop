import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchRow } from "@/components/match-row";
import { listMatches, listFolders } from "@/lib/matches-db";
import { listPlaylists } from "@/lib/playlists-db";
import type { StoredMatch, Playlist, PlaylistFolder } from "@/types/match";

function PlaylistCard({ playlist, folder }: { playlist: Playlist; folder?: PlaylistFolder }) {
  return (
    <Link
      to="/playlists"
      state={{ restore: { playlistId: playlist.id } }}
      className="group block rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md hover:border-border/80"
    >
      <p className="truncate font-display text-sm font-bold tracking-wide text-foreground">
        {playlist.name}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {playlist.clips.length} clip{playlist.clips.length !== 1 ? "s" : ""}
      </p>
      {folder && (
        <p className="mt-1 text-xs text-muted-foreground/60">{folder.name}</p>
      )}
    </Link>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [loading, setLoading] = useState(true);

  function goNewPlaylist() {
    navigate("/playlists", { state: { createNew: true } });
  }

  useEffect(() => {
    Promise.all([
      listMatches().catch(() => [] as StoredMatch[]),
      listPlaylists().catch(() => [] as Playlist[]),
      listFolders().catch(() => [] as PlaylistFolder[]),
    ]).then(([ms, ps, fs]) => {
      setMatches(ms);
      setPlaylists(ps);
      setFolders(fs);
      setLoading(false);
    });
  }, []);

  const recentMatches = matches.slice(0, 3);
  const recentPlaylists = playlists.slice(0, 3);

  const noGames = !loading && matches.length === 0;
  const noPlaylists = !loading && playlists.length === 0;

  // Both empty — single unified empty state
  if (!loading && noGames && noPlaylists) {
    return (
      <div className="p-6">
        <div className="space-y-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm font-medium text-foreground">Import a game to get started</p>
            <div className="mt-3 flex flex-col items-center gap-0.5 text-sm text-muted-foreground">
              <span>Import a game</span>
              <span className="text-muted-foreground/40">↓</span>
              <span>Browse clips</span>
              <span className="text-muted-foreground/40">↓</span>
              <span>Build a playlist for scouting or analysis</span>
            </div>
            <Link to="/upload" className="mt-6">
              <Button>Import game</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="space-y-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>

        {/* Playlists */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Playlists
              {!loading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · {playlists.length}
                </span>
              )}
            </h2>
            <Button variant="outline" size="sm" className="gap-2" onClick={goNewPlaylist}>
              <Plus className="h-4 w-4" />
              New playlist
            </Button>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : noPlaylists ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-sm font-medium text-foreground">No playlists yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a playlist to start organizing clips for scouting or analysis.
              </p>
              <Button className="mt-4" onClick={goNewPlaylist}>New playlist</Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {recentPlaylists.map((playlist) => {
                const folder = folders.find((f) => f.id === playlist.folderId);
                return (
                  <PlaylistCard key={playlist.id} playlist={playlist} folder={folder} />
                );
              })}
            </div>
          )}
        </div>

        {/* Recent imports */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent imports</h2>
            <Link to="/matches">
              <Button variant="ghost" size="sm" className="text-primary">
                View all
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : noGames ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-sm font-medium text-foreground">No games yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Import a game to start building playlists.
              </p>
              <Link to="/upload" className="mt-4">
                <Button>Import game</Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
              {recentMatches.map((match) => (
                <MatchRow key={match.id} match={match} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
