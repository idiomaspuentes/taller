import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyMockSessionFromUrl } from "./devMockSession";
import { startManifest } from "./manifest";
import { applyServerFromUrl } from "./serverChoice";
import { installTypingMode } from "./typingMode";
import "./index.css";
import { applyTextSize } from "./textSize";
import { installDoor43Gate } from "./dcs/door43Gate";
import { loadSession } from "./dcs/auth";
import { installSessionExpiryGuard, notifySessionExpired } from "./dcs/sessionExpiry";

// Before any request leaves: Door43 gets a few at a time, writes first (see door43Gate.ts).
installDoor43Gate();

// Right after the gate and before the first render: React runs children's effects before App's, so a guard
// installed from App would let the first requests leave unwatched. Outside the gate, so a renewal can't starve behind it.
installSessionExpiryGuard({ getSessionToken: () => loadSession()?.token, onExpired: notifySessionExpired });

// The size of the texts the person chose on this device, before anything is drawn.
applyTextSize();

applyMockSessionFromUrl();
applyServerFromUrl();
startManifest();
installTypingMode();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable app: the worker only keeps the shell; it is off in dev so HMR is untouched.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
