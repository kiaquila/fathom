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
  assert.ok(findOffOrigin('<img src="https://cdn.example.com/a.png">').length > 0);
  assert.ok(findOffOrigin('<img src="https:&#x2f;&#x2f;cdn.example.com/a.png">').length > 0);
});

test("the development shell keeps essential document and canvas semantics", () => {
  assert.match(page, /<html lang="en">/);
  assert.match(page, /<meta name="viewport"/);
  assert.match(page, /<meta name="description"/);
  assert.match(page, /<title>Fathom — art study<\/title>/);
  assert.match(page, /<canvas id="stage" aria-hidden="true"><\/canvas>/);
  assert.match(page, /role="status"/);
  assert.match(page, /prefers-reduced-motion:\s*reduce/);
});

test("the page shell does not pretend the artwork is complete", () => {
  assert.match(page, /Art study in development/);
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
