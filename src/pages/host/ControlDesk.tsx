// The Control desk (Host variant A of the Stage/Host prototype): a rail of Rounds, and the
// Current Round's lifecycle with its clock and controls. The Worker owns the lifecycle; this
// only sends commands, and sends none while offline.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  MAX_DURATION_MS,
  PHASES,
  type CompetitionSummary,
  type Lifecycle,
  type LifecycleCommand,
  type Phase,
} from "../../protocol/protocol.ts";
import { stageLink } from "../links.ts";
import { CopyButton, formatClock, RoundClock, VersionFooter } from "../shared.tsx";

const PHASE_LABELS: Record<Phase, string> = {
  upcoming: "Up next",
  running: "Running",
  timesup: "Time's up",
  voting: "Voting",
  results: "Results",
};

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
  online: boolean;
  /** Sends now, or drops the command and returns false. */
  send(command: LifecycleCommand): boolean;
}

export function ControlDesk({ competition, lifecycle, online, send }: Props) {
  const [confirm, confirmation] = useConfirm(online, lifecycle);
  const roundName = (id: string | null) =>
    competition.rounds.find((round) => round.id === id)?.name ?? "the welcome screen";
  const current = lifecycle.current === null ? null : roundName(lifecycle.current);

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

  const endEarly = async () => {
    const left = formatClock((lifecycle.endsAt ?? 0) - Date.now());
    if (await confirm({ title: `End ${current} now?`, body: `${left} left. Everyone's time is up at once.`, ok: "End now" })) {
      send({ t: "end-early" });
    }
  };

  return (
    <div className={`host ${online ? "" : "offline"}`}>
      {!online && (
        <div className="offline-banner" role="status">
          Connection lost — reconnecting… Controls are paused.
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
              </button>
            );
          })}
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
                <Clock lifecycle={lifecycle} />
                <div className="btns">
                  <Controls lifecycle={lifecycle} online={online} send={send} endEarly={endEarly} />
                </div>
                <p className="hint">{HINTS[lifecycle.phase]}</p>
              </div>
            </>
          )}
        </main>
      </div>
      {confirmation}
    </div>
  );
}

function Controls(props: Pick<Props, "lifecycle" | "online" | "send"> & { endEarly(): void }) {
  const { lifecycle, online, send, endEarly } = props;
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
          {button(<><Glyph>▶</Glyph>Start Round</>, { t: "start" }, "primary")}
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

/** Counts down from `endsAt` while running; it keeps counting while the console is offline. */
function Clock({ lifecycle }: { lifecycle: Lifecycle }) {
  if (lifecycle.phase === "voting" || lifecycle.phase === "results") return null;
  return <RoundClock lifecycle={lifecycle} className="mono" />;
}

const PhaseChip = ({ phase }: { phase: Phase }) => <span className={`chip ph-${phase}`}>{PHASE_LABELS[phase]}</span>;

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
