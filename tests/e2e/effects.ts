import type { Page } from "@playwright/test";
import { nextFrame } from "./package.ts";

/** One square the particle canvas drew, in CSS pixels, with the colour it was filled with. */
export interface DrawnSquare {
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
}

/** What the page drew in one animation frame callback. */
export interface Frame {
  time: number;
  squares: DrawnSquare[];
}

/** A change to the editor's inline transform or margin, as a shake makes it. */
export interface StyleChange {
  time: number;
  transform: string;
  margin: string;
}

interface Recording {
  frames: Frame[];
  requestedFrames: number;
  styleChanges: StyleChange[];
}

/**
 * Records what Power Mode's effects do, by watching the browser APIs they use: every square
 * filled on a canvas (grouped by animation frame), every animation frame requested, and every
 * change to the editor's inline transform or margin.
 *
 * `frameRate` drives animation frames from a timer at that rate instead of the display, to stand
 * in for a 120 Hz screen. `slowMotion` divides the time animation frames report, so particles
 * live that many times longer and pile up to the cap.
 */
export async function recordEffects(
  page: Page,
  { frameRate, slowMotion = 1 }: { frameRate?: number; slowMotion?: number } = {},
) {
  await page.addInitScript(
    ({ frameRate, slowMotion }) => {
      const recording: Recording = { frames: [], requestedFrames: 0, styleChanges: [] };
      (window as unknown as { __effects: Recording }).__effects = recording;

      const start = performance.now();
      const requestFrame: (callback: FrameRequestCallback) => number = frameRate
        ? (callback) => window.setTimeout(() => callback(performance.now()), 1000 / frameRate)
        : window.requestAnimationFrame.bind(window);
      // The particles are drawn in one callback per frame, which is all a frame here records.
      let frame: Frame | undefined;
      window.requestAnimationFrame = (callback) => {
        recording.requestedFrames++;
        return requestFrame((time) => {
          frame = { time, squares: [] };
          callback(start + (time - start) / slowMotion);
          if (frame.squares.length) recording.frames.push(frame);
          frame = undefined;
        });
      };

      const { fillRect } = CanvasRenderingContext2D.prototype;
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
        frame?.squares.push({ x, y, width, height, colour: String(this.fillStyle) });
        return fillRect.call(this, x, y, width, height);
      };

      document.addEventListener("DOMContentLoaded", () => {
        const editor = document.getElementById("editor")!;
        const parse = document.createElement("div");
        let last = { transform: "", margin: "" };
        new MutationObserver((records) => {
          // Several changes can arrive together: each one's new style is the next one's old.
          const styles = [...records.slice(1).map((record) => record.oldValue), editor.getAttribute("style")];
          for (const style of styles) {
            parse.setAttribute("style", style ?? "");
            const { transform, margin } = parse.style;
            // The editor starts after this, and ACE's own styles aren't a shake.
            if (transform === last.transform && margin === last.margin) continue;
            last = { transform, margin };
            recording.styleChanges.push({ time: performance.now(), transform, margin });
          }
        }).observe(editor, { attributes: true, attributeFilter: ["style"], attributeOldValue: true });
      });
    },
    { frameRate, slowMotion },
  );
}

export const recording = (page: Page) => page.evaluate(() => (window as unknown as { __effects: Recording }).__effects);

/** The most particles drawn in one frame. Worked out in the page, as the recording can be large. */
export const mostSquaresInAFrame = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __effects: Recording }).__effects.frames.reduce(
      (most, frame) => Math.max(most, frame.squares.length),
      0,
    ),
  );

/** Starts the recording afresh. */
export const clearRecording = (page: Page) =>
  page.evaluate(() => {
    const recording = (window as unknown as { __effects: Recording }).__effects;
    recording.frames.length = 0;
    recording.styleChanges.length = 0;
    recording.requestedFrames = 0;
  });

/** Types the 200 insertions that turn on Power Mode. */
export async function enterPowerMode(page: Page) {
  await page.keyboard.type("a".repeat(200));
  await page.locator("body.power-mode").waitFor();
}

/** Waits until no particle has been drawn for a while. */
export async function waitForParticlesGone(page: Page) {
  // Particles from the last keystroke appear once the editor has drawn it.
  await nextFrame(page);
  await page.waitForFunction(() => {
    const { frames } = (window as unknown as { __effects: Recording }).__effects;
    const last = frames.at(-1);
    return !last || performance.now() - last.time > 300;
  });
}
