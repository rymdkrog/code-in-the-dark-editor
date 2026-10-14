// Points a Contestant's references to the Round's assets at the assets' data: URIs, for the
// Reveal. Pure: no DOM, so it's tested on its own. blob: URLs and <base href> don't work in
// the sandboxed Reveal frame, so data: URIs are the only way in.

import type { RoundData } from "../round-package/round-data.ts";

export type Asset = Pick<RoundData["assets"][number], "name" | "dataUri">;

// The asset folder of the original editor's packages, which some Contestants still write.
const LEADING_FOLDER = /^(\.\/)?(assets\/)?/i;
// A <style> with its CSS, up to its end tag; or any other start tag. Either way the tag's
// attributes follow its name, and their quoted values may hold a `>`.
const STYLE_OR_START_TAG =
  /<(style)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>([^]*?)(?=<\/style\s*>|$)|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
// Each URL in a srcset starts a candidate: at the start or after a comma.
const SRCSET_URL = /(^|,)(\s*)([^\s,]+)/g;
// An @import's URL is matched only so that it's skipped.
const CSS_URL = /@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]*))\s*\)/gi;

export function rewriteAssets(html: string, assets: Asset[]): string {
  const dataUris = new Map(assets.map(({ name, dataUri }) => [name.toLowerCase(), dataUri]));
  /** The data: URI of the asset `reference` names, or `reference` itself if it names none. */
  const assetUrl = (reference: string) =>
    dataUris.get(reference.trim().replace(LEADING_FOLDER, "").toLowerCase()) ?? reference;

  const rewriteCss = (css: string) =>
    css.replace(CSS_URL, (match, double?: string, single?: string, bare?: string) => {
      const reference = double ?? single ?? bare;
      if (reference === undefined) return match;
      const newReference = assetUrl(reference);
      return newReference === reference ? match : `url("${newReference}")`;
    });

  function rewriteValue(tagName: string, attributeName: string, value: string) {
    switch (attributeName) {
      case "src":
      case "poster":
        return assetUrl(value);
      case "srcset":
        return value.replace(SRCSET_URL, (_candidate, comma: string, space: string, reference: string) =>
          comma + space + assetUrl(reference),
        );
      case "href":
        return tagName === "link" ? assetUrl(value) : value;
      case "style":
        return rewriteCss(value);
      default:
        return value;
    }
  }

  const rewriteAttributes = (tagName: string, attributes: string) =>
    attributes.replace(ATTRIBUTE, (attribute, name: string, equals?: string, quoted?: string) => {
      if (!quoted) return attribute;
      const value = unquote(quoted);
      const newValue = rewriteValue(tagName.toLowerCase(), name.toLowerCase(), value);
      return newValue === value ? attribute : `${name}${equals}"${newValue.replaceAll('"', "&quot;")}"`;
    });

  return html.replace(
    STYLE_OR_START_TAG,
    (_markup, style?: string, styleAttributes?: string, css?: string, tagName?: string, attributes?: string) =>
      style !== undefined
        ? `<${style}${rewriteAttributes(style, styleAttributes!)}>${rewriteCss(css!)}`
        : `<${tagName}${rewriteAttributes(tagName!, attributes!)}>`,
  );
}

const unquote = (value: string) => (/^["']/.test(value) ? value.slice(1, -1) : value);
