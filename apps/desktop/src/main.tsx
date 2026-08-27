import "./lib/sentry"; // must be first so init precedes all other module code
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// Prevent WKWebView from navigating to dropped files when no drop zone is active.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
