#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTrustedCodexLogin } from "./codex-review-helpers.mjs";

async function defaultRequest(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export function shouldRouteCodexReviewRerunEvent(event) {
  if (!event?.issue?.pull_request || !event?.comment) return false;
  if (!isTrustedCodexLogin(event.comment.user?.login)) return false;
  const body = String(event.comment.body || "");
  return /^Codex Review:/i.test(body) || (
    body.includes("codex-pull-request-review-summary") &&
    body.includes("**Completed**")
  );
}

export async function dispatchCodexReviewForHead({
  token,
  repository,
  prNumber,
  headSha,
  defaultBranch,
  request = defaultRequest
}) {
  if (!token || !repository || !prNumber || !/^[a-f0-9]{40}$/i.test(String(headSha || ""))) {
    throw new Error("token, repository, prNumber, and a full headSha are required.");
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("repository must be owner/repo.");

  let trustedRef = defaultBranch;
  if (!trustedRef) {
    const repositoryData = await request(token, `/repos/${owner}/${repo}`);
    trustedRef = repositoryData?.default_branch;
  }
  if (!trustedRef) throw new Error("Could not resolve the repository default branch.");

  await request(
    token,
    `/repos/${owner}/${repo}/actions/workflows/codex-review.yml/dispatches`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ref: trustedRef,
        inputs: {
          pr_number: String(prNumber),
          head_sha: headSha
        }
      })
    }
  );

  return `Dispatched trusted Codex Review for PR #${prNumber} at ${headSha}.`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository || !eventPath) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_EVENT_PATH are required.");
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  if (!shouldRouteCodexReviewRerunEvent(event)) {
    console.log("Codex Review dispatch skipped: event is not completed trusted Codex evidence.");
    return;
  }

  const [owner, repo] = repository.split("/");
  const prNumber = event.issue.number;
  const pull = await defaultRequest(token, `/repos/${owner}/${repo}/pulls/${prNumber}`);
  const message = await dispatchCodexReviewForHead({
    token,
    repository,
    prNumber,
    headSha: pull.head?.sha,
    request: defaultRequest
  });
  console.log(message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Codex Review dispatch failed: ${error.message}`);
    process.exit(1);
  }
}
