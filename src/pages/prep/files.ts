// The browser side of the prep page: reading the Organizer's files, fetching the Core Editor
// template and handing a Round package to the browser's downloads.

import type { Asset } from "./competition.ts";

/** Reads a file as an asset, with its pixel dimensions if the browser can decode it as an image. */
export async function readAsset(file: File, name = file.name): Promise<Asset> {
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const size = file.type.startsWith("image/") ? await imageSize(dataUri) : null;
  return { name, dataUri, width: size?.width ?? null, height: size?.height ?? null };
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

export function download(fileName: string, html: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
