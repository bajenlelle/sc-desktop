import { describe, expect, it } from "vitest";
import { describeUserAgent } from "../device-info";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (Version/17.4 Safari/605.1.15)",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  chromeMacTauri:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("describeUserAgent", () => {
  it("labels desktop browsers as Browser on OS", () => {
    expect(describeUserAgent(UA.chromeWin)).toEqual({
      platform: "Windows",
      deviceName: "Chrome on Windows",
    });
    expect(describeUserAgent(UA.safariMac)).toEqual({
      platform: "macOS",
      deviceName: "Safari on macOS",
    });
    expect(describeUserAgent(UA.firefoxLinux)).toEqual({
      platform: "Linux",
      deviceName: "Firefox on Linux",
    });
  });

  it("does not misread Edge as Chrome (compat tokens)", () => {
    expect(describeUserAgent(UA.edgeWin).deviceName).toBe("Edge on Windows");
  });

  it("detects mobile OSes before their embedded desktop tokens", () => {
    // iOS UAs contain "like Mac OS X"; Android UAs contain "Linux".
    expect(describeUserAgent(UA.safariIphone).platform).toBe("iOS");
    expect(describeUserAgent(UA.chromeAndroid).platform).toBe("Android");
  });

  it("handles the Tauri webview (WebKit UA on macOS)", () => {
    expect(describeUserAgent(UA.chromeMacTauri).platform).toBe("macOS");
  });

  it("degrades gracefully on missing or junk input", () => {
    expect(describeUserAgent(null)).toEqual({ platform: "Unknown", deviceName: "Unknown device" });
    expect(describeUserAgent("")).toEqual({ platform: "Unknown", deviceName: "Unknown device" });
    expect(describeUserAgent("gibberish")).toEqual({
      platform: "Unknown",
      deviceName: "Browser on Unknown",
    });
  });
});
