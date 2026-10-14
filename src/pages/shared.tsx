// Small pieces the prep page and the Worker's pages share.

import { useState } from "react";
import { EDITOR_VERSION } from "./version.ts";

export const VersionFooter = ({ className }: { className?: string }) => (
  <footer className={className}>Code in the Dark editor {EDITOR_VERSION}</footer>
);

/** Copies text to the clipboard, and says so for a moment. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={className} onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}

/** A secret's first characters, enough to tell two apart, and the rest masked. */
export const maskSecret = (secret: string) => `${secret.slice(0, 4)}${"•".repeat(16)}`;
