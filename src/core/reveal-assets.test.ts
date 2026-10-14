import { describe, expect, it } from "vitest";
import { rewriteAssets } from "./reveal-assets.ts";

const BEACH = "data:image/jpeg;base64,/9j/beach";
const assets = [{ name: "beach.jpg", dataUri: BEACH }];

describe("rewriteAssets", () => {
  it("rewrites a src that names an asset to its data: URI", () => {
    expect(rewriteAssets('<img src="beach.jpg" alt="Beach">', assets)).toBe(`<img src="${BEACH}" alt="Beach">`);
  });

  it.each(["./beach.jpg", "assets/beach.jpg", "assets/Beach.JPG", "BEACH.jpg", " beach.jpg "])(
    "matches %j case-insensitively, after a leading ./ or assets/",
    (reference) => {
      expect(rewriteAssets(`<img src="${reference}">`, assets)).toBe(`<img src="${BEACH}">`);
    },
  );

  it.each(["sea.jpg", "images/beach.jpg", "beach.jpg.png", "https://example.com/beach.jpg", "../beach.jpg"])(
    "leaves %j, which isn't an asset, untouched",
    (reference) => {
      const html = `<img src="${reference}">`;
      expect(rewriteAssets(html, assets)).toBe(html);
    },
  );

  it("rewrites single-quoted and unquoted values, keeping the attribute's spelling", () => {
    expect(rewriteAssets("<IMG SRC = 'beach.jpg'><img src=beach.jpg>", assets)).toBe(
      `<IMG SRC = "${BEACH}"><img src="${BEACH}">`,
    );
  });

  it("rewrites a poster", () => {
    expect(rewriteAssets('<video poster="beach.jpg"></video>', assets)).toBe(`<video poster="${BEACH}"></video>`);
  });

  it("rewrites each matching candidate in a srcset, keeping descriptors and the others", () => {
    expect(rewriteAssets('<img srcset="beach.jpg 1x, sea.jpg 2x,./Beach.jpg 640w">', assets)).toBe(
      `<img srcset="${BEACH} 1x, sea.jpg 2x,${BEACH} 640w">`,
    );
  });

  it("rewrites a <link href>, but no other href", () => {
    expect(rewriteAssets('<link rel="icon" href="beach.jpg"><a href="beach.jpg">', assets)).toBe(
      `<link rel="icon" href="${BEACH}"><a href="beach.jpg">`,
    );
  });

  it("rewrites url() in a <style>, quoted or not", () => {
    const html = `<style>
  body { background: url(beach.jpg) }
  .a { background-image: url( "./beach.jpg" ), url('sea.jpg') }
  @font-face { font-family: Hand; src: URL('assets/Hand.woff2') format("woff2") }
</style>`;
    expect(rewriteAssets(html, [...assets, { name: "hand.woff2", dataUri: "data:font/woff2;base64,d09G" }])).toBe(`<style>
  body { background: url("${BEACH}") }
  .a { background-image: url("${BEACH}"), url('sea.jpg') }
  @font-face { font-family: Hand; src: url("data:font/woff2;base64,d09G") format("woff2") }
</style>`);
  });

  it("rewrites url() in a style attribute, keeping the attribute's quotes intact", () => {
    expect(rewriteAssets(`<div style="background: url('beach.jpg') no-repeat"></div>`, assets)).toBe(
      `<div style="background: url(&quot;${BEACH}&quot;) no-repeat"></div>`,
    );
  });

  it("leaves @import alone, even when it names an asset", () => {
    const html = '<style>@import url("beach.jpg"); @import "beach.jpg";</style>';
    expect(rewriteAssets(html, assets)).toBe(html);
  });

  it("still rewrites the url() after an @import that has no semicolon", () => {
    expect(rewriteAssets("<style>/* no @import */ p { background: url(beach.jpg) }</style>", assets)).toBe(
      `<style>/* no @import */ p { background: url("${BEACH}") }</style>`,
    );
  });

  it("leaves url() outside CSS alone", () => {
    const html = '<p>url(beach.jpg)</p><script>x = "url(beach.jpg)"</script>';
    expect(rewriteAssets(html, assets)).toBe(html);
  });

  it("leaves text, other attributes and lookalike attributes alone", () => {
    const html = '<p data-src="beach.jpg" title="src=beach.jpg">src="beach.jpg"</p><a href="beach.jpg">Beach</a>';
    expect(rewriteAssets(html, assets)).toBe(html);
  });
});
