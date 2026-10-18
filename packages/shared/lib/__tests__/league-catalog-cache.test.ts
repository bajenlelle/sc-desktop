import { describe, expect, it } from "vitest";
import {
  GENIUS_CACHE_KEY,
  PROFIXIO_CACHE_KEY,
  readLeagueCache,
  writeLeagueCache,
  type StorageLike,
} from "../league-catalog-cache";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const served = [
  {
    id: "sbl-herr",
    name: "SBL Herr",
    country: "SE",
    gender: "men",
    seasons: [{ id: "2026-27", label: "2026/27", competitionId: 48974 }],
  },
];

describe("readLeagueCache", () => {
  it("returns the picker shape for a cached catalogue, with the Genius stages attached", () => {
    const storage = memoryStorage({ [GENIUS_CACHE_KEY]: JSON.stringify({ fetchedAt: 1, leagues: served }) });
    const leagues = readLeagueCache(storage, GENIUS_CACHE_KEY);
    expect(leagues).toHaveLength(1);
    expect(leagues![0].id).toBe("sbl-herr");
    expect(leagues![0].seasons[0].competitionId).toBe(48974);
    expect(leagues![0].seasons[0].stages.map((s) => s.id)).toEqual(["regular", "playoff"]);
  });

  it("treats a missing, malformed or unreadable cache as absent", () => {
    expect(readLeagueCache(memoryStorage(), GENIUS_CACHE_KEY)).toBeNull();
    expect(readLeagueCache(memoryStorage({ [GENIUS_CACHE_KEY]: "{not json" }), GENIUS_CACHE_KEY)).toBeNull();
    expect(readLeagueCache(memoryStorage({ [GENIUS_CACHE_KEY]: JSON.stringify({ leagues: [] }) }), GENIUS_CACHE_KEY)).toBeNull();
    expect(readLeagueCache(memoryStorage({ [GENIUS_CACHE_KEY]: JSON.stringify({ leagues: [{ id: "x" }] }) }), GENIUS_CACHE_KEY)).toBeNull();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(readLeagueCache(throwing, GENIUS_CACHE_KEY)).toBeNull();
    expect(readLeagueCache(null, GENIUS_CACHE_KEY)).toBeNull();
  });
});

describe("writeLeagueCache", () => {
  it("writes the served payload with a timestamp, under the key the desktop has always used", () => {
    const storage = memoryStorage();
    writeLeagueCache(storage, GENIUS_CACHE_KEY, served, 1700000000000);
    expect(GENIUS_CACHE_KEY).toBe("scoutable_league_catalog");
    expect(PROFIXIO_CACHE_KEY).toBe("scoutable_league_catalog_profixio_v2");
    expect(JSON.parse(storage.data.get(GENIUS_CACHE_KEY)!)).toEqual({ fetchedAt: 1700000000000, leagues: served });
    expect(readLeagueCache(storage, GENIUS_CACHE_KEY)![0].name).toBe("SBL Herr");
  });

  it("swallows a full or blocked store and a missing one", () => {
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeLeagueCache(full, GENIUS_CACHE_KEY, served)).not.toThrow();
    expect(() => writeLeagueCache(null, GENIUS_CACHE_KEY, served)).not.toThrow();
  });
});
