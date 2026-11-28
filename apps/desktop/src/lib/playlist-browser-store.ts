/**
 * The playlist browser's shown/hidden state, the Playlists page's second
 * sidebar (lib/side-column-store.ts), and a report's Sections panel, the
 * report page's. Both answer to the toolbar's second toggle and ⌘B.
 */
import { createSideColumnStore } from "@/lib/side-column-store";

const browser = createSideColumnStore("scoutable_playlist_browser_collapsed");

export const useBrowserCollapsed = browser.useCollapsed;
/** The Playlists page, with its browser, is on screen. */
export const useBrowserPresent = browser.usePresent;
/** Called by the page that holds the browser, for as long as it is mounted. */
export const useRegisterBrowser = () => browser.useRegister();
export const setBrowserCollapsed = browser.setCollapsed;
export const toggleBrowser = browser.toggle;

/** A report's Sections panel (components/report/report-outline.tsx). */
export const reportSections = createSideColumnStore("scoutable_report_sections_collapsed");
