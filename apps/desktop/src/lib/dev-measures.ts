/**
 * Keep React's development build from filling the web process in `tauri dev`.
 *
 * In development React records a User Timing measure for a component each
 * time it re-renders with changed props (its "Components" performance track)
 * and never clears one. WKWebView keeps every entry for the life of the page,
 * with the changed props attached: a playing video re-renders the editor many
 * times a second, and half an hour of that left 250,000 entries and several
 * hundred MB behind. Once the web process passes WebKit's strict memory line
 * (about 1.5 GB) it purges the frame of every paused video, on each pause, so
 * the player goes black whenever it stops and stays black while scrubbing,
 * until the app is restarted.
 *
 * React's production build records nothing, so released apps never had this.
 * Here each measure is dropped as soon as it has been recorded: whoever asked
 * for it still gets the entry back, and nothing piles up.
 */
export function dropMeasuresAsRecorded(perf: Performance = performance): void {
  const measure = perf.measure.bind(perf);
  perf.measure = (...args: Parameters<Performance["measure"]>) => {
    const entry = measure(...args);
    perf.clearMeasures(args[0]);
    return entry;
  };
}

if (import.meta.env.DEV) dropMeasuresAsRecorded();
