import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { connectSocket, type Socket } from "../../enhancement/socket.ts";
import {
  decodeClaim,
  socketPath,
  V,
  type Claim,
  type ClaimRefusal,
  type CompetitionSummary,
  type Lifecycle,
  type LifecycleCommand,
  type ServerMessage,
} from "../../protocol/protocol.ts";
import { sameOriginSocket } from "../links.ts";
import { maskSecret, VersionFooter } from "../shared.tsx";
import { ControlDesk } from "./ControlDesk.tsx";

/** What the Worker has said about this Competition so far. */
type Standing =
  | { kind: "unknown" }
  | { kind: "unclaimed" }
  | { kind: "refused" }
  | { kind: "claimed"; competition: CompetitionSummary; lifecycle: Lifecycle };

const REFUSALS: Record<ClaimRefusal, string> = {
  "organizer-key": "That Organizer key is wrong.",
  "no-organizer-key": "This Worker has no Organizer key set, so nothing can be claimed. Set the ORGANIZER_KEY secret on the Worker.",
  claimed:
    "This Join code is already claimed with another Host secret. Use the Host console link of the Competition that claimed it.",
  invalid: "This link's claim is incomplete. Copy the Host console link from the prep page again.",
};

export function HostConsole() {
  const [claim] = useState(() => decodeClaim(location.hash));
  if (!claim) {
    return (
      <Notice title="This Host console link is incomplete">
        Copy the Host console link again from the Audience pane of the prep page. Everything the claim needs is in the
        link, after the #.
      </Notice>
    );
  }
  return <ConnectedConsole claim={claim} />;
}

/** The console once it has a claim: connects to the Worker and shows what the Worker says. */
function ConnectedConsole({ claim }: { claim: Claim }) {
  const [online, setOnline] = useState(false);
  const [standing, setStanding] = useState<Standing>({ kind: "unknown" });
  const [refusal, setRefusal] = useState<string | null>(null);
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    const connection = connectSocket(sameOriginSocket(socketPath(claim.joinCode, "host")), {
      open() {
        setOnline(true);
        connection.send({ v: V, t: "host", hostSecret: claim.hostSecret });
      },
      down: () => setOnline(false),
      message(data) {
        const message = data as ServerMessage;
        switch (message?.t) {
          case "unclaimed":
            return setStanding({ kind: "unclaimed" });
          case "host-refused":
            return setStanding({ kind: "refused" });
          case "competition":
            setRefusal(null);
            return setStanding({ kind: "claimed", competition: message.competition, lifecycle: message.lifecycle });
          case "lifecycle":
            return setStanding((was) => (was.kind === "claimed" ? { ...was, lifecycle: message.lifecycle } : was));
          case "claim-refused":
            return setRefusal(REFUSALS[message.reason] ?? REFUSALS.invalid);
        }
      },
    });
    socket.current = connection;
    return () => connection.close();
  }, [claim]);

  const sendClaim = (organizerKey: string) => {
    const sent = socket.current?.send({ v: V, t: "claim", organizerKey, claim });
    setRefusal(sent ? null : "Not connected to the Worker. Try again in a moment.");
  };

  // Sent now or dropped: a command must never land late. A refused one changes nothing, and the
  // console already shows the Worker's lifecycle.
  const sendCommand = (command: LifecycleCommand) => socket.current?.send({ v: V, ...command }) ?? false;

  switch (standing.kind) {
    case "unknown":
      return <Notice title="Connecting to the Worker…">{online ? "Waiting for the Worker to answer." : null}</Notice>;
    case "refused":
      return (
        <Notice title="This Competition belongs to another Host console link">
          Join code {claim.joinCode} was claimed with a different Host secret. Use the Host console link from the
          Competition file that claimed it.
        </Notice>
      );
    case "unclaimed":
      return <ClaimScreen claim={claim} online={online} refusal={refusal} onClaim={sendClaim} />;
    case "claimed":
      return (
        <ControlDesk
          competition={standing.competition}
          lifecycle={standing.lifecycle}
          online={online}
          send={sendCommand}
        />
      );
  }
}

function ClaimScreen(props: { claim: Claim; online: boolean; refusal: string | null; onClaim(key: string): void }) {
  const { claim, online, refusal, onClaim } = props;
  const [key, setKey] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (key.trim()) onClaim(key.trim());
  };
  return (
    <div className="host">
      <form className="claim" onSubmit={submit}>
        <h2>Claim this Competition</h2>
        <p className="muted">
          This Host console link carries everything the claim needs. The Organizer key is asked for once and never
          stored.
        </p>
        <dl aria-label="What the link carries">
          <dt>Competition</dt>
          <dd>{claim.competitionName || <i>unnamed</i>}</dd>
          <dt>Join code</dt>
          <dd className="mono">{claim.joinCode}</dd>
          <dt>Rounds</dt>
          <dd>{claim.rounds.map((round) => round.name).join(", ") || <i>none</i>}</dd>
          <dt>Host secret</dt>
          <dd className="mono">{maskSecret(claim.hostSecret)}</dd>
          <dt>Contestant token</dt>
          <dd className="mono">{maskSecret(claim.contestantToken)}</dd>
        </dl>
        <label>
          Organizer key
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder="from whoever runs this Worker"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        {refusal && (
          <p className="err" role="alert">
            {refusal}
          </p>
        )}
        <button className="btn primary" disabled={!online || !key.trim()}>
          Claim
        </button>
        <p className="muted small">
          Once claimed, Join code {claim.joinCode} belongs to this link's Host secret for good.
        </p>
      </form>
      <VersionFooter className="version" />
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="host">
      <div className="claim">
        <h2>{title}</h2>
        {children && <p className="muted">{children}</p>}
      </div>
      <VersionFooter className="version" />
    </div>
  );
}
