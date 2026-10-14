// The Stage (Stage variant D of the Stage/Host prototype): the venue screen. It is read-only,
// joined with the public Join code, and drawn at 1920×1080, scaled to fit the window. It shows
// what the Worker last said, and keeps counting from the last `endsAt` while offline.

import { useEffect, useState, type ReactNode } from "react";
import { connectSocket } from "../../enhancement/socket.ts";
import {
  isJoinCode,
  socketPath,
  V,
  type Phase,
  type PublicSnapshot,
  type ServerMessage,
} from "../../protocol/protocol.ts";
import { joinLink, sameOriginSocket } from "../links.ts";
import { RoundClock, VersionFooter } from "../shared.tsx";
import { Qr } from "./Qr.tsx";

const WIDTH = 1920;
const HEIGHT = 1080;
/** The popped-out Stage window's name, so it doesn't offer to pop out again. */
const POPPED_OUT = "citd-stage";

/** What the Worker has said about this Competition so far. */
type Standing =
  | { kind: "unknown" }
  | { kind: "unclaimed" }
  | ({ kind: "claimed" } & PublicSnapshot);

export function Stage() {
  const [query] = useState(() => new URLSearchParams(location.search));
  const joinCode = query.get("c") ?? "";
  if (!isJoinCode(joinCode)) {
    return (
      <main className="stage-notice">
        <h1>This Stage link has no Join code</h1>
        <p>Copy the Stage link again from the Host console or the prep page.</p>
        <VersionFooter />
      </main>
    );
  }
  return <FollowingStage joinCode={joinCode} name={query.get("n") ?? ""} />;
}

function FollowingStage({ joinCode, name }: { joinCode: string; name: string }) {
  // Null until the first connect succeeds or fails.
  const [online, setOnline] = useState<boolean | null>(null);
  const [standing, setStanding] = useState<Standing>({ kind: "unknown" });

  useEffect(() => {
    const connection = connectSocket(sameOriginSocket(socketPath(joinCode, "stage")), {
      open() {
        setOnline(true);
        connection.send({ v: V, t: "follow" });
      },
      down: () => setOnline(false),
      message(data) {
        const message = data as ServerMessage;
        if (message?.t === "unclaimed") setStanding({ kind: "unclaimed" });
        if (message?.t === "public") {
          const { competition, lifecycle, roster } = message;
          setStanding({ kind: "claimed", competition, lifecycle, roster });
        }
      },
    });
    return () => connection.close();
  }, [joinCode]);

  return (
    <Frame>
      {standing.kind === "claimed" ? (
        <Screen {...standing} />
      ) : (
        <div className="st-wait">
          {/* The Worker learns the name only from the claim; until then it comes from the link. */}
          <div className="big">{name || joinCode}</div>
          <div className="sub">
            {standing.kind === "unknown" ? "Connecting to the Worker…" : "Waiting for the Host to open the Competition…"}
          </div>
        </div>
      )}
      {online === false && (
        <div className="st-offline" role="status">
          <i />
          reconnecting
        </div>
      )}
      <VersionFooter className="st-version" />
    </Frame>
  );
}

/** The 1920×1080 Stage, scaled to fit the window, and a way to pop it out to a window of its own. */
function Frame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const refit = () => setScale(fit());
    addEventListener("resize", refit);
    return () => removeEventListener("resize", refit);
  }, []);
  const popOut = () => open(location.href, POPPED_OUT, `popup,width=${WIDTH / 1.5},height=${HEIGHT / 1.5}`);
  return (
    <div className="stage-frame">
      <div className="st" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
      {window.name !== POPPED_OUT && (
        <button className="popout" onClick={popOut}>
          Pop out
        </button>
      )}
    </div>
  );
}

const fit = () => Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);

const KICKERS: Record<Exclude<Phase, "running">, string> = {
  upcoming: "Up next",
  timesup: "Time's up · Reveals next",
  voting: "Voting",
  results: "Results",
};

function Screen({ competition, lifecycle, roster }: PublicSnapshot) {
  const join = { url: joinLink(location.origin, competition.joinCode), joinCode: competition.joinCode };
  const round = competition.rounds.find(({ id }) => id === lifecycle.current);
  if (!lifecycle.phase || !round) {
    return (
      <>
        <div className="mid">
          <div className="kicker">Code in the Dark</div>
          <div className="big">{competition.name}</div>
          <div className="sub">Grab your phone. Join below.</div>
        </div>
        <JoinFoot {...join} verb="React" />
      </>
    );
  }
  if (lifecycle.phase === "running") {
    return (
      <>
        <div className="top">
          <b>{round.name}</b>
          <span>{competition.name}</span>
        </div>
        <div className="center">
          <RoundClock lifecycle={lifecycle} className="giant" />
        </div>
        <div className="bottom">
          <ul className="names" aria-label="Roster">
            {roster.map((entry) => (
              <li key={entry.id}>{entry.name}</li>
            ))}
          </ul>
          <div className="join-corner">
            <div>
              React on your phone
              <b>{join.joinCode}</b>
              <span>{displayUrl(join.url)}</span>
            </div>
            <Qr text={join.url} size={170} />
          </div>
        </div>
      </>
    );
  }
  const clock = lifecycle.phase === "upcoming" || lifecycle.phase === "timesup";
  return (
    <>
      <div className="bar">
        <i style={{ transform: `scaleX(${lifecycle.phase === "upcoming" ? 1 : 0})` }} />
      </div>
      <div className="head">
        <div className="round-name">
          <small>{KICKERS[lifecycle.phase]}</small>
          <span>{round.name}</span>
        </div>
        {clock && <RoundClock lifecycle={lifecycle} className="" />}
      </div>
      <ul className="tiles" aria-label="Roster">
        {roster.map((entry) => (
          <li key={entry.id} className="tile">
            {entry.name}
          </li>
        ))}
      </ul>
      <JoinFoot {...join} verb={lifecycle.phase === "voting" ? "Vote" : "React"} />
    </>
  );
}

function JoinFoot({ url, joinCode, verb }: { url: string; joinCode: string; verb: "React" | "Vote" }) {
  return (
    <div className="foot">
      <Qr text={url} size={140} />
      <span>
        {verb} at <span>{displayUrl(url)}</span> · <b>{joinCode}</b>
      </span>
    </div>
  );
}

/** The Join URL as people type it: no scheme, no query. */
const displayUrl = (url: string) => {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
};
