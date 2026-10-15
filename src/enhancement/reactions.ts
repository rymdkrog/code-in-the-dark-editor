// The Reaction overlay: each Reaction is an emoji that floats up from the bottom edge of the
// Contestant's screen. It has its own canvas and its own animation loop, which stops when idle,
// and it never touches the editor or Power Mode's canvas.
//
// No flood can lag the editor: an arrival is O(1) (push, or drop when 200 are already up),
// nothing is drawn or measured per Reaction, each emoji is rasterised once per size and DPR and
// blitted, and layout is read only on resize, on the Reveal, and at most every 500 ms.

import { REVEAL_ENDED, REVEAL_STARTED } from "../round-package/events.ts";
import type { Reaction } from "../protocol/protocol.ts";

/** The load-bearing cap: without it a flood lags the editor. An arrival when full is dropped. */
const MAX_LIVE = 200;
/** The emoji's size and how high it rises, in CSS pixels (as at 1440×900). */
const SIZE = 40;
const RISE = 200;
const POP_S = 0.2;
/** It fades over the last ~45 % of its life. */
const FADE_FROM = 0.55;
const REMEASURE_MS = 500;
/** Elapsed time per frame is capped, so a stalled tab doesn't teleport the emoji. */
const MAX_STEP_S = 0.1;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** One emoji on its way up. */
interface Sprite {
  e: Reaction;
  /** Seconds since it arrived. */
  age: number;
  life: number;
  /** Along the bottom edge, as a share of the room there, so a resize keeps it in view. */
  across: number;
  /** Pixels per second, upwards. */
  speed: number;
  wobble: number;
  frequency: number;
  phase: number;
}

const random = (from: number, to: number) => from + Math.random() * (to - from);
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

export function reactionOverlay() {
  const sprites: Sprite[] = [];
  const rasterised = new Map<string, HTMLCanvasElement>();
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let measuredAt = -Infinity;
  let running = false;
  let last = 0;

  /** The overlay's canvas, made on the first Reaction so nothing shows until one comes. */
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "reactions";
    canvas.setAttribute("aria-hidden", "true");
    // Over the code, buttons and the Reveal's result; behind the name badge and Reference.
    Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", zIndex: "38", pointerEvents: "none" });
    context = canvas.getContext("2d");
    document.body.append(canvas);
    measure();
    addEventListener("resize", measure);
    addEventListener(REVEAL_STARTED, measure);
    addEventListener(REVEAL_ENDED, measure);
  }

  /** Reads the window's size and DPR, and resizes the canvas to match. */
  function measure() {
    try {
      measuredAt = performance.now();
      const [w, h, ratio] = [innerWidth, innerHeight, devicePixelRatio || 1];
      if (w === width && h === height && ratio === dpr) return;
      [width, height, dpr] = [w, h, ratio];
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
    } catch {
      // The overlay stays as it was.
    }
  }

  /** The emoji drawn once at this size and DPR, to blit from then on. */
  function image(e: Reaction): HTMLCanvasElement {
    const key = `${e}@${SIZE}@${dpr}`;
    let drawn = rasterised.get(key);
    if (drawn) return drawn;
    const px = Math.round(SIZE * dpr);
    drawn = document.createElement("canvas");
    drawn.width = drawn.height = Math.round(px * 1.3);
    const pen = drawn.getContext("2d")!;
    pen.font = `${px}px ${EMOJI_FONT}`;
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillText(e, drawn.width / 2, drawn.height / 2 + px * 0.06);
    rasterised.set(key, drawn);
    return drawn;
  }

  function frame(now: number) {
    try {
      const step = Math.max(0, Math.min(now - last, MAX_STEP_S * 1000)) / 1000;
      last = now;
      if (now - measuredAt > REMEASURE_MS) measure();
      const pen = context!;
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.clearRect(0, 0, canvas!.width, canvas!.height);
      let kept = 0;
      for (const sprite of sprites) {
        sprite.age += step;
        if (sprite.age >= sprite.life) continue;
        sprites[kept++] = sprite;
        draw(pen, sprite);
      }
      sprites.length = kept;
      pen.globalAlpha = 1;
      running = kept > 0;
      if (running) requestAnimationFrame(frame);
      else pen.setTransform(1, 0, 0, 1, 0, 0);
    } catch {
      running = false;
      sprites.length = 0;
    }
  }

  function draw(pen: CanvasRenderingContext2D, sprite: Sprite) {
    const { age, life } = sprite;
    const x = SIZE / 2 + sprite.across * (width - SIZE) + sprite.wobble * Math.sin(2 * Math.PI * sprite.frequency * age + sprite.phase);
    const y = height + SIZE * 0.2 - sprite.speed * age;
    const scale = age < POP_S ? easeOutBack(age / POP_S) : 1;
    const fadeFrom = life * FADE_FROM;
    pen.globalAlpha = age < fadeFrom ? 1 : Math.max(0, 1 - (age - fadeFrom) / (life - fadeFrom));
    const drawn = image(sprite.e);
    // The image is already at device pixels.
    pen.setTransform(scale, 0, 0, scale, x * dpr, y * dpr);
    pen.drawImage(drawn, -drawn.width / 2, -drawn.height / 2);
  }

  return {
    /** One Reaction arrives: it goes up, or is dropped if the overlay is full. Never queued. */
    add(e: Reaction) {
      if (sprites.length >= MAX_LIVE) return;
      ensureCanvas();
      const life = random(1.8, 2.4);
      sprites.push({
        e,
        age: 0,
        life,
        across: Math.random(),
        speed: (RISE * random(0.6, 1)) / life,
        wobble: random(6, 12),
        frequency: random(0.6, 1),
        phase: random(0, 2 * Math.PI),
      });
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
}
