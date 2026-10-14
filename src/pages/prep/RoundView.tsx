import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { instructionsContent } from "../../core/instructions.ts";
import {
  addColour,
  assetNameProblem,
  estimatedPackageBytes,
  fileBytes,
  formatRevision,
  isOversized,
  packageFileName,
  roundInstructions,
  roundStatus,
  sortOriginalDist,
  statusLabel,
  type Asset,
  type Colour,
  type Competition,
  type Round,
  type RoundStatus,
} from "./competition.ts";
import { fileType, pixelColour, readAsset } from "./files.ts";

interface Props {
  competition: Competition;
  round: Round;
  /** The template's size, once it has loaded; export waits for it. */
  templateSize: number | null;
  onChange(change: (round: Round) => Round): void;
  onExport(): void;
}

export function RoundView({ competition, round, templateSize, onChange, onExport }: Props) {
  const [problem, setProblem] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const [colourProblem, setColourProblem] = useState<string | null>(null);
  const status = roundStatus(competition, round);
  const oversized = (round.reference ? [round.reference, ...round.assets] : round.assets).filter(isOversized);
  const packageSize = templateSize === null ? null : estimatedPackageBytes(competition, round, templateSize);

  const setReference = async (file: File | undefined) => {
    if (!file) return;
    const reference = fileType(file).startsWith("image/") ? await readAsset(file) : null;
    if (!reference?.width) {
      setProblem(`${file.name} isn't an image. The Reference is a screenshot of the page to recreate.`);
      return;
    }
    setProblem(null);
    onChange((round) => ({ ...round, reference }));
  };

  const addAssets = async (dropped: File[]) => {
    const { assets, refused } = await readAssets(round.assets, dropped);
    setRefusals(refused);
    onChange((round) => ({ ...round, assets: sortByName([...round.assets, ...assets]) }));
  };

  // Replaces the Reference and the assets, as if the Round started from that challenge.
  const importOriginalDist = async (files: File[]) => {
    // Each path starts with the chosen folder's own name.
    const byPath = new Map(files.map((file) => [file.webkitRelativePath.replace(/^[^/]*\//, ""), file]));
    const sorted = sortOriginalDist([...byPath.keys()]);
    const page = sorted.reference === null ? undefined : byPath.get(sorted.reference);
    if (!page) {
      setImportNotices([]);
      setProblem("That folder has no page.png. Choose the original editor's dist/ folder.");
      return;
    }
    const reference = await readAsset(page);
    const { assets, refused } = await readAssets([], sorted.assets.map((path) => byPath.get(path)!));
    setProblem(null);
    setRefusals(refused);
    setImportNotices(
      sorted.hasInstructions
        ? ["instructions.html isn't imported: type the Round note and colours here instead."]
        : [],
    );
    onChange((round) => ({ ...round, reference, assets: sortByName(assets) }));
  };

  const pickColour = (text: string) => {
    const added = addColour(round, text);
    setColourProblem("problem" in added ? added.problem : null);
    if ("problem" in added) return false;
    // Added again to the latest Round, in case another change is still on its way.
    onChange((round) => {
      const latest = addColour(round, text);
      return "round" in latest ? latest.round : round;
    });
    return true;
  };

  const removeAsset = (name: string) =>
    onChange((round) => ({ ...round, assets: round.assets.filter((asset) => asset.name !== name) }));

  return (
    <>
      <div className="topbar">
        <label>
          <span className="visually-hidden">Round name</span>
          <input
            className="round-name"
            value={round.name}
            onChange={(event) => onChange((round) => ({ ...round, name: event.target.value }))}
          />
        </label>
        <span className="file">
          {packageFileName(competition, round)}
          {packageSize !== null && ` · ≈ ${formatBytes(packageSize)}`}
        </span>
        <StatusLabel status={status} />
        <button className="go" onClick={onExport} disabled={status.kind === "problem" || templateSize === null}>
          {round.revisions.length ? "Re-export" : "Export"}
        </button>
      </div>
      {status.kind === "problem" && (
        <Notices className="problem topbar-problems" notices={status.problems} />
      )}
      <div className="work">
        <section>
          <h3>Reference</h3>
          <DropZone onDrop={(files) => setReference(files[0])}>
            {round.reference ? (
              <div className="reference">
                <img
                  src={round.reference.dataUri}
                  alt="Reference"
                  title="Click to add this colour"
                  onClick={(event) => {
                    const image = event.currentTarget;
                    const scale = image.naturalWidth / image.clientWidth;
                    const { offsetX, offsetY } = event.nativeEvent;
                    pickColour(pixelColour(image, Math.floor(offsetX * scale), Math.floor(offsetY * scale)));
                  }}
                />
              </div>
            ) : (
              <div className="drop big">Drop the Reference screenshot here</div>
            )}
          </DropZone>
          <label className="link">
            {round.reference ? "Replace the Reference…" : "or choose a file…"}
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              aria-label="Choose a Reference"
              onChange={(event) => {
                setReference(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <label className="link">
            Import original dist/ folder…
            <input
              className="visually-hidden"
              type="file"
              // Not in React's types: lets the Organizer choose a whole folder.
              {...{ webkitdirectory: "" }}
              aria-label="Import original dist/ folder"
              onChange={(event) => {
                importOriginalDist([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
          </label>
          {problem && (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
          <Notices className="warn" notices={importNotices} />
        </section>
        <section>
          <ContestantView competition={competition} round={round} />
          <label className="field">
            Round note
            <span className="dim"> — optional hints for this Round only. Plain text.</span>
            <textarea
              className="note"
              value={round.note}
              placeholder="Nav links don't need hover states."
              onChange={(event) => onChange((round) => ({ ...round, note: event.target.value }))}
            />
          </label>
          <h3 id="colours">Colours</h3>
          <ColourList
            colours={round.colours}
            onLabel={(hex, label) =>
              onChange((round) => ({
                ...round,
                colours: round.colours.map((colour) => (colour.hex === hex ? { ...colour, label } : colour)),
              }))
            }
            onRemove={(hex) =>
              onChange((round) => ({ ...round, colours: round.colours.filter((colour) => colour.hex !== hex) }))
            }
          />
          <ColourInput onAdd={pickColour} />
          {colourProblem && (
            <p className="problem" role="alert">
              {colourProblem}
            </p>
          )}
          <h3>Assets</h3>
          <AssetTable assets={round.assets} onRemove={removeAsset} />
          <DropZone onDrop={addAssets}>
            <label className="drop">
              Drop assets here (images, fonts…), or click to choose
              <input
                className="visually-hidden"
                type="file"
                multiple
                aria-label="Add assets"
                onChange={(event) => {
                  addAssets([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
            </label>
          </DropZone>
          <Notices className="problem" role="alert" notices={refusals} />
          <Notices
            className="warn"
            notices={oversized.map((file) => `${file.name} is over 32 MB inside the package, so Firefox ESR can't load it.`)}
          />
          <RevisionHistory round={round} />
        </section>
      </div>
    </>
  );
}

/** The name badge above the Instructions sheet, rendered by the Core Editor's own code. */
function ContestantView({ competition, round }: { competition: Competition; round: Round }) {
  const sheet = useRef<HTMLElement>(null);
  const instructions = roundInstructions(competition, round);
  // Redrawn only when what it shows changes, so a selection in it survives other edits.
  useEffect(() => {
    sheet.current!.replaceChildren(...instructionsContent(instructions));
  }, [competition.rules, round.note, round.colours, round.assets]);
  return (
    <section className="contestant-view" aria-label="What the Contestant sees">
      <h3>What the Contestant sees</h3>
      <div className="badge">Anna · {round.name}</div>
      <section className="instructions-panel" aria-label="Instructions" ref={sheet} />
    </section>
  );
}

function ColourList(props: { colours: Colour[]; onLabel(hex: string, label: string): void; onRemove(hex: string): void }) {
  if (!props.colours.length) return <p className="dim">No colours yet. Click the Reference to pick one.</p>;
  return (
    <ul className="colours" aria-labelledby="colours">
      {props.colours.map(({ hex, label }) => (
        <li key={hex}>
          <span className="swatch" style={{ backgroundColor: hex }} />
          <span className="mono">{hex}</span>
          <input
            value={label}
            placeholder="label"
            aria-label={`Label for ${hex}`}
            onChange={(event) => props.onLabel(hex, event.target.value)}
          />
          <button className="remove" aria-label={`Remove ${hex}`} onClick={() => props.onRemove(hex)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Takes `#RGB` or `#RRGGBB` on Enter, and clears once the colour is in the list. */
function ColourInput({ onAdd }: { onAdd(text: string): boolean }) {
  const [text, setText] = useState("");
  return (
    <input
      className="colour-input mono"
      value={text}
      placeholder="#RRGGBB, then Enter"
      aria-label="Add a colour"
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && text.trim() && onAdd(text)) setText("");
      }}
    />
  );
}

function AssetTable({ assets, onRemove }: { assets: Asset[]; onRemove(name: string): void }) {
  if (!assets.length) return <p className="dim">No assets yet.</p>;
  return (
    <table className="assets" aria-label="Assets">
      <tbody>
        {assets.map((asset) => (
          <tr key={asset.name}>
            <td>{asset.width !== null && <img src={asset.dataUri} alt="" />}</td>
            <td className="mono">{asset.name}</td>
            <td>{asset.width === null ? "—" : `${asset.width} × ${asset.height}`}</td>
            <td className="dim">{formatBytes(fileBytes(asset))}</td>
            <td>{isOversized(asset) && <span className="chip warn">over 32 MB</span>}</td>
            <td>
              <button className="remove" aria-label={`Remove ${asset.name}`} onClick={() => onRemove(asset.name)}>
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATUS_CLASSES: Record<RoundStatus["kind"], string> = {
  problem: "problem",
  "not exported": "needs-export",
  changed: "needs-export",
  exported: "exported",
};

/** Whether a Round has a problem, still needs exporting, or is up to date. */
export function StatusLabel({ status }: { status: RoundStatus }) {
  return (
    <span
      className={`status ${STATUS_CLASSES[status.kind]}`}
      title={"last" in status ? `Last exported: ${formatRevision(status.last)} UTC` : undefined}
    >
      {statusLabel(status)}
    </span>
  );
}

/** Every export of the Round, newest first, under the id that ties them together. */
function RevisionHistory({ round }: { round: Round }) {
  const heading = useId();
  return (
    <section className="revisions" aria-labelledby={heading}>
      <h3 id={heading}>Revisions</h3>
      <p className="dim">
        Round id <code>{round.id}</code>, kept across re-exports so Contestants' autosave carries over.
      </p>
      {round.revisions.length ? (
        <ol reversed>
          {[...round.revisions].reverse().map((revision) => (
            <li key={revision.n}>{formatRevision(revision)}</li>
          ))}
        </ol>
      ) : (
        <p className="dim">Not exported yet.</p>
      )}
    </section>
  );
}

function Notices({ notices, className, role }: { notices: string[]; className: string; role?: "alert" }) {
  if (!notices.length) return null;
  return (
    <ul className={`notices ${className}`} role={role}>
      {notices.map((notice) => (
        <li key={notice}>{notice}</li>
      ))}
    </ul>
  );
}

/** Takes files dragged onto it from the desktop. */
function DropZone({ onDrop, children }: { onDrop(files: File[]): void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop-zone ${over ? "over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop([...event.dataTransfer.files]);
      }}
    >
      {children}
    </div>
  );
}

/** Reads the files whose names can join the assets already taken, and says why the others can't. */
async function readAssets(taken: Asset[], files: File[]) {
  const refused: string[] = [];
  const accepted: File[] = [];
  for (const file of files) {
    // Checked against this batch too, so two clashing files added together can't both get in.
    const refusal = assetNameProblem([...taken, ...accepted].map((other) => other.name), file.name);
    if (refusal) refused.push(refusal);
    else accepted.push(file);
  }
  return { assets: await Promise.all(accepted.map((file) => readAsset(file))), refused };
}

const sortByName = (assets: Asset[]) => assets.sort((a, b) => a.name.localeCompare(b.name));

const MB = 1024 * 1024;

const formatBytes = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
