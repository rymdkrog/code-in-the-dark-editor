// The browser side of the prep page: reading the Organizer's files, fetching the Core Editor
// template and handing Round packages and Competition files to the browser's downloads.

import type { Asset } from "./competition.ts";

// For files the browser gives no type, as Firefox does for those in a chosen folder.
const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** The file's type, or the one its extension implies when the browser gives none. */
export const fileType = (file: File) =>
  file.type || TYPES[file.name.split(".").pop()!.toLowerCase()] || "application/octet-stream";

/** Reads a file as an asset, with its pixel dimensions if the browser can decode it as an image. */
export async function readAsset(file: File): Promise<Asset> {
  const type = fileType(file);
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file.slice(0, file.size, type));
  });
  const size = type.startsWith("image/") ? await imageSize(dataUri) : null;
  return { name: file.name, dataUri, width: size?.width ?? null, height: size?.height ?? null };
}

function imageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(image.naturalWidth ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** The Core Editor template, served as a static asset beside the prep page. */
export async function fetchTemplate(): Promise<string> {
  const response = await fetch("./core-editor.html");
  if (!response.ok) throw new Error(`Couldn't load the Core Editor template (HTTP ${response.status})`);
  return response.text();
}

/** Hands the content to the browser's downloads under the file name. */
export function download(fileName: string, content: string | Uint8Array<ArrayBuffer> | Blob, type = "text/html"): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** The colour of one pixel of an image, as `#RRGGBB`. */
export function pixelColour(image: HTMLImageElement, x: number, y: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red!, green!, blue!].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
