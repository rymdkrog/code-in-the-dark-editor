import { formatExportTime, packageFileName, roundStatus, type Competition } from "./competition.ts";
import { StatusLabel } from "./RoundView.tsx";

/** The Organizer pre-event checklist. The README carries a copy: change both together. */
const CHECKLIST: { group: string; items: string[] }[] = [
  {
    group: "Ahead of the day",
    items: [
      "Don't deploy the Worker from the day before.",
      "Optional: send citd-practice.html with the invitation, so Contestants can try their own laptops.",
    ],
  },
  {
    group: "Per laptop, before each Heat",
    items: [
      "Open the Round package where it landed (don't move it), in a normal window, not a private one.",
      "Enter the name and check the badge shows the right Round.",
      "Type a little. Check there's no autosave icon, and that Esc shows the Reference.",
      "Run Reset Round.",
      "Go fullscreen, turn on Do Not Disturb, disable sleep and plug in power.",
    ],
  },
  {
    group: "If Enhancements are on",
    items: [
      "Every seat is on the Host console's Roster, with no stale-Revision flags.",
      "Prep was open with the Audience layer on after the last Reference changed, so the Stage gets each Round's Reference from the Worker. If it wasn't, drop the Competition file on the Stage.",
    ],
  },
  { group: "The room", items: ["Contestants can see the Stage clock from their seats, or a second display faces them."] },
  { group: "Spare laptop", items: ["Every Round package opened and tested on it."] },
];

export function HandoutPane({ competition }: { competition: Competition }) {
  return (
    <section className="pane">
      <h2>Hand out</h2>
      {competition.rounds.length ? (
        <table className="assets" aria-label="Round packages">
          <tbody>
            {competition.rounds.map((round) => {
              const status = roundStatus(competition, round);
              const last = round.revisions.at(-1);
              return (
                <tr key={round.id}>
                  <td className="mono">{packageFileName(competition, round)}</td>
                  <td>
                    <StatusLabel status={status} />
                  </td>
                  {status.kind === "problem" ? (
                    <td className="problem">{status.problems.join(" ")}</td>
                  ) : (
                    <td className="dim" title="Last exported at this time, UTC">
                      {last && formatExportTime(last)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="dim">No Rounds yet.</p>
      )}
      <p className="handout">
        Send each file however suits your venue: USB stick, AirDrop or a chat link. Tell Contestants:{" "}
        <b>open it where it lands, and don't move it.</b> Give the Final only to finalists.
        <br />
        Exporting two or more Rounds at once downloads one zip, for you alone. <b>Unzip it first and hand out the
        .html files inside, never the zip:</b> a package opened from inside a zip runs from a temporary folder, and
        can lose its autosave.
      </p>
      <div>
        <h3>Before the event</h3>
        <ul className="checklist" aria-label="Organizer pre-event checklist">
          {CHECKLIST.map(({ group, items }) => (
            <li key={group}>
              <h4>{group}</h4>
              <ul>
                {items.map((item) => (
                  <li key={item}>
                    <label>
                      <input type="checkbox" /> {item}
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
