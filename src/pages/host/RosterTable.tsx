// A Round's Roster on the Control desk: who has opened the Round's package, whether their
// laptop is connected, and which Revision it runs. An entry stays listed for the rest of the
// Round once it appears, dimmed while offline.

import { isStale, revisionNumber, type Roster, type RosterEntry } from "../../protocol/protocol.ts";

const EMPTY: Roster = { entries: [], newest: null };

/** "4 ready · 1 offline · 1 stale", leaving out what is none, or "nobody yet". */
export function rosterStatus(roster: Roster = EMPTY): string {
  const { entries } = roster;
  if (!entries.length) return "nobody yet";
  const ready = entries.filter((entry) => entry.online).length;
  const stale = entries.filter((entry) => isStale(entry, roster)).length;
  const parts = [`${ready} ready`];
  if (entries.length > ready) parts.push(`${entries.length - ready} offline`);
  if (stale) parts.push(`${stale} stale`);
  return parts.join(" · ");
}

export function RosterTable({ roundName, roster = EMPTY }: { roundName: string; roster?: Roster }) {
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
          </tr>
        </thead>
        <tbody>
          {roster.entries.map((entry) => (
            <tr key={entry.seat} className={entry.online ? "" : "off"}>
              <td className="connection">
                <span
                  className={`dot ${entry.online ? "" : "off"}`}
                  role="img"
                  aria-label={entry.online ? "Connected" : "Offline"}
                  title={entry.online ? "Connected" : "Offline"}
                />
              </td>
              <td className="name">{entry.name}</td>
              <td>
                <Revision entry={entry} roster={roster} />
              </td>
            </tr>
          ))}
          {!roster.entries.length && (
            <tr>
              <td colSpan={3} className="muted">
                Nobody has opened {roundName} yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function Revision({ entry, roster }: { entry: RosterEntry; roster: Roster }) {
  const rev = `Rev ${revisionNumber(entry.revision)}`;
  if (!isStale(entry, roster)) return <span className="muted">{rev}</span>;
  return (
    <span className="chip stale" title="Older than the newest Revision seen for this Round">
      ⚠ {rev} · newest is Rev {revisionNumber(roster.newest!)}
    </span>
  );
}
