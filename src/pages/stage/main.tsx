import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stage } from "./Stage.tsx";
import "./stage.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Stage />
  </StrictMode>,
);
