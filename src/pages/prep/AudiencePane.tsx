import { useEffect, useRef, useState, type FormEvent } from "react";
import { hostConsoleLink, stageLink } from "../links.ts";
import { claimRefusal, CopyButton, maskSecret } from "../shared.tsx";
import { claimOf, workerOrigin, type Audience, type Competition } from "./competition.ts";
import type { HostConnection } from "./host-socket.ts";
import { workerUrlMemory } from "./worker-url-memory.ts";

const rememberedWorkerUrl = workerUrlMemory();

interface Props {
  competition: Competition;
  connection: HostConnection;
  /** Focus the Worker URL field, then say so. */
  focusWorkerUrl: boolean;
  onWorkerUrlFocused(): void;
  onChange(change: Partial<Audience>): void;
  onMint(): void;
}

export function AudiencePane({ competition, connection, focusWorkerUrl, onWorkerUrlFocused, onChange, onMint }: Props) {
  const { audience } = competition;
  const workerUrlInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusWorkerUrl) return;
    workerUrlInput.current?.focus();
    onWorkerUrlFocused();
  }, [focusWorkerUrl]);
  const origin = workerOrigin(audience.workerUrl);
  const claimed = connection.standing.kind === "claimed";
  const stage = origin ? stageLink(origin, audience.joinCode, competition.name) : "";
  return (
    <section className="pane">
      <h2>Audience</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={audience.enabled}
          onChange={(event) => onChange(rememberedWorkerUrl.fill(audience, { enabled: event.target.checked }))}
        />
        Audience layer (Reactions, voting, the Stage timer)
      </label>
      {!audience.enabled ? (
        <p className="dim">Packages export pure offline: no Worker URL, no socket, nothing for the Audience.</p>
      ) : (
        <>
          <label className="field">
            Worker URL
            <span className="dim"> — your deployed Worker, or the closed instance</span>
            <input
              ref={workerUrlInput}
              value={audience.workerUrl}
              placeholder="https://citd.example.workers.dev"
              onChange={(event) => onChange({ workerUrl: event.target.value })}
              // Remembered once typed, not per keystroke: deleting a URL passes through valid stubs.
              onBlur={(event) => rememberedWorkerUrl.remember(event.target.value)}
            />
          </label>
          {!origin && <p className="warn">Not a valid Worker URL: packages export offline.</p>}
          <table className="credentials">
            <tbody>
              <tr>
                <th>
                  Join code<span className="dim">public · the Stage and phones</span>
                </th>
                <td>
                  <code className="join-code" aria-label="Join code">
                    {audience.joinCode}
                  </code>
                </td>
              </tr>
              <tr>
                <th>
                  Contestant token<span className="dim">baked into every package</span>
                </th>
                <td>
                  <code aria-label="Contestant token">{audience.contestantToken}</code>
                </td>
              </tr>
              <tr>
                <th>
                  Host secret<span className="dim">only in the Host console link</span>
                </th>
                <td>
                  <code aria-label="Host secret">{maskSecret(audience.hostSecret)}</code>
                </td>
              </tr>
            </tbody>
          </table>
          {origin && <WorkerStanding connection={connection} joinCode={audience.joinCode} />}
          {origin && (
            <div className="links">
              <div>
                <b>Host console</b>
                <span className="dim">
                  {claimed
                    ? " — private: it runs the Competition."
                    : " — private: it claims the Competition with your Organizer key on first open. Open it again after adding or renaming a Round."}
                </span>
                <div className="link-row">
                  <CopyButton className="small-button" text={hostConsoleLink(origin, claimOf(competition))} label="Copy Host console link" />
                  <a href={hostConsoleLink(origin, claimOf(competition))} target="_blank" rel="noreferrer">
                    Open Host console
                  </a>
                </div>
              </div>
              <div>
                <b>Stage</b>
                <span className="dim"> — the venue screen</span>
                <div className="link-row">
                  <CopyButton className="small-button" text={stage} label="Copy Stage link" />
                  <code aria-label="Stage link">{stage}</code>
                </div>
              </div>
            </div>
          )}
          <MintButton onMint={onMint} />
        </>
      )}
    </section>
  );
}

/** Where the Competition stands on the Worker, as prep's own Host socket hears it. */
function WorkerStanding({ connection, joinCode }: { connection: HostConnection; joinCode: string }) {
  const { standing } = connection;
  switch (standing.kind) {
    case "off":
    case "connecting":
      return <p className="dim standing">Connecting to the Worker…</p>;
    case "unreachable":
      return <p className="warn standing">Can't reach the Worker. Still trying: check the Worker URL.</p>;
    case "refused":
      return (
        <p className="problem standing">
          Join code {joinCode} is claimed with another Host secret, so Round changes here don't reach it. Use the
          Competition file that claimed it.
        </p>
      );
    case "unclaimed":
      return <ClaimForm refusal={standing.refusal && claimRefusal(standing.refusal)} onClaim={connection.claim} />;
    case "claimed": {
      const leftOut = standing.leftOut && (standing.rounds.find((round) => round.id === standing.leftOut)?.name ?? "a Round");
      return (
        <div className="standing">
          <p>
            <b>Claimed.</b>
            <span className="dim"> Rounds you add or rename reach the Host console, the Stage and phones at once.</span>
          </p>
          {leftOut && (
            <div role="alert" className="problem">
              <p>
                This Round list leaves out {leftOut}, the Current Round, so the Worker keeps the Round list it had. Put
                another Round on the Stage, then send it again.
              </p>
              <button className="small-button" onClick={connection.sendRounds}>
                Send the Round list again
              </button>
            </div>
          )}
        </div>
      );
    }
  }
}

/** Claims the Competition from prep. The Organizer key leaves the field only in the claim, and is cleared then. */
function ClaimForm({ refusal, onClaim }: { refusal: string | null; onClaim(organizerKey: string): boolean }) {
  const [key, setKey] = useState("");
  const [unsent, setUnsent] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    const sent = onClaim(key.trim());
    setUnsent(!sent);
    if (sent) setKey("");
  };
  return (
    <form className="standing claim" onSubmit={submit}>
      <p>
        <b>Not claimed yet.</b>
        <span className="dim">
          {" "}
          Claim it here or on the Host console. The Organizer key is asked for once and never stored.
        </span>
      </p>
      <div className="link-row">
        <input
          type="password"
          autoComplete="off"
          aria-label="Organizer key"
          value={key}
          placeholder="Organizer key, from whoever runs this Worker"
          onChange={(event) => setKey(event.target.value)}
        />
        <button className="small-button" disabled={!key.trim()}>
          Claim
        </button>
      </div>
      {(unsent || refusal) && (
        <p className="problem" role="alert">
          {unsent ? "Not connected to the Worker. Try again in a moment." : refusal}
        </p>
      )}
    </form>
  );
}

function MintButton({ onMint }: { onMint(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div>
      <button className="link-button danger" onClick={() => dialog.current?.showModal()}>
        Mint new credentials…
      </button>
      <span className="dim"> — only before the Competition is claimed; every package must be re-exported.</span>
      <dialog ref={dialog} aria-labelledby="mint-title">
        <form method="dialog">
          <h3 id="mint-title">Mint new credentials?</h3>
          <p>
            Do this only before the Host claims the Competition. A claimed Join code stays bound to its Host secret for
            good, so new credentials would lock you out of it. Every Round package must be re-exported.
          </p>
          <menu>
            <button value="cancel" autoFocus>
              Cancel
            </button>
            <button value="mint" className="danger" onClick={onMint}>
              Mint new credentials
            </button>
          </menu>
        </form>
      </dialog>
    </div>
  );
}
