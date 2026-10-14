/**
 * A dialog that won't submit until a word is typed in its input, as the Reveal asks for "yes".
 * Its Cancel button closes it. Returns what opens it, with the input emptied.
 */
export function typedConfirm(dialog: HTMLDialogElement, word: string, hint: string) {
  const input = dialog.querySelector("input")!;
  const message = dialog.querySelector<HTMLElement>(".dialog-hint")!;
  // Without the word the dialog stays open and says why. In the dialog, not in the browser's own
  // bubble: Firefox's swallows clicks while it shows, so Cancel took a second click.
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    if (input.value.trim().toLowerCase() === word) return;
    event.preventDefault();
    // The dialog's own submit listener (the Reveal, the reset) doesn't hear of it.
    event.stopPropagation();
    message.textContent = hint;
    message.hidden = false;
  });
  input.addEventListener("input", () => (message.hidden = true));
  dialog.querySelector(".dialog-cancel")!.addEventListener("click", () => dialog.close());
  return () => {
    input.value = "";
    message.hidden = true;
    dialog.showModal();
  };
}
