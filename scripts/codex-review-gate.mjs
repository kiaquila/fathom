#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import {
  isAcceptableCodexSummaryComment,
  hasUnresolvedCodexFindings,
  isStrictlyAfterCodexReviewRequest,
  latestCodexNativeReviewResult,
  latestCodexReviewRequestMarker,
  latestTrustedCodexReviewCommand
} from "./codex-review-helpers.mjs";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.CODEX_REVIEW_PR_NUMBER;
const eventHeadSha = process.env.CODEX_REVIEW_HEAD_SHA;
const maxWaitMs = Number(process.env.CODEX_REVIEW_WAIT_MS || 30000);
const pollMs = Number(process.env.CODEX_REVIEW_POLL_MS || 5000);
const debounceMs = Number(process.env.CODEX_REVIEW_DEBOUNCE_MS || 5000);
const bootstrap = process.env.CODEX_REVIEW_BOOTSTRAP === "true";
const requireHeadMatch = process.env.CODEX_REVIEW_REQUIRE_HEAD_MATCH === "true";

if (!token || !repository || !prNumber) {
  console.error("GITHUB_TOKEN, GITHUB_REPOSITORY, and CODEX_REVIEW_PR_NUMBER are required.");
  process.exit(1);
}

const [owner, repo] = repository.split("/");

async function request(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function listPaginated(path) {
  const items = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    const batch = await request(`${path}${separator}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

async function fetchReviewThreads() {
  const threads = [];
  let cursor = null;
  do {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              nodes { isResolved comments(first: 1) { nodes { author { __typename login } } } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`,
        variables: { owner, repo, number: Number(prNumber), cursor }
      })
    });
    if (!response.ok) throw new Error(`Review threads: ${response.status}`);
    const result = await response.json();
    if (result.errors) throw new Error(`Review threads: ${JSON.stringify(result.errors)}`);
    const page = result.data?.repository?.pullRequest?.reviewThreads;
    if (!page?.nodes || !page.pageInfo) throw new Error("Missing review thread evidence.");
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !cursor) throw new Error("Missing review thread cursor.");
  } while (cursor);
  return threads;
}

async function fetchPull() {
  return request(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

const initialPull = await fetchPull();
const headSha = eventHeadSha || initialPull.head?.sha;

async function currentHeadMatches() {
  const pull = await fetchPull();
  return pull.head?.sha === headSha;
}

async function fetchEvidence() {
  if (!await currentHeadMatches()) return "stale";

  const comments = await listPaginated(`/repos/${owner}/${repo}/issues/${prNumber}/comments`);
  let timeline = null;
  let requestMarker = latestCodexReviewRequestMarker(comments, headSha);
  if (!requestMarker && bootstrap) {
    timeline = await listPaginated(`/repos/${owner}/${repo}/issues/${prNumber}/timeline`);
    requestMarker = latestTrustedCodexReviewCommand(comments, timeline, headSha);
  }
  if (!requestMarker) return "missing_marker";

  const [reviews, reviewComments, threads] = await Promise.all([
    listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`),
    listPaginated(`/repos/${owner}/${repo}/pulls/${prNumber}/comments`),
    fetchReviewThreads()
  ]);
  // A fresh request must never erase a blocking review or unresolved finding.
  if (hasUnresolvedCodexFindings(threads) ||
      latestCodexNativeReviewResult(reviews, reviewComments, headSha) === "fail") return "fail";
  const reviewsAfterRequest = reviews.filter((review) =>
    isStrictlyAfterCodexReviewRequest(review.submitted_at, requestMarker)
  );
  const nativeResult = latestCodexNativeReviewResult(
    reviewsAfterRequest,
    reviewComments,
    headSha
  );
  if (nativeResult) return nativeResult;

  return comments.some((comment) => isAcceptableCodexSummaryComment(
    comment,
    headSha,
    requestMarker.sourceCommentCreatedAt || requestMarker.requestedAt || requestMarker.commentCreatedAt,
    requestMarker.sourceCommentId
  ))
    ? "pass"
    : "pending";
}

if (Number.isFinite(debounceMs) && debounceMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, debounceMs));
}
if (!await currentHeadMatches()) {
  if (requireHeadMatch) {
    console.error(`Codex Review failed: selected ref ${headSha} is not the current head of PR #${prNumber}.`);
    process.exit(1);
  }
  console.log(`Codex Review skipped stale run for ${headSha}; PR head changed during debounce.`);
  process.exit(0);
}

const started = Date.now();
let outcome = "pending";
let lastError = null;

while (Date.now() - started <= maxWaitMs) {
  try {
    outcome = await fetchEvidence();
    lastError = null;
    if (["pass", "fail", "stale"].includes(outcome)) break;
  } catch (error) {
    lastError = error;
  }

  const remaining = maxWaitMs - (Date.now() - started);
  if (remaining <= 0) break;
  await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
}

if (outcome === "stale" && requireHeadMatch) {
  console.error(`Codex Review failed: selected head ${headSha} moved during evaluation.`);
  process.exit(1);
}
if (outcome === "stale") {
  console.log(`Codex Review skipped stale run for ${headSha}; PR head moved.`);
  process.exit(0);
}
if (outcome === "pass" && !await currentHeadMatches()) {
  console.error(`Codex Review failed: PR head changed while evaluating ${headSha}.`);
  process.exit(1);
}
if (outcome === "pass") {
  console.log(`Codex Review passed for ${headSha}.`);
  process.exit(0);
}

const next = outcome === "missing_marker"
  ? "A trusted OWNER, MEMBER, or COLLABORATOR must post '@codex review <current-full-head-sha>' on this PR."
  : outcome === "fail"
    ? "Resolve all P0-P2 findings, push fixes if needed, and request a new current-head review."
    : "Wait for Codex evidence; its review event will rerun this gate automatically.";
const summary = [
  "## Codex Review gate failed",
  "",
  `- head SHA: \`${headSha}\``,
  `- state: \`${outcome}\``,
  `- next: ${next}`,
  lastError ? `- API error: ${lastError.message}` : ""
].filter(Boolean).join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
console.error(summary.replaceAll("`", ""));
process.exit(1);
