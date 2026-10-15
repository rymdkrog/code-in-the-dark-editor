import { useRef } from "react";
import { hostConsoleLink, stageLink } from "../links.ts";
import { CopyButton, maskSecret } from "../shared.tsx";
import { claimOf, workerOrigin, type Audience, type Competition } from "./competition.ts";

interface Props {
  competition: Competition;
  onChange(change: Partial<Audience>): void;
  onMint(): void;
}

export function AudiencePane({ competition, onChange, onMint }: Props) {
  const { audience } = competition;
  const origin = workerOrigin(audience.workerUrl);
  const stage = origin ? stageLink(origin, audience.joinCode, competition.name) : "";
  return (
    <section className="pane">
      <h2>Audience</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={audience.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
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
              value={audience.workerUrl}
              placeholder="https://citd.example.workers.dev"
              onChange={(event) => onChange({ workerUrl: event.target.value })}
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
          {origin && (
            <div className="links">
              <div>
                <b>Host console</b>
                <span className="dim">
                  {" "}
                  — private: it claims the Competition with your Organizer key on first open. Open it again after adding or
                  renaming a Round.
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
