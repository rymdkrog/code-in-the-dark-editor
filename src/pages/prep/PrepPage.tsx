import { useEffect, useReducer, useState } from "react";
import { fillTemplate } from "../../round-package/fill-template.ts";
import {
  addRound,
  mintRoundId,
  newCompetition,
  nextRevision,
  roundData,
  packageFileName,
  updateRound,
  type Competition,
  type Revision,
  type Round,
} from "./competition.ts";
import { download, fetchTemplate } from "./files.ts";
import { RoundView } from "./RoundView.tsx";

declare const __EDITOR_VERSION__: string;

type Action =
  | { type: "rename-competition"; name: string }
  | { type: "set-rules"; rules: string }
  | { type: "add-round"; kind: Round["kind"]; id: string }
  | { type: "change-round"; id: string; change: (round: Round) => Round };

function reducer(competition: Competition, action: Action): Competition {
  switch (action.type) {
    case "rename-competition":
      return { ...competition, name: action.name };
    case "set-rules":
      return { ...competition, rules: action.rules };
    case "add-round":
      return addRound(competition, action.kind, action.id);
    case "change-round":
      return updateRound(competition, action.id, action.change);
  }
}

export function PrepPage() {
  const [competition, dispatch] = useReducer(reducer, undefined, newCompetition);
  // The Round on show, or null for the Competition pane.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const template = useTemplate();
  const round = competition.rounds.find((candidate) => candidate.id === selectedId);
  const hasFinal = competition.rounds.some((candidate) => candidate.kind === "final");

  const add = (kind: Round["kind"]) => {
    const id = mintRoundId();
    dispatch({ type: "add-round", kind, id });
    setSelectedId(id);
  };

  const exportRound = (round: Round) => {
    if (typeof template !== "string") return;
    const revision = nextRevision(round, new Date());
    const html = fillTemplate(template, roundData(competition, round, revision, __EDITOR_VERSION__));
    download(packageFileName(competition, round), html);
    dispatch({ type: "change-round", id: round.id, change: recordRevision(revision) });
  };

  return (
    <div className="workbench">
      <aside>
        <label className="brand">
          <span className="visually-hidden">Competition name</span>
          <input
            value={competition.name}
            placeholder="Competition name"
            onChange={(event) => dispatch({ type: "rename-competition", name: event.target.value })}
          />
          <span className="dim">Organizer prep</span>
        </label>
        <button
          className={`nav ${selectedId === null ? "on" : ""}`}
          onClick={() => setSelectedId(null)}
        >
          <span>⚙ Competition</span>
          <span className="sub">rules</span>
        </button>
        <div className="group">Rounds</div>
        {competition.rounds.map((candidate) => (
          <button
            key={candidate.id}
            className={`nav ${selectedId === candidate.id ? "on" : ""}`}
            onClick={() => setSelectedId(candidate.id)}
          >
            <span>{candidate.name || <i>unnamed</i>}</span>
            <span className="sub">
              {candidate.reference ? "✓" : "✗"} Reference · {candidate.assets.length} assets
            </span>
          </button>
        ))}
        <div className="add-row">
          <button onClick={() => add("heat")}>+ Heat</button>
          <button onClick={() => add("final")} disabled={hasFinal}>
            + Final
          </button>
        </div>
      </aside>
      <main>
        {template instanceof Error && <p className="problem">{template.message}</p>}
        {round ? (
          <RoundView
            key={round.id}
            competition={competition}
            round={round}
            templateSize={typeof template === "string" ? template.length : null}
            onChange={(change) => dispatch({ type: "change-round", id: round.id, change })}
            onExport={() => exportRound(round)}
          />
        ) : (
          <section className="pane">
            <h2>Competition</h2>
            <label className="field">
              Rules
              <span className="dim"> — shown to every Contestant above the Round's assets. Plain text.</span>
              <textarea
                value={competition.rules}
                onChange={(event) => dispatch({ type: "set-rules", rules: event.target.value })}
              />
            </label>
          </section>
        )}
      </main>
    </div>
  );
}

const recordRevision = (revision: Revision) => (round: Round) => ({
  ...round,
  revisions: [...round.revisions, revision],
});

/** The Core Editor template once it has loaded, or the Error that stopped it. */
function useTemplate(): string | Error | null {
  const [template, setTemplate] = useState<string | Error | null>(null);
  useEffect(() => {
    fetchTemplate().then(setTemplate, (error: unknown) =>
      setTemplate(error instanceof Error ? error : new Error(String(error))),
    );
  }, []);
  return template;
}
