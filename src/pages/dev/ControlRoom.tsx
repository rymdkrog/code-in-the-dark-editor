// The dev-only control room: the Host console, the Stage and a few phones for one Competition, side
// by side. Only `npm run worker:dev` builds it (see vite.worker.config.ts).

import { useReducer, useState } from "react";
import { decodeClaim } from "../../protocol/protocol.ts";
import { controlRoomFrames, phoneCount, type Frame } from "./frames.ts";

export function ControlRoom() {
  const [frames] = useState(() => {
    const claim = decodeClaim(location.hash);
    return claim && controlRoomFrames(new URL(location.href), claim, phoneCount(location.search));
  });
  if (!frames) {
    return (
      <main className="cr-empty">
        <h1>Control room</h1>
        <p>
          Open this page as <code>/dev/#&lt;claim&gt;</code>, with the claim from a Host console link, as{" "}
          <code>npm run dev:demo</code> prints it. Add <code>?phones=2</code> to <code>4</code> for more or fewer phones.
        </p>
      </main>
    );
  }
  return (
    <main className="cr">
      {frames.map((frame) => (
        <FramePane key={frame.label} frame={frame} />
      ))}
    </main>
  );
}

/** One labelled frame, with a button that reloads it alone. */
function FramePane({ frame }: { frame: Frame }) {
  // A new iframe element loads afresh, even for a Host console link that differs only in its #fragment.
  const [loads, reload] = useReducer((loads: number) => loads + 1, 0);
  return (
    <section className={`cr-pane cr-${frame.kind}`} aria-label={frame.label}>
      <header>
        <h2>{frame.label}</h2>
        <a href={frame.src} target="_blank" rel="noreferrer">
          {new URL(frame.src).host}
        </a>
        <button onClick={reload}>Reload</button>
      </header>
      <iframe key={loads} src={frame.src} title={frame.label} />
    </section>
  );
}
