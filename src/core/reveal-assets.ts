// Points a Contestant's references to the Round's assets at the assets' data: URIs, for the
// Reveal. Pure: no DOM, so it's tested on its own. blob: URLs and <base href> don't work in
// the sandboxed Reveal frame, so data: URIs are the only way in.

export interface Asset {
  name: string;
  dataUri: string;
}

// The asset folder of the original editor's packages, which some Contestants still write.
const LEADING_FOLDER = /^(\.\/)?(assets\/)?/i;
// A <style> with its CSS, up to its end tag; or any other start tag. Either way the tag's
// attributes follow its name, and their quoted values may hold a `>`.
const MARKUP =
  /<(style)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'">])*)>([^]*?)(?=<\/style\s*>|$)|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
// Each URL in a srcset starts a candidate: at the start or after a comma.
const SRCSET_URL = /(^|,)(\s*)([^\s,]+)/g;
// An @import is matched only so that its url() is skipped.
const CSS_URL = /@import\b[^;]*|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]*))\s*\)/gi;

export function rewriteAssets(html: string, assets: Asset[]): string {
  const dataUris = new Map(assets.map(({ name, dataUri }) => [name.toLowerCase(), dataUri]));
  const url = (reference: string) =>
    dataUris.get(reference.trim().replace(LEADING_FOLDER, "").toLowerCase()) ?? reference;

  const rewriteCss = (css: string) =>
    css.replace(CSS_URL, (match, double?: string, single?: string, bare?: string) => {
      const reference = double ?? single ?? bare;
      if (reference === undefined) return match;
      const newReference = url(reference);
      return newReference === reference ? match : `url("${newReference}")`;
    });

  function rewriteValue(tagName: string, attributeName: string, value: string) {
    switch (attributeName) {
      case "src":
      case "poster":
        return url(value);
      case "srcset":
        return value.replace(SRCSET_URL, (_candidate, comma: string, space: string, reference: string) =>
          comma + space + url(reference),
        );
      case "href":
        return tagName === "link" ? url(value) : value;
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
    MARKUP,
    (_markup, style?: string, styleAttributes?: string, css?: string, tagName?: string, attributes?: string) =>
      style !== undefined
        ? `<${style}${rewriteAttributes(style, styleAttributes!)}>${rewriteCss(css!)}`
        : `<${tagName}${rewriteAttributes(tagName!, attributes!)}>`,
  );
}

const unquote = (value: string) => (/^["']/.test(value) ? value.slice(1, -1) : value);
