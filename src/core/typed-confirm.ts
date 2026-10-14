/**
 * A dialog that won't submit until a word is typed in its input, as the Reveal asks for "yes".
 * Its Cancel button closes it. Returns what opens it, with the input emptied.
 */
export function typedConfirm(dialog: HTMLDialogElement, word: string, hint: string) {
  const input = dialog.querySelector("input")!;
  // The form won't submit without the word, and the browser says why.
  const validate = () => input.setCustomValidity(input.value.trim().toLowerCase() === word ? "" : hint);
  input.addEventListener("input", validate);
  dialog.querySelector(".dialog-cancel")!.addEventListener("click", () => dialog.close());
  return () => {
    input.value = "";
    validate();
    dialog.showModal();
  };
}
