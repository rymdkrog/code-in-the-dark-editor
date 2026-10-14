import { useEffect, useId, useReducer, useRef, useState } from "react";
import { fillTemplate } from "../../round-package/fill-template.ts";
import {
  addRound,
  changedRounds,
  competitionFile,
  competitionFileName,
  isUntouched,
  fileNameClash,
  mintRoundId,
  newCompetition,
  nextRevision,
  roundData,
  roundStatus,
  packageFileName,
  parseCompetitionFile,
  updateRound,
  type Competition,
  type Revision,
  type Round,
} from "./competition.ts";
import { download, fetchTemplate } from "./files.ts";
import { RoundView, StatusLabel } from "./RoundView.tsx";
import { loadCompetition, saveCompetition } from "./store.ts";

declare const __EDITOR_VERSION__: string;

type Action =
  | { type: "rename-competition"; name: string }
  | { type: "set-rules"; rules: string }
  | { type: "add-round"; kind: Round["kind"]; id: string }
  | { type: "change-round"; id: string; change: (round: Round) => Round }
  | { type: "replace"; competition: Competition };

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
    case "replace":
      return action.competition;
  }
}

export function PrepPage() {
  const [competition, dispatch] = useReducer(reducer, undefined, newCompetition);
  // The Round on show, or null for the Competition pane.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const template = useTemplate();
  const storage = useBrowserStorage(competition, (stored) => dispatch({ type: "replace", competition: stored }));
  const round = competition.rounds.find((candidate) => candidate.id === selectedId);
  const hasFinal = competition.rounds.some((candidate) => candidate.kind === "final");
  // A Competition the Organizer is opening or starting, while they're offered to save this one first.
  const [replacement, setReplacement] = useState<Competition | null>(null);
  const [openProblem, setOpenProblem] = useState<string | null>(null);

  const add = (kind: Round["kind"]) => {
    const id = mintRoundId();
    dispatch({ type: "add-round", kind, id });
    setSelectedId(id);
  };

  const changed = changedRounds(competition);
  const clashing = competition.rounds.some((candidate) => fileNameClash(competition, candidate));

  const exportRounds = (rounds: Round[]) => {
    if (typeof template !== "string") return;
    const now = new Date();
    for (const round of rounds) {
      const revision = nextRevision(competition, round, now);
      const html = fillTemplate(template, roundData(competition, round, revision, __EDITOR_VERSION__));
      download(packageFileName(competition, round), html);
      dispatch({ type: "change-round", id: round.id, change: recordRevision(revision) });
    }
  };

  const saveFile = () => download(competitionFileName(competition), competitionFile(competition), "application/json");

  const replace = (next: Competition) => {
    dispatch({ type: "replace", competition: next });
    setSelectedId(null);
    setReplacement(null);
  };
  // Replacing loses the Competition in this browser, so offer to save it first, unless it's untouched.
  const offerToReplace = (next: Competition) =>
    isUntouched(competition) ? replace(next) : setReplacement(next);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const opened = parseCompetitionFile(await file.text());
    setOpenProblem(opened ? null : `${file.name} isn't a Competition file.`);
    if (opened) offerToReplace(opened);
  };

  // Nothing to edit until the Competition saved in this browser is back.
  if (storage === "loading") return null;

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
            <StatusLabel status={roundStatus(competition, candidate)} />
          </button>
        ))}
        <div className="add-row">
          <button onClick={() => add("heat")}>+ Heat</button>
          <button onClick={() => add("final")} disabled={hasFinal}>
            + Final
          </button>
        </div>
        <button
          className="go export-changed"
          onClick={() => exportRounds(changed)}
          disabled={!changed.length || clashing || typeof template !== "string"}
        >
          Export {changed.length} changed
        </button>
        {clashing && (
          <p className="problem sidebar-note" role="alert">
            Two Rounds would export to the same file name. Rename one of them to export.
          </p>
        )}
        <div className="foot">
          <button onClick={saveFile}>Save Competition file</button>
          <div className="file-row">
            <label className="button">
              Open…
              <input
                className="visually-hidden"
                type="file"
                accept=".json,application/json"
                aria-label="Open a Competition file"
                onChange={(event) => {
                  openFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <button onClick={() => offerToReplace(newCompetition())}>New Competition</button>
          </div>
          {openProblem && (
            <p className="problem" role="alert">
              {openProblem}
            </p>
          )}
          {storage instanceof Error ? (
            <p className="problem" role="alert">
              Couldn't save in this browser ({storage.message}).
            </p>
          ) : (
            <p className="dim">{storage === "saved" ? "Saved in this browser" : "Saving…"}</p>
          )}
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
            onExport={() => exportRounds([round])}
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
      {replacement && (
        <ReplaceDialog
          name={competition.name}
          onSaveFirst={() => {
            saveFile();
            replace(replacement);
          }}
          onReplace={() => replace(replacement)}
          onCancel={() => setReplacement(null)}
        />
      )}
    </div>
  );
}

interface ReplaceDialogProps {
  name: string;
  onSaveFirst(): void;
  onReplace(): void;
  onCancel(): void;
}

/** Offers to save the Competition as a file before another one replaces it in this browser. */
function ReplaceDialog({ name, onSaveFirst, onReplace, onCancel }: ReplaceDialogProps) {
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="replace"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={heading}>Replace “{name || "this Competition"}”?</h2>
      <p>
        It's kept only in this browser, so replacing it loses it. Save it as a Competition file first to keep a copy
        you can open again.
      </p>
      <div className="actions">
        <button className="go" onClick={onSaveFirst}>
          Save Competition file first
        </button>
        <button onClick={onReplace}>Replace without saving</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}

const recordRevision = (revision: Revision) => (round: Round) => ({
  ...round,
  revisions: [...round.revisions, revision],
});

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * Loads the Competition saved in this browser, then saves every change back to it shortly after
 * the change. Leaving the page starts the save at once, though the browser may not let it finish.
 */
function useBrowserStorage(
  competition: Competition,
  replace: (stored: Competition) => void,
): "loading" | "saving" | "saved" | Error {
  const [loaded, setLoaded] = useState(false);
  // Saving after a failed load could write over a Competition that's still there, so it never does.
  const [loadFailure, setLoadFailure] = useState<Error | null>(null);
  const [saved, setSaved] = useState<Competition | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  // Once, on the first render. `replace` is a new function every render, but always does the same.
  useEffect(() => {
    loadCompetition().then(
      (stored) => {
        if (stored) {
          replace(stored);
          setSaved(stored);
        }
        setLoaded(true);
      },
      (error: unknown) => {
        setLoadFailure(asError(error));
        setLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    if (!loaded || loadFailure || competition === saved) return;
    const save = () =>
      saveCompetition(competition).then(
        () => {
          setSaved(competition);
          setFailure(null);
        },
        (error: unknown) => setFailure(asError(error)),
      );
    const timer = setTimeout(save, 300);
    addEventListener("pagehide", save);
    return () => {
      clearTimeout(timer);
      removeEventListener("pagehide", save);
    };
  }, [loaded, loadFailure, competition, saved]);

  if (!loaded) return "loading";
  const problem = loadFailure ?? failure;
  if (problem) return problem;
  return competition === saved ? "saved" : "saving";
}

/** The Core Editor template once it has loaded, or the Error that stopped it. */
function useTemplate(): string | Error | null {
  const [template, setTemplate] = useState<string | Error | null>(null);
  useEffect(() => {
    fetchTemplate().then(setTemplate, (error: unknown) => setTemplate(asError(error)));
  }, []);
  return template;
}
