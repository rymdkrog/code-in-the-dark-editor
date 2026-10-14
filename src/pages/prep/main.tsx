import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrepPage } from "./PrepPage.tsx";
import "@fontsource/press-start-2p/latin-400.css";
import "./prep.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <PrepPage />
  </StrictMode>,
);
