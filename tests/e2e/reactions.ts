// Watching the Reaction overlay from the outside: every emoji it blits, every emoji it
// rasterises, and the frames it asks for.

import type { Page } from "@playwright/test";
import { REACTIONS, V, type Reaction } from "../../src/protocol/protocol.ts";
import type { Peer } from "./fake-worker.ts";

/** One emoji blitted onto the overlay, in CSS pixels. */
export interface Blit {
  /** The animation frame it was drawn in, counted from the first one the page asked for. */
  frame: number;
  time: number;
  /** Where the emoji's centre lands. */
  x: number;
  y: number;
  /** How large it is drawn, in CSS pixels. */
  size: number;
  alpha: number;
}

interface ReactionRecording {
  blits: Blit[];
  /** Every emoji drawn as text, with its font: what rasterising one looks like. */
  rasterised: { text: string; font: string }[];
  requestedFrames: number;
}

/** Records what the Reaction overlay (the canvas with class `reactions`) draws. */
export async function recordReactions(page: Page) {
  await page.addInitScript(() => {
    const recording: ReactionRecording = { blits: [], rasterised: [], requestedFrames: 0 };
    (window as unknown as { __reactions: ReactionRecording }).__reactions = recording;

    let frame = 0;
    const { requestAnimationFrame } = window;
    window.requestAnimationFrame = (callback) => {
      recording.requestedFrames++;
      return requestAnimationFrame.call(window, (time) => {
        frame++;
        callback(time);
      });
    };

    const { drawImage, fillText } = CanvasRenderingContext2D.prototype;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (this.canvas.classList?.contains("reactions")) {
        const image = args[0] as { width: number; height: number };
        const [dx, dy] = args.slice(1) as [number, number];
        const t = this.getTransform();
        const dpr = this.canvas.width / this.canvas.getBoundingClientRect().width;
        const centre = t.transformPoint(new DOMPoint(dx + image.width / 2, dy + image.height / 2));
        recording.blits.push({
          frame,
          time: performance.now(),
          x: centre.x / dpr,
          y: centre.y / dpr,
          size: (Math.hypot(t.a, t.b) * image.width) / dpr,
          alpha: this.globalAlpha,
        });
      }
      return (drawImage as (...a: unknown[]) => void).apply(this, args);
    } as CanvasRenderingContext2D["drawImage"];
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      if (/\p{Extended_Pictographic}/u.test(text)) recording.rasterised.push({ text, font: this.font });
      return fillText.call(this, text, ...rest);
    };
  });
}

export const reactionRecording = (page: Page) =>
  page.evaluate(() => (window as unknown as { __reactions: ReactionRecording }).__reactions);

/** The most emoji blitted in one frame, worked out in the page, as the recording can be large. */
export const mostInAFrame = (page: Page) =>
  page.evaluate(() => {
    const counts = new Map<number, number>();
    for (const { frame } of (window as unknown as { __reactions: ReactionRecording }).__reactions.blits) {
      counts.set(frame, (counts.get(frame) ?? 0) + 1);
    }
    return Math.max(0, ...counts.values());
  });

/** A Reaction as the Worker relays it. */
export const reaction = (e: Reaction | string, seat = "seat") => JSON.stringify({ v: V, t: "react", seat, e });

/** The fake Worker's socket to the package, once the package has said who it is. */
export function laptopPeer(): { behaviour: { message(peer: Peer, text: string): void }; peer: Promise<Peer> } {
  let found: (peer: Peer) => void;
  const peer = new Promise<Peer>((resolve) => (found = resolve));
  return {
    behaviour: { message: (socket, text) => text.includes('"presence"') && found(socket) },
    peer,
  };
}

/** Sends `perSecond` Reactions for `seconds`, as a flood from the Worker would arrive. */
export async function flood(peer: Peer, { perSecond, seconds }: { perSecond: number; seconds: number }) {
  const tick = 10;
  for (let sent = 0, start = Date.now(); Date.now() - start < seconds * 1000; ) {
    const due = Math.floor(((Date.now() - start) / 1000) * perSecond);
    for (; sent < due; sent++) peer.send(reaction(REACTIONS[sent % REACTIONS.length]!));
    await new Promise((resolve) => setTimeout(resolve, tick));
  }
}
