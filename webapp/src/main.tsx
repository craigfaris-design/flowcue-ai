import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Production only -- Vite's dev server doesn't serve /sw.js in a way the
// stricter ServiceWorkerContainer.register() fetch algorithm accepts (a
// plain fetch('/sw.js') succeeds fine; register() throws "An unknown error
// occurred when fetching the script" every time, confirmed live). Offline
// app-shell caching has no purpose in dev anyway (the dev server is always
// live), so registering there was only ever adding console noise, not real
// functionality -- confirmed the built production site (Netlify) registers
// and activates the same script cleanly.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline app-shell caching is a progressive enhancement, not required */
    });
  });
}
