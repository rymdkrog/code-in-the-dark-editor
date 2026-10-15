import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ControlRoom } from "./ControlRoom.tsx";
import "./dev.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ControlRoom />
  </StrictMode>,
);
