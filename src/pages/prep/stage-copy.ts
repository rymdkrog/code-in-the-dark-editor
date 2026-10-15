// Stage copies: each Round's Reference scaled down to fit the Stage and re-encoded, which prep
// keeps on the Worker while it is connected as the Host. The Worker gives a copy out only while
// its Round is current and voting. Round packages and the Competition file keep the full Reference.

import { STAGE_COPY_LIMIT, type CommandRefusal, type StageCopies } from "../../protocol/protocol.ts";
import { stageCopyFingerprint, type Asset, type Competition } from "./competition.ts";

/** The Stage's frame: a copy is never bigger than it shows. */
const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;
/** What prep aims a copy at, in characters of its data: URI: half the Worker's limit, so a copy
 * is a few hundred kB and goes to the Stage in a moment. */
const TARGET = STAGE_COPY_LIMIT / 2;
const QUALITIES = [0.85, 0.7, 0.5];

/** Why a copy isn't on the Worker: the Worker refused it, or prep couldn't read the Reference. */
export type StageCopyRefusal = CommandRefusal | "unreadable";

/** What prep has told the Worker on this socket, by Round id. */
export interface StageCopySync {
  /** The fingerprint last sent, or null for a clear, that the Worker hasn't confirmed yet. */
  sent: Record<string, string | null>;
  /** The copies that didn't reach the Worker, and why. */
  refusals: Record<string, { fingerprint: string; reason: StageCopyRefusal }>;
}

export interface StageCopyPlan {
  set: { roundId: string; fingerprint: string; reference: Asset }[];
  clear: string[];
}

/**
 * What to send so the Worker holds a copy of each Round's Reference and nothing else, given the
 * fingerprints it holds by Round id. A copy already sent, or refused, isn't sent again until the
 * Reference changes.
 */
export function stageCopyPlan(competition: Competition, held: StageCopies, { sent, refusals }: StageCopySync): StageCopyPlan {
  const withReference = competition.rounds.flatMap(({ id, reference }) => (reference ? [{ id, reference }] : []));
  const set = withReference
    .map(({ id, reference }) => ({ roundId: id, fingerprint: stageCopyFingerprint(reference), reference }))
    .filter(({ roundId, fingerprint }) =>
      ![held[roundId], sent[roundId], refusals[roundId]?.fingerprint].includes(fingerprint),
    );
  const wanted = new Set(withReference.map(({ id }) => id));
  const clear = Object.keys(held).filter((id) => !wanted.has(id) && sent[id] !== null);
  return { set, clear };
}

/** The problem a Round shows when its copy isn't on the Worker. */
export function stageCopyProblem(reason: StageCopyRefusal): string {
  const lead = "The Stage won't show this Reference from the Worker:";
  if (reason === "unreadable") {
    return `${lead} prep couldn't make a Stage copy of it. Drop the Competition file on the Stage instead.`;
  }
  return `${lead} the Worker refused its Stage copy${REFUSAL_WHY[reason]}.`;
}

const REFUSAL_WHY: Record<CommandRefusal, string> = {
  "too-large": " as too big",
  "not-image": ", as it isn't an image",
  invalid: ", as this Round isn't on its Round list yet",
  "host-secret": ", as prep isn't connected as the Host",
  transition: "",
};

/** The Reference scaled down to fit the Stage's 1920×1080 frame, as a WebP (or JPEG, where the
 * browser can't make WebP) data: URI under `TARGET`. */
export async function makeStageCopy(dataUri: string): Promise<string> {
  const image = await loadImage(dataUri);
  let scale = Math.min(1, STAGE_WIDTH / image.naturalWidth, STAGE_HEIGHT / image.naturalHeight);
  for (;;) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (const quality of QUALITIES) {
      const copy = encode(image, width, height, quality);
      if (copy.length <= TARGET) return copy;
    }
    if (width === 1 && height === 1) throw new Error("The Reference won't shrink under the Stage copy's size");
    scale /= 2;
  }
}

function encode(image: HTMLImageElement, width: number, height: number, quality: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, width, height);
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  // JPEG has no transparency: what was see-through comes out white, as on a web page.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => (image.naturalWidth ? resolve(image) : reject(new Error("The Reference has no pixels")));
    image.onerror = () => reject(new Error("The browser can't read the Reference as an image"));
    image.src = src;
  });
}
