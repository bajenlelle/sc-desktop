/**
 * Free a <video>'s decoder and buffers once it has left the page for good.
 *
 * A detached element that still has a source stays alive in WKWebView,
 * buffers and all: every player that unmounted without this (each editor
 * open) was still there hours later. Enough of them push the page into
 * memory pressure, and WebKit's relief then purges every paused video, so
 * the visible one goes black on pause and stays black while scrubbing until
 * it plays again.
 *
 * Only call it for an element that is no longer in the document: React's
 * StrictMode re-runs effects on a mounted element, and stripping the source
 * there would blank a live player.
 */
export function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}
