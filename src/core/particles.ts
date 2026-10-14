import type { Ace } from "ace-builds";
import type { Combo } from "./combo.ts";

// The original's constants, verbatim.
const MAX_PARTICLES = 500;
const PARTICLE_NUM_RANGE = [5, 6, 7, 8, 9, 10, 11, 12];
const PARTICLE_GRAVITY = 0.075;
const PARTICLE_SIZE = 8;
const PARTICLE_ALPHA_FADEOUT = 0.96;
const PARTICLE_VELOCITY_RANGE = { x: [-2.5, 2.5], y: [-7, -3.5] } as const;
const PARTICLE_COLORS: Record<string, [number, number, number]> = {
  "text": [255, 255, 255],
  "text.xml": [255, 255, 255],
  "keyword": [0, 221, 255],
  "variable": [0, 221, 255],
  "meta.tag.tag-name.xml": [0, 221, 255],
  "keyword.operator.attribute-equals.xml": [0, 221, 255],
  "constant": [249, 255, 0],
  "constant.numeric": [249, 255, 0],
  "support.constant": [249, 255, 0],
  "string.attribute-value.xml": [249, 255, 0],
  "string.unquoted.attribute-value.html": [249, 255, 0],
  "entity.other.attribute-name.xml": [129, 148, 244],
  "comment": [0, 255, 121],
  "comment.xml": [0, 255, 121],
};
const SPAWN_THROTTLE = 25;

/**
 * The original was tuned at 60 Hz and moved its particles one step per frame, so they ran twice
 * as fast on a 120 Hz screen. Here a step is 1/60 s of elapsed time, whatever the frame rate.
 */
const STEP = 1000 / 60;
/** At most this much time passes in one frame, so a stalled or hidden tab doesn't jump. */
const MAX_FRAME_TIME = 100;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  colour: string;
}

const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);

/**
 * Power Mode's particles: squares thrown from the caret, coloured by the code under it, that fall
 * and fade. The animation runs only while particles are live, so an idle editor draws nothing.
 */
export function startParticles(editor: Ace.Editor, { isPowerMode }: Combo) {
  const canvas = document.querySelector<HTMLCanvasElement>(".canvas-overlay")!;
  const context = canvas.getContext("2d")!;
  // Oldest first, live ones only.
  const particles: Particle[] = [];
  let lastSpawn = -Infinity;
  let lastFrame: number | undefined;
  let running = false;

  function sizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
  // Moving the window to a screen with another pixel ratio doesn't always fire `resize`.
  const watchPixelRatio = () =>
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        sizeCanvas();
        watchPixelRatio();
      },
      { once: true },
    );
  watchPixelRatio();

  function spawn(type: string) {
    // Screen coordinates, so the editor's horizontal scroll is taken into account. Less the
    // shake, as in the original, whose particles didn't follow the shaking editor.
    const { row, column } = editor.getCursorPosition();
    const { pageX, pageY } = editor.renderer.textToScreenCoordinates(row, column);
    const shake = new DOMMatrixReadOnly(getComputedStyle(editor.container).transform);
    const [r, g, b] = PARTICLE_COLORS[type] ?? [255, 255, 255];
    const colour = `rgb(${r}, ${g}, ${b})`;
    const count = PARTICLE_NUM_RANGE[Math.floor(Math.random() * PARTICLE_NUM_RANGE.length)]!;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: pageX - shake.m41 + 4,
        y: pageY - shake.m42 + 10,
        vx: between(PARTICLE_VELOCITY_RANGE.x),
        vy: between(PARTICLE_VELOCITY_RANGE.y),
        alpha: 1,
        colour,
      });
    }
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    if (!running) {
      running = true;
      lastFrame = undefined;
      requestAnimationFrame(draw);
    }
  }

  function draw(time: number) {
    // New particles move one step in their first frame, as in the original.
    const steps = lastFrame === undefined ? 1 : Math.min(Math.max(time - lastFrame, 0), MAX_FRAME_TIME) / STEP;
    lastFrame = time;
    const fade = PARTICLE_ALPHA_FADEOUT ** steps;
    context.clearRect(0, 0, canvas.width, canvas.height);
    let live = 0;
    for (const particle of particles) {
      // Culled before it moves, as in the original, so it's drawn once more at its faintest.
      if (particle.alpha <= 0.1) continue;
      particles[live++] = particle;
      particle.vy += PARTICLE_GRAVITY * steps;
      particle.x += particle.vx * steps;
      particle.y += particle.vy * steps;
      particle.alpha *= fade;
      context.globalAlpha = particle.alpha;
      context.fillStyle = particle.colour;
      context.fillRect(
        Math.round(particle.x - PARTICLE_SIZE / 2),
        Math.round(particle.y - PARTICLE_SIZE / 2),
        PARTICLE_SIZE,
        PARTICLE_SIZE,
      );
    }
    particles.length = live;
    if (live) requestAnimationFrame(draw);
    else running = false;
  }

  editor.session.on("change", (delta) => {
    if (!isPowerMode()) return;
    const now = performance.now();
    if (now - lastSpawn < SPAWN_THROTTLE) return;
    // From where the change ends for an insertion, and where it was for a deletion.
    const at = delta.action === "insert" ? delta.end : delta.start;
    const token = editor.session.getTokenAt(at.row, at.column);
    if (!token) return;
    lastSpawn = now;
    // Once ACE has drawn the change, so the caret and the scroll are where the change put them.
    editor.renderer.once("afterRender", () => spawn(token.type));
  });
}
