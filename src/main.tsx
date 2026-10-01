import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyMockSessionFromUrl } from "./devMockSession";
import { startManifest } from "./manifest";
import "./index.css";

applyMockSessionFromUrl();
startManifest();

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
