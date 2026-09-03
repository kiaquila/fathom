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

test("the build publishes only the self-contained page", async () => {
  assert.deepEqual(await readdir(dist), ["index.html"]);
  assert.ok((await stat(join(dist, "index.html"))).size > 0);
});

test("the shipped page has no runtime network dependency", async () => {
  const { findOffOrigin } = await import("../scripts/build.mjs");
  assert.deepEqual(findOffOrigin(page), []);
  assert.doesNotMatch(page, /<link[^>]+rel=["']?stylesheet/i);
  assert.doesNotMatch(page, /<script[^>]+src=/i);
  /* The footer credit is the only reference allowed to leave the origin, and
     only as an anchor's href; the allowance must not have become a tunnel. */
  const outward = [...page.matchAll(/(?:src|href)\s*=\s*["']([a-z]+:)?\/\/[^"']+/gi)].map((match) => match[0]);
  assert.deepEqual(outward, ['href="https://ks-design.art']);
  const bad = (markup) => findOffOrigin(markup).length > 0;
  assert.ok(bad('<img src="https://cdn.example.com/a.png">'));
  assert.ok(bad('<img src="https:&#x2f;&#x2f;cdn.example.com/a.png">'));
  assert.ok(bad('<a href="https://ks-design.art" ping="https://evil.example.com/p">x</a>'));
  assert.ok(bad('<a href="https://ks-design.art" style="background:url(https://evil.example.com/a.png)">x</a>'));
  assert.ok(bad('<a href="https://evil.example.com">x</a>'), "a second anchor target passes");
  assert.ok(bad('<a href="https:&#x2f;&#x2f;evil.example.com">x</a>'), "an encoded anchor target passes");
  assert.ok(bad('<a href="https://ks-design.art/?u=https://evil.example.com">x</a>'), "a non-exact approved URL passes");
  assert.ok(!bad('<a href="https://ks-design.art" rel="author">ks-design</a>'));
});

test("the page keeps essential document and canvas semantics", () => {
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="viewport"/);
  assert.match(page, /<meta name="description"/);
  assert.match(page, /<title>Fathom — ks-design lab<\/title>/);
  assert.match(page, /<canvas id="stage" aria-hidden="true"><\/canvas>/);
  assert.match(page, /role="status"/);
  assert.match(page, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
});

test("the lab chrome is present and the time-of-day controls are accessible", () => {
  /* The wordmark and footer follow Ember's lab chrome (client decision,
     2026-09-03); the study number is fixed at 03. */
  assert.match(page, /<strong>ks<i class="dot" aria-hidden="true"><\/i><span class="visually-hidden"> <\/span>design<\/strong> · lab/);
  assert.match(page, /study 03 — fathom/);
  assert.match(page, /Designed by <a href="https:\/\/ks-design\.art" rel="author">ks-design<\/a> · Built with AI workflows/);
  assert.match(page, /<div class="controls" role="group" aria-label="Time of day">/);
  for (const mood of ["auto", "day", "dusk", "midnight"]) {
    assert.match(page, new RegExp(`<button class="ctl" type="button" data-mood="${mood}" aria-pressed="(?:true|false)">${mood}</button>`));
  }
  assert.match(page, /function moodForDate/);
});

test("the page names no canonical origin yet", () => {
  /* No domain or deployment has been approved, so the page must not promise
     a social card or canonical URL. */
  assert.doesNotMatch(page, /og:(?:url|image)/);
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
  assert.equal(wrangler.preview_urls, true);
  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /connect-src 'none'/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
});
