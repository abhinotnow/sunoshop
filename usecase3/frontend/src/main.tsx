import { createRoot } from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./state/settings";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/depth.css";

createRoot(document.getElementById("root")!).render(
  // No StrictMode: its double-mounted effects would open the iPhone camera twice in development.
  <SettingsProvider>
    <App />
  </SettingsProvider>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
