import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Prevent WKWebView from navigating to dropped files.
// Tauri's onDragDropEvent fires via its own IPC channel and is unaffected.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
