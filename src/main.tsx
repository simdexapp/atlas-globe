import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root")!;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.classList.add("hide");
      setTimeout(() => splash.remove(), 360);
    }
  });
});

// Capture the PWA install prompt so the Cmd+K "Install Atlas Globe as
// a PWA" command can fire it later. Browsers fire this once per
// session when the manifest + service worker check passes.
window.addEventListener("beforeinstallprompt", (e: any) => {
  e.preventDefault();
  (window as any).__atlasInstallPrompt = e;
});
