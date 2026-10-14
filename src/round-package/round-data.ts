// The data a Round package carries in its one data slot,
// `<script type="application/json" id="round">`. Core and Enhancement both parse it.

export interface RoundData {
  competitionName: string;
  /** What the Competition's file names start with, e.g. `gbg26`: already a slug. */
  filePrefix: string;
  roundName: string;
  /** Random, minted once per Round, stable across re-exports. Prefixes every storage key. */
  roundId: string;
  /** Per-Round counter plus a UTC minute stamp, e.g. `3-202610121403`. */
  revision: string;
  /** `version+shortsha` of the editor the package was built from. */
  editorVersion: string;
  shake: boolean;
  instructions: {
    rules: string;
    note: string;
    colours: { hex: string; label: string }[];
  };
  /** The Reference as a data: URI. */
  reference: string;
  /** Pixel dimensions are null for an asset that isn't an image, such as a font. */
  assets: { name: string; width: number | null; height: number | null; dataUri: string }[];
  /** Present only when the Audience layer is on. No Worker URL means pure offline. */
  audience?: {
    workerUrl: string;
    joinCode: string;
    contestantToken: string;
  };
}
