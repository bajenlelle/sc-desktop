import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlayerPhotos, isPlayerPhotoKey, playerPhotoSources, playerPhotoUrl } from "../player-photos";
import { photoHash, photoKey, photoUrls, rosterShirt, trimPerson } from "../genius-roster";

const KEY = "players/genius/2034196/c11717f1afeaf08cf4d0ce32405d92e6-S1.jpg";
const BASE = "https://media.scoutable.se/";

describe("player photo keys and URLs", () => {
  it("accepts only keys the roster sync writes", () => {
    expect(isPlayerPhotoKey(KEY)).toBe(true);
    expect(isPlayerPhotoKey(KEY.replace("-S1", "-L1"))).toBe(false);
    expect(isPlayerPhotoKey("players/genius/../x/c11717f1afeaf08cf4d0ce32405d92e6-S1.jpg")).toBe(false);
    expect(isPlayerPhotoKey("https://media.scoutable.se/" + KEY)).toBe(false);
    expect(isPlayerPhotoKey(null)).toBe(false);
  });

  it("builds each size's URL from the S1 key", () => {
    expect(playerPhotoUrl(BASE, KEY)).toBe("https://media.scoutable.se/" + KEY);
    expect(playerPhotoUrl(BASE, KEY, "L1")).toBe("https://media.scoutable.se/players/genius/2034196/c11717f1afeaf08cf4d0ce32405d92e6-L1.jpg");
    expect(playerPhotoUrl("", KEY)).toBeNull();
    expect(playerPhotoUrl(BASE, "nope")).toBeNull();
  });

  it("picks a sharp size for 1x and 2x", () => {
    expect(playerPhotoSources(BASE, KEY, 28)?.srcSet).toBe(
      `${playerPhotoUrl(BASE, KEY, "T1")} 1x, ${playerPhotoUrl(BASE, KEY, "T1")} 2x`,
    );
    const header = playerPhotoSources(BASE, KEY, 56)!;
    expect(header.src).toBe(playerPhotoUrl(BASE, KEY, "T1"));
    expect(header.srcSet).toContain(`${playerPhotoUrl(BASE, KEY, "S1")} 2x`);
    expect(playerPhotoSources(BASE, KEY, 500)?.srcSet).toContain(`${playerPhotoUrl(BASE, KEY, "L1")} 2x`);
  });
});

describe("fetchPlayerPhotos", () => {
  function client(rows: unknown[], error: unknown = null) {
    const calls: string[][] = [];
    const q = {
      select: () => q,
      eq: () => q,
      not: () => q,
      in: (_c: string, ids: string[]) => {
        calls.push(ids);
        return Promise.resolve({ data: rows, error });
      },
    };
    return { supabase: { from: vi.fn(() => q) } as unknown as SupabaseClient, calls };
  }

  it("asks only for numeric ids once each and keeps valid keys", async () => {
    const { supabase, calls } = client([
      { source_person_id: "2034196", photo_key: KEY },
      { source_person_id: "5", photo_key: "bad" },
    ]);
    const out = await fetchPlayerPhotos(supabase, ["2034196", "2034196", "name:Ola", "5"]);
    expect(calls).toEqual([["2034196", "5"]]);
    expect([...out]).toEqual([["2034196", KEY]]);
  });

  it("returns nothing on a failed read", async () => {
    const { supabase } = client([], { message: "boom" });
    expect((await fetchPlayerPhotos(supabase, ["1"])).size).toBe(0);
  });

  it("makes no call without ids", async () => {
    const { supabase, calls } = client([]);
    expect((await fetchPlayerPhotos(supabase, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("genius roster parsing", () => {
  const person = {
    personId: 2034196,
    firstName: "Hossein ",
    familyName: "Abdi",
    dob: "2005-04-02 00:00:00",
    height: 192,
    weight: 0,
    nationality: "Sweden",
    nationalityCode: "SWE",
    defaultShirtNumber: "6",
    defaultPlayingPosition: "",
    twitter: "@x",
    licenseNumber: "L1",
    competition_player: { shirtNumber: "12" },
    images: {
      photo: {
        T1: { url: "https://images.statsengine.playbyplay.api.geniussports.com/c11717f1afeaf08cf4d0ce32405d92e6T1.jpg" },
        S1: { url: "https://images.statsengine.playbyplay.api.geniussports.com/c11717f1afeaf08cf4d0ce32405d92e6S1.jpg" },
        M1: { url: "https://images.statsengine.playbyplay.api.geniussports.com/c11717f1afeaf08cf4d0ce32405d92e6M1.jpg" },
        L1: { url: "https://images.statsengine.playbyplay.api.geniussports.com/c11717f1afeaf08cf4d0ce32405d92e6L1.jpg" },
      },
    },
  };

  it("keeps the profile columns and drops the rest", () => {
    expect(trimPerson(person)).toEqual({
      source: "genius",
      source_person_id: "2034196",
      first_name: "Hossein",
      family_name: "Abdi",
      default_shirt_number: "6",
      playing_position: null,
      dob: "2005-04-02",
      height_cm: 192,
      weight_kg: null,
      nationality: "Sweden",
      nationality_code: "SWE",
    });
    expect(trimPerson({ personId: "x" })).toBeNull();
    expect(trimPerson({ personId: 1, dob: "0000-00-00" })?.dob).toBeNull();
  });

  it("reads the photo URLs, their hash and our key", () => {
    const urls = photoUrls(person);
    expect(Object.keys(urls)).toEqual(["T1", "S1", "M1", "L1"]);
    const hash = photoHash(urls.S1)!;
    expect(hash).toBe("c11717f1afeaf08cf4d0ce32405d92e6");
    expect(photoKey("genius", "2034196", hash, "S1")).toBe(KEY);
    expect(isPlayerPhotoKey(photoKey("genius", "2034196", hash, "S1"))).toBe(true);
    expect(photoUrls({ images: {} })).toEqual({});
    expect(photoHash("https://example.com/whatever.jpg")).toBeNull();
  });

  it("takes the season's shirt number, else the default", () => {
    expect(rosterShirt(person)).toBe("12");
    expect(rosterShirt({ defaultShirtNumber: 4 })).toBe("4");
    expect(rosterShirt({})).toBeNull();
  });
});
