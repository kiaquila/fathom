#!/usr/bin/env node

import { basename, join, resolve, sep } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.mjs";

const rootIndex = process.argv.indexOf("--root");
const root = resolve(rootIndex === -1 ? import.meta.dirname : process.argv[rootIndex + 1], rootIndex === -1 ? ".." : ".");
const failures = [];

for (const path of [
  ".gitattributes",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "package.json",
  "scripts/check-performance-budget.mjs",
  "scripts/check-repository.mjs",
  "scripts/config.mjs",
  "scripts/run-project-checks.mjs",
  "web-design.config.json"
]) {
  if (!existsSync(join(root, path))) failures.push(`Missing harness file: ${path}`);
}

try {
  loadConfig(root);
} catch (error) {
  failures.push(...error.message.split("\n"));
}

if (existsSync(join(root, ".github/CODEOWNERS")) &&
    readFileSync(join(root, ".github/CODEOWNERS"), "utf8").includes("replace-with-owner")) {
  failures.push("Replace the CODEOWNERS placeholder with the repository owner");
}

const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8"
});
if (listed.status !== 0) throw new Error(listed.stderr.trim() || "git ls-files failed");
const files = listed.stdout.split("\0").filter(Boolean);

const forbiddenSegments = new Set([".next", ".wrangler", "build", "coverage", "dist", "node_modules"]);
const forbiddenNames = [/^\.DS_Store$/, /^\.env(?:\..+)?$/, /\.(?:key|p12|pfx|pem|session)$/i];
const secrets = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["API key", /sk-[A-Za-z0-9_-]{32,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/]
];
const personalPaths = [/\/Users\/[A-Za-z0-9._-]+\//, /\/home\/[A-Za-z0-9._-]+\//, /[A-Za-z]:\\Users\\/];

for (const file of files) {
  const normalized = file.split(sep).join("/");
  const name = basename(normalized);
  if (normalized.split("/").some((part) => forbiddenSegments.has(part))) {
    failures.push(`Generated or dependency directory is tracked: ${normalized}`);
  }
  if (forbiddenNames.some((pattern) => pattern.test(name)) && name !== ".env.example") {
    failures.push(`Sensitive or local-only file is tracked: ${normalized}`);
  }
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    failures.push(`Symbolic links are not allowed: ${normalized}`);
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  const buffer = readFileSync(path);
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const [label, pattern] of secrets) {
    if (pattern.test(text)) failures.push(`Possible ${label} in ${normalized}`);
  }
  if (personalPaths.some((pattern) => pattern.test(text))) failures.push(`Personal absolute path in ${normalized}`);
}

for (const workflow of files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))) {
  if (!existsSync(join(root, workflow))) continue;
  const text = readFileSync(join(root, workflow), "utf8");
  if (/\bpull_request_target\b/.test(text)) failures.push(`High-risk pull_request_target trigger in ${workflow}`);
  if (!/^permissions:\s*(?:\n|$)/m.test(text)) failures.push(`Workflow must declare top-level permissions: ${workflow}`);
  if (/^permissions:\s*["']?write-all["']?\s*$/m.test(text)) failures.push(`Workflow may not use write-all: ${workflow}`);
  for (const match of text.matchAll(/^\s*-?\s*uses:\s*["']?([^\s"']+)["']?\s*(?:#.*)?$/gm)) {
    const action = match[1];
    if (action.startsWith("./") || action.startsWith("docker://")) continue;
    const ref = action.slice(action.lastIndexOf("@") + 1);
    if (!/^[a-f0-9]{40}$/.test(ref)) failures.push(`Action is not pinned to a full SHA in ${workflow}: ${action}`);
  }
}

if (failures.length) {
  console.error([...new Set(failures)].map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Repository guard passed (${files.length} paths).`);
