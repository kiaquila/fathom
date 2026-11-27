import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { before } from "node:test";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
let page = "";

before(async () => {
  page = await readFile(join(dist, "index.html"), "utf8");
});

const FISH = ["fish-01.webp", "fish-02.webp", "fish-03.webp"];
const SOCIAL_PREVIEW = "social-preview.jpg";

test("the build publishes the page, painted fish, logo variants and social preview only", async () => {
  assert.deepEqual((await readdir(dist)).sort(), [...FISH, "index.html", SOCIAL_PREVIEW, "ks-design-art-on-light.svg", "ks-design-art-on-dark.svg"].sort());
  assert.ok((await stat(join(dist, "index.html"))).size > 0);
  const preview = await readFile(join(dist, SOCIAL_PREVIEW));
  assert.equal(preview.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.ok(preview.length < 180224);
  for (const file of FISH) {
    const bytes = await readFile(join(dist, file));
    assert.ok(bytes.length > 0);
    /* RIFF….WEBPVP8X with the alpha flag: a cut-out fish, not a flat picture */
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF");
    assert.equal(bytes.subarray(8, 16).toString("latin1"), "WEBPVP8X");
    assert.ok(bytes[20] & 0x10, `${file} carries no alpha channel`);
    /* root-relative, so the page finds them from any route the Worker answers with it */
    assert.match(page, new RegExp(`"/${file}"`));
  }
  /* The fish files are the only runtime fetches; the preview is for crawlers. */
  assert.match(page, /K\.loadImages\(FISH, \d+\)/);
  assert.match(page, /then\(boot, \(\) => boot\(\[\]\)\)/);
});

test("the shipped page has no runtime network dependency", async () => {
  const { findOffOrigin } = await import("../scripts/build.mjs");
  assert.deepEqual(findOffOrigin(page), []);
  assert.doesNotMatch(page, /<link[^>]+rel=["']?stylesheet/i);
  assert.doesNotMatch(page, /<script[^>]+src=/i);
  /* The footer credit and exact same-origin metadata are the only full URLs
     allowed in the page; neither allowance may become a tunnel. */
  const outward = [...page.matchAll(/(?:src|href)\s*=\s*["']([a-z]+:)?\/\/[^"']+/gi)].map((match) => match[0]);
  assert.deepEqual(outward, [
    'href="https://fathom.ks-design.art',
    'href="https://ks-design.art'
  ]);
  const bad = (markup) => findOffOrigin(markup).length > 0;
  assert.ok(bad('<img src="https://cdn.example.com/a.png">'));
  assert.ok(bad('<img src="https:&#x2f;&#x2f;cdn.example.com/a.png">'));
  assert.ok(bad('<a href="https://ks-design.art" ping="https://evil.example.com/p">x</a>'));
  assert.ok(bad('<a href="https://ks-design.art" style="background:url(https://evil.example.com/a.png)">x</a>'));
  assert.ok(bad('<a href="https://evil.example.com">x</a>'), "a second anchor target passes");
  assert.ok(bad('<a href="https:&#x2f;&#x2f;evil.example.com">x</a>'), "an encoded anchor target passes");
  assert.ok(bad('<a href="https://ks-design.art/?u=https://evil.example.com">x</a>'), "a non-exact approved URL passes");
  assert.ok(bad('<link rel="canonical" href="https://evil.example.com">'));
  assert.ok(bad('<link rel="canonical" href="https://fathom.ks-design.art" ping="https://evil.example.com">'));
  assert.ok(bad('<meta property="og:image" content="https://evil.example.com/preview.jpg">'));
  assert.ok(bad('<meta property="og:image" content="https://fathom.ks-design.art/social-preview.jpg?next=https://evil.example.com">'));
  assert.ok(bad('<a href="https://ks-design.art">a</a><a href="https:&#x2f;&#x2f;ks-design.art">b</a>'), "a second, encoded copy of the approved link passes");
  assert.ok(!bad('<a href="https://ks-design.art" rel="author">ks-design</a>'));
  assert.ok(!bad('<link rel="canonical" href="https://fathom.ks-design.art">'));
  /* The shipped page carries the approved link exactly once, counted after decoding. */
  const { decodeCharacterReferences } = await import("../scripts/build.mjs");
  const anchors = [...decodeCharacterReferences(page).matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1]);
  assert.deepEqual(anchors, ["https://ks-design.art"]);
});

test("the page keeps essential document and canvas semantics", () => {
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="viewport"/);
  /* The water runs edge to edge on phones: the page opts into the notch and
     bottom-bar areas, the canvas takes the large viewport height, and the
     chrome keeps to the safe area on every edge. */
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(page, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  assert.match(page, /@supports \(-webkit-touch-callout: none\) \{\s*@media \(orientation: portrait\) and \(max-width: 600px\) \{\s*#stage \{ position: absolute; height: calc\(100vh \+ 120px\); height: calc\(100lvh \+ 120px\); \}/);
  assert.match(page, /html, body \{ height: 100%; overscroll-behavior: none; \}/);
  assert.match(page, /<div id="tint" aria-hidden="true"><\/div>/);
  for (const edge of ["top", "left", "right"]) assert.match(page, new RegExp(`\\.top \\{[^}]*env\\(safe-area-inset-${edge}, 0px\\)`));
  assert.match(page, /\.bottom \{[^}]*env\(safe-area-inset-bottom, 0px\)/);
  assert.match(page, /<meta name="description"/);
  assert.match(page, /<title>Fathom — ks-design lab<\/title>/);
  assert.match(page, /<canvas id="stage" aria-hidden="true"><\/canvas>/);
  assert.match(page, /role="status"/);
  assert.match(page, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
});

test("the lab chrome is present and the time-of-day controls are accessible", () => {
  assert.match(page, /class="brand-mark brand-light" src="\/ks-design-art-on-light\.svg" alt="ks-design\.art" width="121" height="20"/);
  assert.match(page, /class="brand-mark brand-dark" src="\/ks-design-art-on-dark\.svg" alt="ks-design\.art" width="121" height="20"/);
  assert.match(page, /body\[data-mood="midnight"\] \.brand-dark \{ display: block; \}/);
  assert.match(page, /width: 121px; height: 20px; max-width: none;/);
  assert.doesNotMatch(page, /\.brand-mark \{ font-size:/);
  /* The chrome stays on the system face — no webfont is declared or fetched. */
  assert.doesNotMatch(page, /@font-face|url\([^)]*(?:woff|ttf|otf)/);
  assert.match(page, /study 03 — fathom/);
  assert.match(page, /Designed by <a href="https:\/\/ks-design\.art" rel="author">ks-design\.art<\/a> · Built with AI workflows/);
  assert.match(page, /<div class="controls" role="group" aria-label="Time of day">/);
  for (const mood of ["auto", "day", "dusk", "midnight"]) {
    assert.match(page, new RegExp(`<button class="ctl" type="button" data-mood="${mood}" aria-pressed="(?:true|false)">${mood}</button>`));
  }
  assert.match(page, /function moodForDate/);
});

test("the page names the approved canonical origin and same-origin social preview", () => {
  assert.match(page, /<link rel="canonical" href="https:\/\/fathom\.ks-design\.art">/);
  assert.match(page, /<meta property="og:type" content="website">/);
  assert.match(page, /<meta property="og:title" content="Fathom — ks-design lab">/);
  assert.match(page, /<meta property="og:description" content="A school of sequined goldfish drifting through painted water that follows your local time of day\.">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/fathom\.ks-design\.art">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/fathom\.ks-design\.art\/social-preview\.jpg">/);
  assert.match(page, /<meta property="og:image:type" content="image\/jpeg">/);
  assert.match(page, /<meta property="og:image:width" content="1280">/);
  assert.match(page, /<meta property="og:image:height" content="720">/);
  assert.match(page, /<meta property="og:image:alt" content="Sequined goldfish drifting through painted water in Fathom\.">/);
  assert.doesNotMatch(page, /<form\b/i);
});

test("the Worker and Wrangler configuration apply the security boundary", async () => {
  const worker = await readFile(join(root, "worker/index.ts"), "utf8");
  const wrangler = JSON.parse(await readFile(join(root, "wrangler.json"), "utf8"));
  assert.equal(wrangler.name, "fathom");
  assert.equal(wrangler.main, "worker/index.ts");
  assert.equal(wrangler.assets.directory, "./dist");
  assert.equal(wrangler.assets.binding, "ASSETS");
  assert.equal(wrangler.assets.run_worker_first, true);
  assert.equal(wrangler.assets.html_handling, "auto-trailing-slash");
  assert.equal(wrangler.assets.not_found_handling, "single-page-application");
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.preview_urls, true);
  assert.equal(wrangler.observability.enabled, true);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /connect-src 'none'/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
});
