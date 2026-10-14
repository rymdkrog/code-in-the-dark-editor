import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HostConsole } from "./HostConsole.tsx";
import "./host.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <HostConsole />
  </StrictMode>,
);
