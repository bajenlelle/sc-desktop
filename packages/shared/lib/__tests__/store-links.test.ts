import { describe, expect, it } from "vitest";
import { APP_STORE_URL, PLAY_STORE_URL, storeUrlFor } from "../store-links";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

describe("storeUrlFor", () => {
  it("sends an iPhone or iPad to the App Store", () => {
    expect(storeUrlFor(IPHONE)).toBe(APP_STORE_URL);
    expect(storeUrlFor(IPAD)).toBe(APP_STORE_URL);
  });

  it("sends an Android phone to Google Play", () => {
    expect(storeUrlFor(ANDROID)).toBe(PLAY_STORE_URL);
  });

  it("has no store for a computer, or for no browser at all", () => {
    expect(storeUrlFor(MAC)).toBeNull();
    expect(storeUrlFor(WINDOWS)).toBeNull();
    expect(storeUrlFor(null)).toBeNull();
    expect(storeUrlFor("")).toBeNull();
  });
});
