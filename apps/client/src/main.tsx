import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapTransport } from "./bootstrap";
import { initTheme } from "./theme/theme";
import "./i18n";
import "./index.css";

// Re-affirm the theme attribute the inline no-FOUC script in index.html already stamped, so the
// data-theme on <html> is correct even if that script was stripped (e.g. a stricter CSP).
initTheme();
bootstrapTransport();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
