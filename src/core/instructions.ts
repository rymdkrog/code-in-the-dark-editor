import type { RoundData } from "../round-package/round-data.ts";
import "./instructions.css";

/**
 * The Instructions button and the overlay it toggles. The overlay closes on a click beside
 * its panel; clicks inside leave it open, so its text can be selected and copied.
 */
export function setUpInstructions(round: RoundData, editor: { focus(): void }) {
  const overlay = document.querySelector<HTMLElement>(".instructions")!;
  const panel = overlay.querySelector<HTMLElement>(".instructions-panel")!;
  const button = document.querySelector<HTMLElement>(".instructions-button")!;
  panel.append(...instructionsContent(round));

  const close = () => {
    overlay.hidden = true;
    editor.focus();
  };
  button.addEventListener("click", () => {
    overlay.hidden = false;
    // Out of the editor, so keys go to the overlay: Esc, and copying a selection.
    panel.focus();
  });
  overlay.addEventListener("click", (event) => {
    if (!panel.contains(event.target as Node)) close();
  });
  return { isOpen: () => !overlay.hidden, close };
}

/**
 * What the Instructions sheet shows, for the overlay and for the prep page's preview of it.
 * Built from text nodes only: the Organizer's text is never parsed as HTML.
 */
export function instructionsContent({ instructions, assets }: Pick<RoundData, "instructions" | "assets">): HTMLElement[] {
  const content = [heading("Rules"), element("p", "", instructions.rules)];
  if (instructions.note) content.push(heading("Note"), element("p", "", instructions.note));
  if (instructions.colours.length) {
    content.push(
      heading("Colours"),
      list(
        instructions.colours.map(({ hex, label }) => {
          const swatch = element("span", "swatch", "");
          swatch.style.backgroundColor = hex;
          return [swatch, element("span", "hex", hex), ` ${label}`];
        }),
      ),
    );
  }
  if (assets.length) {
    content.push(
      heading("Assets"),
      // A font has no pixel dimensions.
      list(assets.map(({ name, width, height }) => [width === null ? name : `${name} ${width} × ${height} px`])),
    );
  }
  return content;
}

const heading = (text: string) => element("h2", "", text);

function element(tag: string, className: string, text: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function list(items: (Node | string)[][]) {
  const ul = document.createElement("ul");
  for (const children of items) {
    const li = document.createElement("li");
    li.append(...children);
    ul.append(li);
  }
  return ul;
}
