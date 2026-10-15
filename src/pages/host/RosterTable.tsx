// A Round's Roster on the Control desk: who has opened the Round's package, whether their
// laptop is connected, and which Revision it runs. An entry stays listed for the rest of the
// Round once it appears, dimmed while offline. The Host adds Contestants by hand below it, and
// removes entries with ✕.

import { useState, type FormEvent } from "react";
import { EMPTY_ROSTER, isByHand, isStale, type Roster, type RosterEntry } from "../../protocol/protocol.ts";
import { revisionNumber } from "../../round-package/revision.ts";

/** "4 ready · 1 offline · 1 by hand · 1 stale", leaving out what is none, or "nobody yet". */
export function rosterStatus(roster: Roster = EMPTY_ROSTER): string {
  const { entries } = roster;
  if (!entries.length) return "nobody yet";
  const ready = entries.filter((entry) => entry.online).length;
  const byHand = entries.filter(isByHand).length;
  const stale = entries.filter((entry) => isStale(entry, roster)).length;
  const parts = [`${ready} ready`];
  if (entries.length - byHand > ready) parts.push(`${entries.length - byHand - ready} offline`);
  if (byHand) parts.push(`${byHand} by hand`);
  if (stale) parts.push(`${stale} stale`);
  return parts.join(" · ");
}

interface Props {
  roundName: string;
  roster?: Roster;
  online: boolean;
  /** Sends the new entry now, or drops it and returns false. */
  onAdd(name: string): boolean;
  onRemove(entry: RosterEntry): void;
}

export function RosterTable({ roundName, roster = EMPTY_ROSTER, online, onAdd, onRemove }: Props) {
  return (
    <section className="roster-section" aria-labelledby="roster-heading">
      <h2 id="roster-heading">
        Roster <span className="status">{rosterStatus(roster)}</span>
      </h2>
      <table className="roster" aria-labelledby="roster-heading">
        <thead>
          <tr>
            <th>
              <span className="visually-hidden">Connection</span>
            </th>
            <th>Name</th>
            <th>Revision</th>
            <th>
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {roster.entries.map((entry) => (
            <tr key={entry.seat} className={entry.online || isByHand(entry) ? "" : "off"}>
              <td className="connection">
                <Connection entry={entry} />
              </td>
              <td className="name">{entry.name}</td>
              <td>
                <Revision entry={entry} roster={roster} />
              </td>
              <td className="remove">
                <button
                  className="x"
                  aria-label={`Remove ${entry.name}`}
                  title="Remove from Roster"
                  disabled={!online}
                  onClick={() => onRemove(entry)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {!roster.entries.length && (
            <tr>
              <td colSpan={4} className="muted">
                Nobody has opened {roundName} yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <AddByHand online={online} onAdd={onAdd} />
    </section>
  );
}

/** A Contestant whose laptop never connects: votable, but no Reactions reach them. */
function AddByHand({ online, onAdd }: Pick<Props, "online" | "onAdd">) {
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && onAdd(name.trim())) setName("");
  };
  return (
    <form className="addrow" onSubmit={submit}>
      <input
        aria-label="Add a Contestant by hand"
        placeholder="Add a Contestant by hand (laptop never connected)"
        value={name}
        disabled={!online}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="btn" disabled={!online || !name.trim()}>
        Add
      </button>
    </form>
  );
}

function Connection({ entry }: { entry: RosterEntry }) {
  const [className, label] = isByHand(entry)
    ? ["hand", "Added by hand: no laptop, votable, no Reactions"]
    : entry.online
      ? ["", "Connected"]
      : ["off", "Offline"];
  return <span className={`dot ${className}`} role="img" aria-label={label} title={label} />;
}

function Revision({ entry, roster }: { entry: RosterEntry; roster: Roster }) {
  if (entry.revision === null) return <span className="chip hand">added by hand</span>;
  const rev = `Rev ${revisionNumber(entry.revision)}`;
  if (!isStale(entry, roster)) return <span className="muted">{rev}</span>;
  return (
    <span className="chip stale" title="Older than the newest Revision seen for this Round">
      ⚠ {rev} · newest is Rev {revisionNumber(roster.newest!)}
    </span>
  );
}
