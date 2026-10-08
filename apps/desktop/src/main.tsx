import "./lib/sentry"; // must be first so init precedes all other module code
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyPlatformAttribute } from "./lib/platform";
// Prevent WKWebView from navigating to dropped files when no drop zone is active.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// Before the first paint: the transparent window and title-bar inset are
// macOS-only and gated on this attribute in index.css.
applyPlatformAttribute();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
