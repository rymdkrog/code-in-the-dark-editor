// The Control desk (Host variant A of the Stage/Host prototype): a rail of Rounds with each
// one's Roster status, and the Current Round's lifecycle with its clock, controls and Roster.
// The Worker owns the lifecycle; this only sends commands, and sends none while offline.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  MAX_DURATION_MS,
  PHASES,
  isByHand,
  type CompetitionSummary,
  type HostCommand,
  type Lifecycle,
  type LifecycleCommand,
  type Phase,
  type Roster,
  type RosterEntry,
  type Tally,
} from "../../protocol/protocol.ts";
import { stageLink } from "../links.ts";
import {
  CopyButton,
  entryCount,
  entryVotes,
  formatClock,
  PHASE_LABELS,
  PhaseChip,
  RoundClock,
  turnoutOf,
  VersionFooter,
  voteCount,
  votesWord,
} from "../shared.tsx";
import { useStoredRoundIds } from "../use-references.ts";
import { rosterStatus, RosterTable } from "./RosterTable.tsx";

/** The phases a Round can't be switched away from without asking, and what switching costs. */
const SWITCHING_COSTS: Partial<Record<Phase, string>> = {
  running: "abandons its timer",
  timesup: "skips its voting",
  voting: "closes voting without showing results",
};

const HINTS: Record<Phase, string> = {
  upcoming: "The Stage shows “up next” and the Roster.",
  running: "No pause. The timer runs on the server and survives this console closing.",
  timesup: "Wait for the Reveals, then open voting.",
  voting: "Close voting when the tally settles.",
  results: "The Stage shows the ranking. Announce the winner.",
};

interface Props {
  competition: CompetitionSummary;
  lifecycle: Lifecycle;
  /** Every Round's Roster, by Round id. */
  rosters: Record<string, Roster>;
  /** Every Round's live tally, by Round id: the Host's alone. */
  tallies: Record<string, Tally>;
  online: boolean;
  /** What the last Competition file or Round packages dropped on the console loaded, for a few seconds. */
  dropNotice: string | null;
  /** The Current Round this link's Round list leaves out, so the Worker kept its own list. */
  leftOut: string | null;
  /** Sends now, or drops the command and returns false. */
  send(command: HostCommand): boolean;
}

export function ControlDesk({ competition, lifecycle, rosters, tallies, online, dropNotice, leftOut, send }: Props) {
  const [confirm, confirmation] = useConfirm(online, lifecycle);
  const roundName = (id: string | null) =>
    competition.rounds.find((round) => round.id === id)?.name ?? "the welcome screen";
  const current = lifecycle.current === null ? null : roundName(lifecycle.current);
  const tally = (lifecycle.current && tallies[lifecycle.current]) || {};
  const counting = lifecycle.phase === "voting" || lifecycle.phase === "results";
  const running = lifecycle.phase === "running";

  const makeCurrent = async (roundId: string | null) => {
    if (roundId === lifecycle.current) return;
    const { phase } = lifecycle;
    const cost = phase && SWITCHING_COSTS[phase];
    if (phase && cost) {
      const ok = await confirm({
        title: `Put ${roundName(roundId)} on the Stage?`,
        body: `${current} is ${PHASE_LABELS[phase].toLowerCase()}. Switching ${cost}.`,
        ok: "Switch",
      });
      if (!ok) return;
    }
    send({ t: "make-current", roundId });
  };

  /** Votes belong to one run of a Round: a re-run clears them, once the Host says so. */
  const start = async () => {
    const turnout = turnoutOf(tally);
    const ok =
      !turnout ||
      (await confirm({
        title: `Start ${current} again?`,
        body: `Starting a re-run clears the ${voteCount(turnout)} from its last run.`,
        ok: "Start and clear votes",
      }));
    if (ok) send({ t: "start" });
  };

  const endEarly = async () => {
    const left = formatClock((lifecycle.endsAt ?? 0) - Date.now());
    if (await confirm({ title: `End ${current} now?`, body: `${left} left. Everyone's time is up at once.`, ok: "End now" })) {
      send({ t: "end-early" });
    }
  };

  const removeEntry = async (roundId: string, entry: RosterEntry) => {
    const laptop = entry.online
      ? "Their laptop is still connected. It stays hidden for the rest of this Round."
      : isByHand(entry)
        ? "They were added by hand."
        : "If their laptop connects again, they're back on the Roster.";
    const roundTally = tallies[roundId] ?? {};
    const { count } = entryVotes(roundTally, entry.seat);
    // Once the Round has votes, the Host is told what removing costs, even when it's nothing.
    const discarded = count
      ? ` ${voteCount(count)} for them ${count === 1 ? "is" : "are"} discarded, and those phones go back to “not voted”.`
      : turnoutOf(roundTally)
        ? " No votes are discarded."
        : "";
    const body = laptop + discarded;
    if (await confirm({ title: `Remove ${entry.name} from ${roundName(roundId)}?`, body, ok: "Remove" })) {
      send({ t: "remove-entry", roundId, seat: entry.seat });
    }
  };

  /** After a rehearsal. Every Round is cleared at once, so the Host is told what goes from each. */
  const reset = async () => {
    const cleared = competition.rounds
      .map((round) => {
        const entries = rosters[round.id]?.entries.length ?? 0;
        const votes = turnoutOf(tallies[round.id] ?? {});
        return { name: round.name, entries, votes };
      })
      .filter(({ entries, votes }) => entries || votes)
      .map(({ name, entries, votes }) => `${name}: ${entryCount(entries)}, ${voteCount(votes)}.`);
    const body = [
      cleared.length ? `Clears every Round's Roster and votes. ${cleared.join(" ")}` : "Every Roster is empty and nobody has voted.",
      "The Stage goes back to the welcome screen. The Join code and Round packages stay the same, and laptops still open come back on their Roster.",
    ].join(" ");
    if (await confirm({ title: "Reset after the rehearsal?", body, ok: "Reset" })) send({ t: "reset" });
  };

  return (
    <div className={`host ${online ? "" : "offline"}`}>
      {!online && (
        <div className="offline-banner" role="status">
          Connection lost — reconnecting… Controls are paused.
        </div>
      )}
      {leftOut && (
        <div className="rounds-banner" role="alert">
          This link's Round list leaves out {roundName(leftOut)}, the Current Round, so the console keeps the Round list it had.
          Put another Round on the Stage, then open this link again.
        </div>
      )}
      <header className="top">
        <span className="brand">CITD Host</span>
        <span>{competition.name || <i>unnamed</i>}</span>
        <span className="sp" />
        <span className="muted">
          Join <b className="mono code">{competition.joinCode}</b>
        </span>
        <span>
          <span className={`dot ${online ? "" : "off"}`} /> {online ? "live" : "reconnecting"}
        </span>
        <CopyButton
          className="btn sm ghost"
          text={stageLink(location.origin, competition.joinCode, competition.name)}
          label="Copy Stage link"
        />
      </header>
      <div className="body">
        <nav className="rail" aria-label="Rounds">
          <div className="rail-h">On the Stage</div>
          <button
            className={`rail-item ${lifecycle.current === null ? "on" : ""}`}
            aria-current={lifecycle.current === null || undefined}
            disabled={!online}
            onClick={() => makeCurrent(null)}
          >
            <b>Welcome screen</b>
            <small>No Round. Join code and QR.</small>
          </button>
          <div className="rail-h">Rounds</div>
          {competition.rounds.map((round) => {
            const on = round.id === lifecycle.current;
            return (
              <button
                key={round.id}
                className={`rail-item ${on ? "on" : ""}`}
                aria-current={on || undefined}
                disabled={!online}
                onClick={() => makeCurrent(round.id)}
              >
                <span>
                  <b>{round.name}</b> {on && lifecycle.phase && <PhaseChip phase={lifecycle.phase} />}
                </span>
                <small>{rosterStatus(rosters[round.id])}</small>
              </button>
            );
          })}
          <References rounds={competition.rounds} dropNotice={dropNotice} />
          <section className="reset" aria-labelledby="reset-h">
            <div className="rail-h" id="reset-h">
              Rehearsal
            </div>
            <button className="btn sm danger" disabled={!online || running} onClick={reset}>
              Reset after rehearsal…
            </button>
            <p className="muted small">
              {running ? "Not while a Round is running." : "Clears every Roster and vote. The Join code stays."}
            </p>
          </section>
          <VersionFooter className="version" />
        </nav>
        <main>
          {lifecycle.phase === null ? (
            <>
              <div className="head">
                <h1>Welcome screen</h1>
                <span className="chip">No Round</span>
              </div>
              <div className="ctl">
                <p className="hint">
                  The Stage shows the Competition name, Join code and QR. Pick a Round on the left to put it up next.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="head">
                <h1>{current}</h1>
                <PhaseChip phase={lifecycle.phase} />
              </div>
              <Stepper phase={lifecycle.phase} />
              <div className="ctl">
                {counting ? <Turnout tally={tally} /> : <RoundClock lifecycle={lifecycle} className="mono" />}
                <div className="btns">
                  <Controls lifecycle={lifecycle} online={online} send={send} start={start} endEarly={endEarly} />
                </div>
                <p className="hint">{HINTS[lifecycle.phase]}</p>
              </div>
              <RosterTable
                roundName={current!}
                roster={rosters[lifecycle.current!]}
                tally={counting ? tally : undefined}
                online={online}
                onAdd={(name) => send({ t: "add-by-hand", roundId: lifecycle.current!, name })}
                onRemove={(entry) => removeEntry(lifecycle.current!, entry)}
              />
            </>
          )}
        </main>
      </div>
      {confirmation}
    </div>
  );
}

/** The Rounds whose Reference a Stage in this browser shows while voting. The Organizer drops the
 * Competition file or Round packages anywhere on the console to load them. */
function References({ rounds, dropNotice }: { rounds: CompetitionSummary["rounds"]; dropNotice: string | null }) {
  const stored = useStoredRoundIds();
  const names = rounds.filter((round) => stored.includes(round.id)).map((round) => round.name);
  return (
    <section className="refs" aria-labelledby="refs-h">
      <div className="rail-h" id="refs-h">
        References
      </div>
      <p>{names.length ? names.join(", ") : "none"}</p>
      <p className="muted small">
        A Stage in this browser shows them while voting. Drop the Competition file or Round packages anywhere on
        this page to load them. They stay in this browser.
      </p>
      {dropNotice && (
        <p className="small" role="status">
          {dropNotice}
        </p>
      )}
    </section>
  );
}

function Controls(props: Pick<Props, "lifecycle" | "online" | "send"> & { start(): void; endEarly(): void }) {
  const { lifecycle, online, send, start, endEarly } = props;
  const button = (label: ReactNode, command: LifecycleCommand | (() => void), className = "") => (
    <button
      className={`btn ${className}`}
      disabled={!online}
      onClick={() => (typeof command === "function" ? command() : send(command))}
    >
      {label}
    </button>
  );
  const backToUpNext = button("Back to up next", { t: "back-to-up-next" });
  switch (lifecycle.phase) {
    case "upcoming":
      return (
        <>
          <Duration durationMs={lifecycle.durationMs} online={online} send={send} />
          {button(<><Glyph>▶</Glyph>Start Round</>, start, "primary")}
        </>
      );
    case "running":
      return (
        <>
          {button("+30 s", { t: "add-time", ms: 30_000 })}
          {button("+1 min", { t: "add-time", ms: 60_000 })}
          {button(<><Glyph>■</Glyph>End early</>, endEarly, "danger")}
        </>
      );
    case "timesup":
      return (
        <>
          {button(<><Glyph>🗳</Glyph>Open voting</>, { t: "open-voting" }, "primary")}
          {backToUpNext}
        </>
      );
    case "voting":
      return button("Close voting & show results", { t: "close-voting" }, "primary");
    case "results":
      return (
        <>
          {button("Reopen voting", { t: "reopen-voting" }, "primary")}
          {backToUpNext}
        </>
      );
    default:
      return null;
  }
}

/** A decorative symbol before a button's label, left out of its accessible name. */
const Glyph = ({ children }: { children: string }) => <span aria-hidden="true">{children} </span>;

/** The duration in whole minutes. It's the Worker's, so a change is sent on blur (Enter blurs)
 * and the field shows what the Worker stored. */
function Duration({ durationMs, online, send }: { durationMs: number; online: boolean; send: Props["send"] }) {
  const minutes = durationMs / 60_000;
  const [min, max] = [1, MAX_DURATION_MS / 60_000];
  const commit = (input: HTMLInputElement) => {
    const wanted = Math.max(min, Math.min(max, Math.round(Number(input.value))));
    const sent = input.value && !Number.isNaN(wanted) && wanted !== minutes && send({ t: "set-duration", durationMs: wanted * 60_000 });
    if (!sent) input.value = String(minutes);
  };
  return (
    <label className="dur">
      <input
        // A new value from the Worker replaces whatever was typed.
        key={durationMs}
        type="number"
        min={min}
        max={max}
        defaultValue={minutes}
        aria-label="Duration in minutes"
        disabled={!online}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === "Enter" && event.currentTarget.blur()}
      />{" "}
      min
    </label>
  );
}

/** How many phones have voted: it takes the clock's place during voting and results. */
function Turnout({ tally }: { tally: Tally }) {
  const turnout = turnoutOf(tally);
  return (
    <div className="clock mono" role="group" aria-label="Turnout">
      {turnout}
      <span className="unit"> {votesWord(turnout)}</span>
    </div>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const at = PHASES.indexOf(phase);
  return (
    <ol className="stepper" aria-label="Lifecycle">
      {PHASES.map((step, i) => (
        <li key={step} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
          {PHASE_LABELS[step]}
        </li>
      ))}
    </ol>
  );
}

interface Question {
  title: string;
  body: string;
  ok: string;
}

/** A `<dialog>` confirmation: `confirm()` opens it and resolves with the Host's answer. Going
 * offline answers no, so nothing confirmed while offline is sent late; so does a lifecycle
 * change (another Host, or the alarm), since the question may no longer be true. */
function useConfirm(online: boolean, lifecycle: Lifecycle) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const answer = useRef<(ok: boolean) => void>(() => {});

  useEffect(() => {
    dialog.current?.close("cancel");
  }, [online, lifecycle]);

  const confirm = (next: Question) =>
    new Promise<boolean>((resolve) => {
      answer.current(false);
      answer.current = resolve;
      setQuestion(next);
      if (!dialog.current?.open) dialog.current?.showModal();
    });

  const element = (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      onClose={(event) => {
        const ok = event.currentTarget.returnValue === "ok";
        event.currentTarget.returnValue = "";
        answer.current(ok);
        answer.current = () => {};
      }}
    >
      <form method="dialog">
        <h3 id="confirm-title">{question?.title}</h3>
        <p>{question?.body}</p>
        <menu>
          <button className="btn ghost" value="cancel" autoFocus>
            Cancel
          </button>
          <button className="btn danger" value="ok">
            {question?.ok}
          </button>
        </menu>
      </form>
    </dialog>
  );
  return [confirm, element] as const;
}
