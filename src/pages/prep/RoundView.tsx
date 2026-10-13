import { useState, type ReactNode } from "react";
import {
  assetNameProblem,
  DATA_URI_LIMIT,
  formatRevision,
  packageFileName,
  type Asset,
  type Competition,
  type Round,
} from "./competition.ts";
import { readAsset } from "./files.ts";

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
  const last = round.revisions.at(-1);
  const files = round.reference ? [round.reference, ...round.assets] : round.assets;
  const packageSize =
    templateSize === null
      ? null
      : templateSize + competition.rules.length + files.reduce((sum, file) => sum + file.dataUri.length, 0);

  const setReference = async (file: File | undefined) => {
    if (!file) return;
    const reference = file.type.startsWith("image/") ? await readAsset(file) : null;
    if (!reference?.width) {
      setProblem(`${file.name} isn't an image. The Reference is a screenshot of the page to recreate.`);
      return;
    }
    setProblem(null);
    onChange((round) => ({ ...round, reference }));
  };

  const addAssets = async (files: File[]) => {
    const refused: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      // Checked against this batch too, so two clashing files added together can't both get in.
      const taken = [...round.assets, ...accepted.map((file) => ({ name: file.name }) as Asset)];
      const problem = assetNameProblem({ ...round, assets: taken }, file.name);
      if (problem) refused.push(problem);
      else accepted.push(file);
    }
    setRefusals(refused);
    const assets = await Promise.all(accepted.map((file) => readAsset(file)));
    onChange((round) => ({
      ...round,
      assets: [...round.assets, ...assets].sort((a, b) => a.name.localeCompare(b.name)),
    }));
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
        {last && (
          <span className="chip" title="Exported at this time, UTC">
            {formatRevision(last)}
          </span>
        )}
        <button className="go" onClick={onExport} disabled={!round.reference || templateSize === null}>
          {last ? "Re-export" : "Export"}
        </button>
      </div>
      <div className="work">
        <section>
          <h3>Reference</h3>
          <DropZone onDrop={(files) => setReference(files[0])}>
            {round.reference ? (
              <div className="reference">
                <img src={round.reference.dataUri} alt="Reference" />
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
          {problem && (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
        </section>
        <section>
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
            notices={files
              .filter(isOversized)
              .map((file) => `${file.name} is over 32 MB inside the package, so Firefox ESR can't load it.`)}
          />
        </section>
      </div>
    </>
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

/** Firefox ESR's limit is on the data: URI, which base64 makes a third bigger than the file. */
const isOversized = (file: Asset) => file.dataUri.length > DATA_URI_LIMIT;

/** The size of the file an asset was read from. */
const fileBytes = (file: Asset) => Math.floor(((file.dataUri.length - file.dataUri.indexOf(",") - 1) * 3) / 4);

const MB = 1024 * 1024;

const formatBytes = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
