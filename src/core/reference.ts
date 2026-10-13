/** The Reference thumbnail at the bottom right, which a click toggles full screen. */
export function setUpReference(reference: string, editor: { focus(): void }) {
  const container = document.querySelector<HTMLElement>(".reference")!;
  container.querySelector("img")!.src = reference;
  container.hidden = false;

  const toggle = () => {
    container.classList.toggle("open");
    if (!container.classList.contains("open")) editor.focus();
  };
  container.addEventListener("click", toggle);
  return { toggle };
}
