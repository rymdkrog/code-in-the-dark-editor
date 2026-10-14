import "./placeholder.css";
import { VersionFooter } from "./shared.tsx";

/** A Worker page that later tickets fill in: for now it only shows the Join code it was opened with. */
export function Placeholder({ title }: { title: string }) {
  const code = new URLSearchParams(location.search).get("c");
  return (
    <main className="placeholder">
      <h1>{title}</h1>
      {code && <p className="code">{code}</p>}
      <p>Not ready yet: this page arrives in a later version of the Audience layer.</p>
      <VersionFooter />
    </main>
  );
}
