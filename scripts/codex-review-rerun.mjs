#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTrustedCodexLogin } from "./codex-review-helpers.mjs";

const ACTIVE_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending"
]);
const ACTIVE_RUN_POLL_INTERVAL_MS = 10_000;
const MAX_ACTIVE_RUN_POLLS = 24;

export function shouldRouteCodexReviewRerunEvent(event) {
  if (event?.review) return isTrustedCodexLogin(event.review.user?.login);
  if (!event?.issue?.pull_request || !event?.comment) return false;
  return /^(?:Codex Review:|<!-- codex-review-receipt:v1 -->|<!-- codex-pull-request-review-summary -->)/i
    .test(String(event.comment.body || "")) &&
    isTrustedCodexLogin(event.comment.user?.login);
}

export function selectTrustedCodexReviewRun(runs = [], { headSha, pullRequestNumber, defaultBranch }) {
  // A dispatched run's head_sha belongs to the policy branch, not the PR.
  // Bind it to the PR and proposed SHA through the workflow's exact run-name.
  const title = `Codex Review #${pullRequestNumber} @ ${headSha}`;
  const matchingRuns = runs
    .filter((run) => run.event === "workflow_dispatch" &&
      run.head_branch === defaultBranch && run.display_title === title)
    .sort((left, right) =>
      Date.parse(right.created_at || "") - Date.parse(left.created_at || "")
    );

  const activeRun = matchingRuns.find((run) => ACTIVE_STATUSES.has(run.status));
  if (activeRun) return { action: "wait_for_active_then_dispatch", run: activeRun };

  const rerunnableRun = matchingRuns.find((run) => run.status === "completed");
  if (rerunnableRun) return { action: "dispatch", run: rerunnableRun };

  return { action: "not_found", run: null };
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function defaultRequest(token, repository, path, options = {}) {
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

export async function dispatchCodexReviewForHead({
  token,
  repository,
  headSha,
  pullRequestNumber,
  evidenceUpdatedAt,
  request = defaultRequest,
  sleep = defaultSleep,
  maxActiveRunPolls = MAX_ACTIVE_RUN_POLLS
}) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(String(repository || "")) ||
      !/^[a-f0-9]{40}$/i.test(String(headSha || "")) ||
      !Number.isSafeInteger(Number(pullRequestNumber)) || Number(pullRequestNumber) < 1) {
    throw new Error("token, owner/repo, a full headSha, and a positive pullRequestNumber are required.");
  }

  const [owner, repo] = repository.split("/");
  const repositoryData = await request(token, repository, `/repos/${owner}/${repo}`);
  const defaultBranch = repositoryData?.default_branch;
  if (!defaultBranch) throw new Error("Could not resolve the repository default branch.");
  const selector = { headSha, pullRequestNumber, defaultBranch };
  const runsPath = `/repos/${owner}/${repo}/actions/workflows/codex-review.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(defaultBranch)}&per_page=100`;
  let data = await request(token, repository, runsPath);
  let selected = selectTrustedCodexReviewRun(data.workflow_runs || [], selector);

  for (let poll = 0; selected.action === "wait_for_active_then_dispatch" && poll < maxActiveRunPolls; poll += 1) {
    await sleep(ACTIVE_RUN_POLL_INTERVAL_MS);
    data = await request(token, repository, runsPath);
    selected = selectTrustedCodexReviewRun(data.workflow_runs || [], selector);
  }

  if (selected.action === "wait_for_active_then_dispatch") {
    throw new Error(
      `Codex Review run ${selected.run.id} remained active while waiting to evaluate new trusted evidence for ${headSha}.`
    );
  }

  const pull = await request(token, repository, `/repos/${owner}/${repo}/pulls/${pullRequestNumber}`);
  if (pull.state !== "open" || pull.head?.sha !== headSha) {
    return { action: "stale", run: null, message: `PR is closed or its head moved away from ${headSha}; no dispatch requested.` };
  }

  if (selected.action === "dispatch" && selected.run.conclusion === "success" &&
      Date.parse(selected.run.run_started_at || "") > Date.parse(evidenceUpdatedAt || "")) {
    return { action: "already_evaluated", run: selected.run,
      message: `Codex Review run ${selected.run.id} already evaluated this evidence update.` };
  }

  // Dispatch a fresh policy revision on the default branch. Rerunning an old
  // workflow run would retain its historical workflow definition instead.
  await request(token, repository,
    `/repos/${owner}/${repo}/actions/workflows/codex-review.yml/dispatches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: defaultBranch, inputs: {
        pr_number: String(pullRequestNumber), head_sha: headSha
      } })
    });
  return { action: "dispatched", run: selected.run,
    message: `Dispatched trusted Codex Review for PR #${pullRequestNumber} at ${headSha}.` };
}

async function resolveHeadSha({ token, repository, event, request = defaultRequest }) {
  const number = event?.pull_request?.number || (event?.issue?.pull_request && event.issue.number);
  if (!number) {
    throw new Error("Could not resolve pull request from event.");
  }
  const [owner, repo] = repository.split("/");
  const pull = await request(
    token,
    repository,
    `/repos/${owner}/${repo}/pulls/${number}`
  );
  return pull.head?.sha;
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
    console.log("Codex Review rerun skipped: event is not trusted Codex evidence.");
    return;
  }

  const headSha = await resolveHeadSha({ token, repository, event });
  const result = await dispatchCodexReviewForHead({
    token, repository, headSha,
    pullRequestNumber: event.pull_request?.number || event.issue?.number,
    evidenceUpdatedAt: event.review?.submitted_at || event.comment?.updated_at || event.comment?.created_at
  });
  console.log(result.message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Codex Review rerun failed: ${error.message}`);
    process.exit(1);
  }
}
