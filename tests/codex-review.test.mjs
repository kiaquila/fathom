import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  classifyCodexNativeReview,
  isCodexReviewCommandForHead,
  isTrustedAssociation
} from "../scripts/codex-review-helpers.mjs";
import {
  dispatchCodexReviewForHead,
  shouldRouteCodexReviewRerunEvent
} from "../scripts/codex-review-rerun.mjs";
import { checkRunPayload } from "../scripts/publish-codex-review-check.mjs";

const root = resolve(import.meta.dirname, "..");
const headSha = "a".repeat(40);
const codexUser = { login: "chatgpt-codex-connector[bot]" };

test("review requests are trusted and bound to the complete current SHA", () => {
  assert.equal(isTrustedAssociation("OWNER"), true);
  assert.equal(isTrustedAssociation("CONTRIBUTOR"), false);
  assert.equal(isCodexReviewCommandForHead(`@codex review ${headSha}`, headSha), true);
  assert.equal(isCodexReviewCommandForHead("@codex review", headSha), false);
});

test("P0-P2 inline findings block a current-head Codex review", () => {
  const review = {
    id: 20,
    commit_id: headSha,
    state: "COMMENTED",
    submitted_at: "2026-09-03T12:01:00Z",
    user: codexUser
  };
  assert.equal(classifyCodexNativeReview(review, [], headSha), "pass");
  assert.equal(classifyCodexNativeReview(review, [{
    pull_request_review_id: 20,
    body: "![P1 Badge] Required fix",
    user: codexUser
  }], headSha), "fail");
});

test("only completed trusted Codex issue comments dispatch a new gate", () => {
  const base = { issue: { pull_request: {} }, comment: { user: codexUser } };
  assert.equal(shouldRouteCodexReviewRerunEvent({
    ...base,
    comment: {
      ...base.comment,
      body: "<!-- codex-pull-request-review-summary -->\n**Completed**"
    }
  }), true);
  assert.equal(shouldRouteCodexReviewRerunEvent({
    ...base,
    comment: {
      ...base.comment,
      body: "<!-- codex-pull-request-review-summary -->\n**Running**"
    }
  }), false);
  assert.equal(shouldRouteCodexReviewRerunEvent({ review: { user: codexUser } }), false);
});

test("the dispatcher runs the trusted default-branch workflow with head-bound inputs", async () => {
  const calls = [];
  const request = async (_token, path, options = {}) => {
    calls.push({ path, options });
    return null;
  };
  await dispatchCodexReviewForHead({
    token: "token",
    repository: "owner/repo",
    prNumber: 7,
    headSha,
    defaultBranch: "main",
    request
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/repos/owner/repo/actions/workflows/codex-review.yml/dispatches");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ref: "main",
    inputs: { pr_number: "7", head_sha: headSha }
  });
});

test("required Codex Review orchestration has no PR-controlled trigger", () => {
  const gateWorkflow = readFileSync(joinWorkflow("codex-review.yml"), "utf8");
  const rerunWorkflow = readFileSync(joinWorkflow("codex-review-rerun.yml"), "utf8");
  assert.doesNotMatch(gateWorkflow, /^\s*pull_request\s*:/m);
  assert.match(gateWorkflow, /^\s*workflow_dispatch\s*:/m);
  assert.doesNotMatch(rerunWorkflow, /^\s*pull_request_review\s*:/m);
  assert.match(rerunWorkflow, /^\s*issue_comment\s*:/m);
});

test("published gate results stay bound to a full commit SHA", () => {
  assert.equal(checkRunPayload({
    headSha,
    conclusion: "success",
    detailsUrl: "https://github.com/owner/repo/actions/runs/1"
  }).head_sha, headSha);
  assert.throws(() => checkRunPayload({
    headSha: "short",
    conclusion: "success",
    detailsUrl: "https://example.com"
  }), /40-character/);
});

function joinWorkflow(name) {
  return resolve(root, ".github", "workflows", name);
}
