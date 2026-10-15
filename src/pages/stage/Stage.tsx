// The Stage (Stage variant D of the Stage/Host prototype): the venue screen. It is read-only,
// joined with the public Join code, and drawn at 1920×1080, scaled to fit the window. It shows
// what the Worker last said, and keeps counting from the last `endsAt` while offline.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { connectSocket } from "../../enhancement/socket.ts";
import {
  isJoinCode,
  socketPath,
  V,
  type Phase,
  type PublicEntry,
  type PublicSnapshot,
  type ServerMessage,
  type Tally,
} from "../../protocol/protocol.ts";
import { joinLink, sameOriginSocket } from "../links.ts";
import { entryVotes, RoundClock, VersionFooter, votesWord } from "../shared.tsx";
import { Qr } from "./Qr.tsx";

const WIDTH = 1920;
const HEIGHT = 1080;
/** The popped-out Stage window's name, so it doesn't offer to pop out again. */
const POPPED_OUT = "citd-stage";

/** What the Worker has said about this Competition so far. */
type Standing =
  | { kind: "unknown" }
  | { kind: "unclaimed" }
  /** `arriving` is set while the results arrive last to first: only when this connection saw
   * voting close. A Stage that connects or reconnects at results shows them all at once. */
  | ({ kind: "claimed"; arriving: boolean } & PublicSnapshot);

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
  // The phase this connection last heard, and whether its results are arriving.
  const heard = useRef<{ phase?: Phase | null; arriving: boolean }>({ arriving: false });

  useEffect(() => {
    const connection = connectSocket(sameOriginSocket(socketPath(joinCode, "stage")), {
      open() {
        heard.current = { arriving: false };
        setOnline(true);
        connection.send({ v: V, t: "follow" });
      },
      down: () => setOnline(false),
      message(data) {
        const message = data as ServerMessage;
        if (message?.t === "unclaimed") setStanding({ kind: "unclaimed" });
        if (message?.t === "public") {
          const { competition, lifecycle, roster, turnout, tally } = message;
          const { phase } = lifecycle;
          const arriving = phase === "results" && (heard.current.arriving || heard.current.phase === "voting");
          heard.current = { phase, arriving };
          setStanding({ kind: "claimed", arriving, competition, lifecycle, roster, turnout, tally });
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

function Screen({ competition, lifecycle, roster, turnout, tally, arriving }: PublicSnapshot & { arriving: boolean }) {
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
  if (lifecycle.phase === "voting") return <VoteNow roundName={round.name} turnout={turnout} {...join} />;
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
      {lifecycle.phase === "results" ? (
        <Results roster={roster} tally={tally ?? {}} arriving={arriving} />
      ) : (
        <ul className="tiles" aria-label="Roster">
          {roster.map((entry) => (
            <li key={entry.id} className="tile">
              {entry.name}
            </li>
          ))}
        </ul>
      )}
      {/* Reactions are over at results. */}
      <JoinFoot {...join} verb={lifecycle.phase === "results" ? "Join" : "React"} />
    </>
  );
}

/** While voting: the turnout, QR and Join code, and no per-Contestant counts. */
function VoteNow({ roundName, turnout, url, joinCode }: { roundName: string; turnout: number; url: string; joinCode: string }) {
  return (
    <div className="vote-now">
      <Qr text={url} size={440} />
      <div>
        <div className="kicker">Vote now · {roundName}</div>
        <div className="count" aria-label="Turnout">
          {turnout}
        </div>
        <div className="sub">{votesWord(turnout)} so far</div>
        <div className="code">{joinCode}</div>
        <div className="sub">{displayUrl(url)}</div>
      </div>
    </div>
  );
}

/** Seconds between one vote count's tiles arriving and the next, and the leaders' extra wait. */
const STEP_S = 1.1;
const LEADER_WAIT_S = 0.9;

/** Every Roster entry as a tile, most votes first, 0 included, each grown to its count. While
 * arriving they come last to first, the same counts together, and the joint leaders last,
 * crowned, with a TIE badge if there's more than one. */
function Results({ roster, tally, arriving }: { roster: PublicEntry[]; tally: Tally; arriving: boolean }) {
  const ranked = roster
    .map((entry, order) => ({ entry, order, ...entryVotes(tally, entry.id) }))
    .sort((a, b) => b.count - a.count || a.order - b.order);
  const counts = [...new Set(ranked.map(({ count }) => count))].sort((a, b) => a - b);
  const delay = (count: number, lead: boolean) =>
    ({ "--delay": `${counts.indexOf(count) * STEP_S + (lead ? LEADER_WAIT_S : 0)}s` }) as CSSProperties;
  const leaders = ranked.filter(({ lead }) => lead);
  return (
    <>
      {leaders.length > 1 && (
        <div className={`tiebadge ${arriving ? "arriving" : ""}`} style={delay(leaders[0]!.count, true)}>
          TIE
        </div>
      )}
      <ol className={`tiles results ${arriving ? "arriving" : ""}`} aria-label="Results">
        {ranked.map(({ entry, count, lead, share }) => (
          <li key={entry.id} className={`tile ${lead ? "lead" : ""}`} style={delay(count, lead)}>
            <div className="fill" style={{ height: `${share * 100}%` }} />
            <b className="n">{count}</b>
            {lead && (
              <span className="crown" role="img" aria-label="Leader">
                👑
              </span>
            )}
            <span className="nm">{entry.name}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function JoinFoot({ url, joinCode, verb }: { url: string; joinCode: string; verb: "React" | "Join" }) {
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
