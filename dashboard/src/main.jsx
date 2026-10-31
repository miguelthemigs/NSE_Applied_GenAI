import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "material-symbols/outlined.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./index.css";
import App from "./App.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";

createRoot(document.getElementById("root")).render(
  <MotionConfig reducedMotion="user">
    <I18nProvider>
      <App />
    </I18nProvider>
  </MotionConfig>,
);
