#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { loadConfig, resolveWithin } from "./config.mjs";

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Deployable output contains a symlink: ${path}`);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else if (stat.isFile()) files.push(path);
  }
  return files.sort();
}

function displayBytes(bytes) {
  return `${bytes} B`;
}

export function checkPerformance(root) {
  const config = loadConfig(root);
  const { performance } = config;
  const output = resolveWithin(root, performance.outputDirectory, "performance.outputDirectory");
  const files = filesUnder(output);
  if (files.length === 0) throw new Error(`No deployable files found in ${performance.outputDirectory}`);

  const totals = { raw: 0, gzip: 0 };
  const extensions = new Map();
  const allowed = new Set(performance.allowedExtensions);
  const failures = [];

  for (const file of files) {
    const extension = extname(file).toLowerCase();
    const buffer = readFileSync(file);
    const gzip = gzipSync(buffer, { level: 9 }).length;
    totals.raw += buffer.length;
    totals.gzip += gzip;
    const measured = extensions.get(extension) ?? { raw: 0, gzip: 0 };
    measured.raw += buffer.length;
    measured.gzip += gzip;
    extensions.set(extension, measured);
    if (!allowed.has(extension)) {
      failures.push(`Unexpected deployable file type ${extension || "(none)"}: ${relative(output, file)}`);
    }
  }

  const { budgets } = performance;
  if (totals.raw > budgets.totalRawBytes) {
    failures.push(`Total raw payload ${displayBytes(totals.raw)} exceeds ${displayBytes(budgets.totalRawBytes)}`);
  }
  if (totals.gzip > budgets.totalGzipBytes) {
    failures.push(`Total gzip payload ${displayBytes(totals.gzip)} exceeds ${displayBytes(budgets.totalGzipBytes)}`);
  }
  for (const [extension, limits] of Object.entries(budgets.extensions)) {
    const measured = extensions.get(extension) ?? { raw: 0, gzip: 0 };
    if (limits.rawBytes && measured.raw > limits.rawBytes) {
      failures.push(`${extension} raw payload ${displayBytes(measured.raw)} exceeds ${displayBytes(limits.rawBytes)}`);
    }
    if (limits.gzipBytes && measured.gzip > limits.gzipBytes) {
      failures.push(`${extension} gzip payload ${displayBytes(measured.gzip)} exceeds ${displayBytes(limits.gzipBytes)}`);
    }
  }

  // The browser fetches every critical file as its own response, so each one is
  // compressed as an independent gzip stream. Concatenating before compression
  // would let later files reuse earlier dictionaries and charge one header.
  const criticalGzip = performance.criticalFiles.reduce((total, file) => {
    const path = resolveWithin(output, file, `critical file ${file}`);
    return total + gzipSync(readFileSync(path), { level: 9 }).length;
  }, 0);
  if (criticalGzip > budgets.criticalGzipBytes) {
    failures.push(`Critical gzip payload ${displayBytes(criticalGzip)} exceeds ${displayBytes(budgets.criticalGzipBytes)}`);
  }

  return { criticalGzip, extensions, failures, files, totals };
}

const rootIndex = process.argv.indexOf("--root");
const root = resolve(rootIndex === -1 ? import.meta.dirname : process.argv[rootIndex + 1], rootIndex === -1 ? ".." : ".");

try {
  const result = checkPerformance(root);
  console.log(`Payload: ${displayBytes(result.totals.raw)} raw, ${displayBytes(result.totals.gzip)} gzip; critical ${displayBytes(result.criticalGzip)} gzip.`);
  if (result.failures.length) {
    console.error(result.failures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
