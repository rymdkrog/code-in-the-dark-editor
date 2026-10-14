import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Placeholder } from "../Placeholder.tsx";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Placeholder title="Join the Audience" />
  </StrictMode>,
);
