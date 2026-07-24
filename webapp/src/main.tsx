import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline app-shell caching is a progressive enhancement, not required */
    });
  });
}
