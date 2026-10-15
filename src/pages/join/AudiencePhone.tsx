// The Audience phone page: join with the Join code, no name or account, and follow the
// Competition from Round to Round. It follows like the Stage does, so the Worker sends it the
// public snapshot: no secrets, only the Current Round's Roster, and of the votes only the turnout
// and this phone's own Vote.

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { connectSocket, type Socket } from "../../enhancement/socket.ts";
import {
  base64url,
  isJoinCode,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  REACTION_PHASES,
  REACTIONS,
  socketPath,
  V,
  type Phase,
  type PublicEntry,
  type PublicSnapshot,
  type Reaction,
  type ServerMessage,
} from "../../protocol/protocol.ts";
import { sameOriginSocket } from "../links.ts";
import { PhaseChip, RoundClock, VersionFooter, voteCount } from "../shared.tsx";

const VOTER_ID_KEY = "citd-voter-id";

/** Upper case, only the Join code alphabet, at most a Join code's length. */
const asJoinCode = (text: string) =>
  [...text.toUpperCase()]
    .filter((char) => JOIN_CODE_ALPHABET.includes(char))
    .join("")
    .slice(0, JOIN_CODE_LENGTH);

/** The code in the URL, as the QR carries it: `…/join?c=K7XQ2M`. */
const codeInUrl = () => asJoinCode(new URLSearchParams(location.search).get("c") ?? "");

/** Shows the code in the URL, so a reload rejoins; null clears it. */
function putCodeInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("c", code);
  else url.searchParams.delete("c");
  history.replaceState(null, "", url);
}

/** This phone's random voter id, kept in `localStorage` for Votes. Without storage (some
 * private windows) the phone gets a fresh one each time, which the voting rules accept. */
function keepVoterId(): string {
  const fresh = base64url(crypto.getRandomValues(new Uint8Array(16)));
  try {
    const kept = localStorage.getItem(VOTER_ID_KEY);
    if (kept) return kept;
    localStorage.setItem(VOTER_ID_KEY, fresh);
  } catch {
    // No storage.
  }
  return fresh;
}

export function AudiencePhone() {
  const [joined, setJoined] = useState(() => (isJoinCode(codeInUrl()) ? codeInUrl() : null));
  const [typed, setTyped] = useState(codeInUrl);
  const [voter] = useState(keepVoterId);

  const join = (code: string) => {
    putCodeInUrl(code);
    setJoined(code);
  };
  const changeCode = () => {
    putCodeInUrl(null);
    setTyped(joined ?? "");
    setJoined(null);
  };

  return (
    <div className="phone">
      {joined ? (
        <Joined joinCode={joined} voter={voter} onChangeCode={changeCode} />
      ) : (
        <CodeEntry typed={typed} onType={setTyped} onJoin={join} />
      )}
      <VersionFooter className="version" />
    </div>
  );
}

function CodeEntry(props: { typed: string; onType(code: string): void; onJoin(code: string): void }) {
  const { typed, onType, onJoin } = props;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isJoinCode(typed)) onJoin(typed);
  };
  return (
    <form className="center" onSubmit={submit}>
      <div className="brand">Code in the Dark</div>
      <h1 className="big">Enter the code on the Stage</h1>
      <input
        className="code-in mono"
        aria-label="Join code"
        value={typed}
        onChange={(event) => onType(asJoinCode(event.target.value))}
        maxLength={JOIN_CODE_LENGTH}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="······"
        autoFocus
      />
      <button className="btn primary" disabled={!isJoinCode(typed)}>
        Join
      </button>
      <p className="muted small">{JOIN_CODE_LENGTH} letters and digits · no account needed</p>
    </form>
  );
}

/** What the Worker has said about this Join code so far. */
type Admission = { kind: "joining" } | { kind: "waiting" } | ({ kind: "admitted" } & PublicSnapshot);

function Joined({ joinCode, voter, onChangeCode }: { joinCode: string; voter: string; onChangeCode(): void }) {
  const [admission, setAdmission] = useState<Admission>({ kind: "joining" });
  // True from a snapshot until the connection drops: only then is what's shown current.
  const [live, setLive] = useState(false);
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    const connection = (socket.current = connectSocket(sameOriginSocket(socketPath(joinCode, "phone")), {
      open: () => connection.send({ v: V, t: "follow", voter }),
      down: () => setLive(false),
      message(data) {
        const message = data as ServerMessage;
        // A typo looks the same as a Competition that isn't open yet. Either way the phone stays
        // connected, and the claim brings it the snapshot.
        if (message?.t === "unclaimed") {
          setLive(true);
          setAdmission({ kind: "waiting" });
        }
        if (message?.t === "public") {
          const { competition, lifecycle, roster, turnout, vote = null } = message;
          setLive(true);
          setAdmission({ kind: "admitted", competition, lifecycle, roster, turnout, vote });
        }
      },
    }));
    return () => connection.close();
  }, [joinCode, voter]);

  /** One tap, one Reaction: no coalescing, and nothing waits for it. */
  const react = (seat: string, emoji: Reaction) => socket.current?.send({ v: V, t: "react", seat, e: emoji });
  /** The Worker's next snapshot confirms the Vote; until then the phone doesn't claim it. */
  const cast = (seat: string) => socket.current?.send({ v: V, t: "vote", seat });

  return (
    <>
      {!live && admission.kind !== "joining" && (
        <div className="reconnecting" role="status">
          Reconnecting…
        </div>
      )}
      <AdmissionScreen
        admission={admission}
        joinCode={joinCode}
        live={live}
        react={react}
        cast={cast}
        onChangeCode={onChangeCode}
      />
    </>
  );
}

/** What the phone's buttons do. */
interface Taps {
  /** Whether what's shown is current: Reactions and Votes wait for the snapshot after a reconnect. */
  live: boolean;
  react(seat: string, emoji: Reaction): void;
  /** Casts this phone's Vote, replacing any earlier one. */
  cast(seat: string): void;
}

function AdmissionScreen(props: { admission: Admission; joinCode: string; onChangeCode(): void } & Taps) {
  const { admission, joinCode, onChangeCode, live, react, cast } = props;
  switch (admission.kind) {
    case "joining":
      return (
        <div className="center">
          <div className="spin" aria-hidden="true" />
          <h1 className="big">
            Joining <span className="mono">{joinCode}</span>…
          </h1>
        </div>
      );
    case "waiting":
      return <Waiting joinCode={joinCode} onChangeCode={onChangeCode} />;
    case "admitted":
      return admission.lifecycle.phase ? (
        <InRound {...admission} live={live} react={react} cast={cast} />
      ) : (
        <Welcome {...admission} />
      );
  }
}

function Waiting({ joinCode, onChangeCode }: { joinCode: string; onChangeCode(): void }) {
  return (
    <div className="center">
      <div className="spin" aria-hidden="true" />
      <h1 className="big">
        Waiting for <span className="mono">{joinCode}</span> to open…
      </h1>
      <p className="muted">Keep this page open. It starts by itself when the Host opens the Competition.</p>
      <p className="muted small">Not starting? Check the code on the Stage</p>
      <button className="btn ghost" onClick={onChangeCode}>
        Change code
      </button>
    </div>
  );
}

function Welcome({ competition }: PublicSnapshot) {
  return (
    <div className="center">
      <div className="brand">Code in the Dark</div>
      <h1 className="big">{competition.name || "Code in the Dark"}</h1>
      <p className="tick">✓ You're in</p>
      <p className="muted">Nothing's on yet. The next Round shows up here by itself.</p>
      <p className="muted small">
        While they code, send Reactions to their screens. After the Reveals, vote for the one that came closest.
      </p>
    </div>
  );
}

const PHASE_LINES: Partial<Record<Phase, string>> = {
  upcoming: "Starting soon. Warm them up.",
  running: "Cheer them on.",
  timesup: "Reveals coming. React to each one.",
};

function InRound(props: PublicSnapshot & Taps) {
  const { competition, lifecycle, roster, live, react } = props;
  const phase = lifecycle.phase!;
  const reacting = live && REACTION_PHASES.includes(phase);
  const round = competition.rounds.find((candidate) => candidate.id === lifecycle.current);
  return (
    <>
      <header className="hdr">
        <span className="round-name">{round?.name}</span>
        <PhaseChip phase={phase} />
        {(phase === "upcoming" || phase === "running") && <RoundClock lifecycle={lifecycle} className="mono" />}
      </header>
      {phase === "voting" ? (
        <VotingScreen {...props} />
      ) : phase === "results" ? (
        <VotingClosed {...props} />
      ) : (
        <>
          <p className="tagline">{PHASE_LINES[phase]}</p>
          {roster.length === 0 ? (
            <p className="muted small tagline">The Contestants show up here as they join.</p>
          ) : (
            // Most Heats have four Contestants: their emoji get the extra room. Eight still fit a screen.
            <ul className={`roster ${roster.length <= 4 ? "few" : ""}`} aria-label="Roster">
              {roster.map((entry) => (
                <RosterRow key={entry.id} entry={entry} reacting={reacting} react={react} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

const turnoutLine = (turnout: number) => `${voteCount(turnout)} so far`;

/** The voting screen: a big button per Roster entry, offline and hand-added ones included, and
 * the turnout but never the tally. Once the Worker has this phone's Vote, it shows that instead. */
function VotingScreen({ roster, turnout, vote = null, live, cast }: PublicSnapshot & Taps) {
  const [changing, setChanging] = useState(false);
  // A new Vote from the Worker, or a Vote discarded with its entry, ends a change.
  useEffect(() => setChanging(false), [vote]);
  const mine = roster.find((entry) => entry.id === vote);
  if (mine && !changing) {
    return (
      <div className="center">
        <p className="voted big">
          <span className="tick">✓</span> You voted for {mine.name}
        </p>
        <button className="btn ghost" disabled={!live} onClick={() => setChanging(true)}>
          Change my vote
        </button>
        <p className="muted small">{turnoutLine(turnout)} · the Host closes voting</p>
      </div>
    );
  }
  const pick = (seat: string) => (seat === vote ? setChanging(false) : cast(seat));
  return (
    <>
      <h1 className="question">Whose Reveal came closest?</h1>
      {roster.length === 0 ? (
        <p className="muted small tagline">Nobody to vote for yet.</p>
      ) : (
        <ul className="picks" aria-label="Roster">
          {roster.map((entry) => (
            <li key={entry.id}>
              <button
                className={vote && entry.id !== vote ? "dim" : ""}
                aria-pressed={entry.id === vote}
                disabled={!live}
                onClick={() => pick(entry.id)}
              >
                {entry.name}
                {entry.id === vote && (
                  <span className="tick" aria-hidden="true">
                    {" "}
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small turnout">{turnoutLine(turnout)}</p>
    </>
  );
}

/** At results the moment is on the Stage: the phone shows only its own pick. */
function VotingClosed({ roster, vote }: PublicSnapshot) {
  const mine = roster.find((entry) => entry.id === vote);
  return (
    <div className="center">
      <div className="eyes" aria-hidden="true">
        👀
      </div>
      <h1 className="big">Voting closed · Eyes on the Stage</h1>
      <p className="muted">
        {mine ? (
          <>
            You picked <b className="pick">{mine.name}</b>
          </>
        ) : (
          "You didn't vote this Round"
        )}
      </p>
    </div>
  );
}

/** A Roster entry and its own four emoji. Offline entries are dimmed and can't be reacted to; an
 * entry added by hand has no laptop to react on. */
function RosterRow(props: { entry: PublicEntry; reacting: boolean; react: Taps["react"] }) {
  const { entry, reacting, react } = props;
  const tap = (emoji: Reaction) => (event: MouseEvent<HTMLButtonElement>) => {
    // Felt and seen at once, before anything goes over the network.
    burst(emoji, event);
    try {
      navigator.vibrate?.(15);
    } catch {
      // No buzz on this phone.
    }
    react(entry.id, emoji);
  };
  return (
    <li className={!entry.handAdded && !entry.online ? "off" : ""}>
      <span className="who">{entry.name}</span>
      {entry.handAdded ? (
        <span className="muted small">no laptop — vote only</span>
      ) : (
        <span className="reacts">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className="react"
              aria-label={`React ${emoji} to ${entry.name}`}
              disabled={!reacting || !entry.online}
              onClick={tap(emoji)}
            >
              {emoji}
            </button>
          ))}
        </span>
      )}
    </li>
  );
}

/** The emoji pops up from where it was tapped, then clears itself. */
function burst(emoji: Reaction, event: MouseEvent<HTMLButtonElement>) {
  const button = event.currentTarget.getBoundingClientRect();
  // A click from the keyboard has no point: it bursts from the button's middle.
  const pointed = event.detail > 0;
  const element = document.createElement("span");
  element.className = "burst";
  element.textContent = emoji;
  element.setAttribute("aria-hidden", "true");
  element.style.left = `${pointed ? event.clientX : button.left + button.width / 2}px`;
  element.style.top = `${pointed ? event.clientY : button.top + button.height / 2}px`;
  const clear = () => element.remove();
  element.addEventListener("animationend", clear);
  setTimeout(clear, 1000);
  document.body.append(element);
}
