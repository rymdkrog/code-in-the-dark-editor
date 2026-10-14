import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AudiencePhone } from "./AudiencePhone.tsx";
import "./join.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <AudiencePhone />
  </StrictMode>,
);
