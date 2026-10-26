/**
 * Where the mobile app lives, and which store a browser belongs to.
 *
 * Players get Scoutable as an app for iPhone and Android; the web sends
 * them there from /get-the-app, which picks the store from the browser's
 * user agent on the server. An iPad with Safari's "desktop site" default
 * reads as a Mac and gets the page with both stores instead.
 */
export const APP_STORE_URL = "https://apps.apple.com/app/id6808941904";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=se.scoutable.app";
export const GET_THE_APP_PATH = "/get-the-app";

export function storeUrlFor(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  if (/iPhone|iPad|iPod/.test(userAgent)) return APP_STORE_URL;
  if (/Android/.test(userAgent)) return PLAY_STORE_URL;
  return null;
}
