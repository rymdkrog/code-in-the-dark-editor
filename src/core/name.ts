import type { RoundData } from "../round-package/round-data.ts";

// The one key that isn't Round-prefixed: the name belongs to the laptop, so it carries from
// Heat to Final wherever the browser shares storage.
const NAME_KEY = "citd:name";

/** Shows the name badge, asking for the name first if this laptop has none. */
export function startNameBadge(round: RoundData, editor: { focus(): void }) {
  const badge = document.querySelector<HTMLButtonElement>(".name-badge")!;
  const dialog = document.querySelector<HTMLDialogElement>(".name-dialog")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  dialog.querySelector(".name-dialog-round")!.textContent = round.roundName;

  let name: string | null = null;
  const setName = (newName: string) => {
    name = newName;
    badge.textContent = `${newName} · ${round.roundName}`;
    badge.hidden = false;
  };

  // The form won't submit while the name is invalid, and the browser says why.
  const validate = () => input.setCustomValidity(isName(input.value.trim()) ? "" : "Type your name");
  input.addEventListener("input", validate);
  validate();

  dialog.addEventListener("submit", () => {
    const newName = input.value.trim();
    saveName(newName);
    setName(newName);
  });
  // Until there's a name the dialog is required. Chromium closes it on a second Esc even when
  // the first was refused, so a close without a name opens it again.
  dialog.addEventListener("cancel", (event) => {
    if (!name) event.preventDefault();
  });
  dialog.addEventListener("close", () => (name ? editor.focus() : dialog.showModal()));

  badge.addEventListener("click", () => {
    input.value = name ?? "";
    validate();
    dialog.showModal();
  });

  const saved = loadName();
  if (saved) setName(saved);
  else dialog.showModal();
}

// Storage can be off or full. Without it the name lasts until the page closes.
function loadName(): string | null {
  try {
    const name = localStorage.getItem(NAME_KEY)?.trim() ?? "";
    return isName(name) ? name : null;
  } catch {
    return null;
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Asked again next time.
  }
}

// "null" is what the original saved when the name prompt was cancelled.
const isName = (name: string) => name !== "" && name !== "null";
