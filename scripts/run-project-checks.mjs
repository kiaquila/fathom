#!/usr/bin/env node

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, resolveWithin } from "./config.mjs";

const rootIndex = process.argv.indexOf("--root");
const root = resolve(rootIndex === -1 ? import.meta.dirname : process.argv[rootIndex + 1], rootIndex === -1 ? ".." : ".");

let config;
try {
  config = loadConfig(root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

for (const check of config.projectChecks) {
  console.log(`\n> ${check.name}`);
  const [command, ...args] = check.command;
  const result = spawnSync(command, args, {
    cwd: resolveWithin(root, check.cwd ?? ".", `${check.name} cwd`),
    env: process.env,
    shell: false,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`${check.name} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
