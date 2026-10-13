import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrepPage } from "./PrepPage.tsx";
import "./prep.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <PrepPage />
  </StrictMode>,
);
