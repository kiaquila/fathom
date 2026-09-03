#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");
const dist = join(root, "dist");
const SERVED = ["index.html"];

const CHARACTER_REFERENCE = /&(?:#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi;
const DATA_URI = /data:[^"'\s)]+/gi;
/* The outward references are deliberately exact: the footer credit (once) and
   the canonical tag. Character references are decoded before the match, so an
   encoded copy cannot hide behind the allowance; a second anchor to the
   approved URL, encoded or not, stays visible to the scan, as do an anchor's
   other attributes — an inline background, a `ping`. */
const APPROVED_LINKS = ["https://ks-design.art"];
const CANONICAL_ORIGIN = "https://fathom.ks-design.art";
const CANONICAL_TAG = `<link rel="canonical" href="${CANONICAL_ORIGIN}">`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ANCHOR_HREF = new RegExp(
  `(<a\\b[^>]*?\\bhref\\s*=\\s*)(["'])(${APPROVED_LINKS.map(escapeRegExp).join("|")})\\2`,
  "gi"
);
const OFF_ORIGIN = /(?:\b(?:https?|ftp|wss?):[^\s"'()<>]+)|(?:(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'()<>]+)/gi;
const LOCAL_REFERENCE =
  /(?:\b(?:src|poster)\s*=\s*["']([^"']+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']|\burl\(\s*["']?([^"')]+)["']?\s*\))/gi;
const SRCSET = /\bsrcset\s*=\s*["']([^"']+)["']/gi;

function decodeCharacterReferences(markup) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", sol: "/", colon: ":" };
  return markup.replace(CHARACTER_REFERENCE, (reference) => {
    const body = reference.slice(1, -1);
    if (body[0] !== "#") return named[body.toLowerCase()] ?? reference;
    const code = body[1]?.toLowerCase() === "x"
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : reference;
  });
}

export { decodeCharacterReferences };

export function findOffOrigin(markup) {
  const seen = new Set();
  const scannable = decodeCharacterReferences(markup)
    .replace(DATA_URI, "data:inline")
    .replaceAll(CANONICAL_TAG, '<link rel="canonical" href="local">')
    .replace(ANCHOR_HREF, (anchor, lead, quote, url) => {
      if (seen.has(url.toLowerCase())) return anchor;
      seen.add(url.toLowerCase());
      return `${lead}${quote}local${quote}`;
    });
  const references = [...scannable.matchAll(OFF_ORIGIN)].map((match) => match[0]);
  if (/@import/i.test(scannable)) references.push("@import");
  return references;
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const name of SERVED) {
    await stat(join(src, name));
    await copyFile(join(src, name), join(dist, name));
  }

  const page = await readFile(join(dist, "index.html"), "utf8");
  const decoded = decodeCharacterReferences(page);
  const offsite = findOffOrigin(page);
  if (offsite.length > 0) {
    throw new Error(`Fathom must load nothing from another origin: ${offsite.join(", ")}`);
  }

  const srcsetCandidates = [...decoded.matchAll(SRCSET)].flatMap((match) =>
    match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0])
  );
  const unresolved = [...decoded.matchAll(LOCAL_REFERENCE)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .concat(srcsetCandidates)
    .filter((reference) => reference && !/^(?:data:|#)/i.test(reference))
    .filter((reference) => reference !== CANONICAL_ORIGIN)
    .filter((reference) => !SERVED.includes(reference.replace(/^\.?\//, "")));
  if (unresolved.length > 0) {
    throw new Error(`The page references unpublished files: ${unresolved.join(", ")}`);
  }

  const extras = (await readdir(src)).filter((name) => !SERVED.includes(name));
  if (extras.length > 0) {
    throw new Error(`website/src contains files outside the build allowlist: ${extras.join(", ")}`);
  }

  console.log(`Built Fathom: ${SERVED.length} file in website/dist/.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
