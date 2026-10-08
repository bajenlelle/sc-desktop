import "./lib/sentry"; // must be first so init precedes all other module code
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyPlatformAttribute } from "./lib/platform";
// Prevent WKWebView from navigating to dropped files when no drop zone is active.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// WKWebView still treats Backspace outside a text field as "go back": Delete
// with nothing selected used to throw the coach out of the editor. Listening
// on window, after every document-level handler, keeps the key for those that
// use it (the editor removes selected clips) and only stops the navigation.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);
window.addEventListener("keydown", (e) => {
  if (e.key !== "Backspace" || e.defaultPrevented) return;
  const el = e.target as HTMLElement | null;
  const typing =
    !!el &&
    (el.isContentEditable ||
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)));
  if (!typing) e.preventDefault();
});

// Before the first paint: the transparent window and title-bar inset are
// macOS-only and gated on this attribute in index.css.
applyPlatformAttribute();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
