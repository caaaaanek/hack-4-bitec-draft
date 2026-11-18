/* Точка входу: стилі, стан, роутер, запуск. */
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/extra.css";
import "./styles/extra-builder.css";
import "./styles/extra-datepicker.css";
import "./styles/extra-fixes.css";
import "./styles/extra-preview.css";
import "./styles/extra-shell.css";
import "./styles/extra-survey.css";
import "./styles/extra-report.css";
import "./styles/extra-whatif.css";
import "./styles/extra-qr.css";
import "./styles/extra-modules.css";
import "./styles/base-end.css";
import { S } from "./lib/state.js";
import { API, boot } from "./lib/api.js";
import { render } from "./lib/store.js";
import { installTips } from "./components/overlays.jsx";
import App, { applyRoute, applyA11y, initSide, initTheme } from "./App.jsx";

// Для перевірок у браузері (Playwright) і налагодження
window.S = S; window.API = API;

initTheme(); initSide(); installTips();
addEventListener("hashchange", () => { applyRoute(); render(); });
createRoot(document.getElementById("root")).render(<App />);
applyA11y();
applyRoute();
boot(); // з бекендом: вхід і дані сервера; без нього — демо
