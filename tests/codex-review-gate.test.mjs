import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(
  process.env.WEB_DESIGN_REPOSITORY_ROOT || resolve(import.meta.dirname, "..")
);
const helpers = await import(pathToFileURL(
  resolve(repositoryRoot, "scripts/codex-review-helpers.mjs")
).href);
const rerun = await import(pathToFileURL(
  resolve(repositoryRoot, "scripts/codex-review-rerun.mjs")
).href);
const publisher = await import(pathToFileURL(
  resolve(repositoryRoot, "scripts/publish-codex-review-check.mjs")
).href);

const {
  classifyCodexNativeReview,
  createCodexReviewRequestMarkerBody,
  extractCodexReviewRequestMarker,
  isAcceptableCodexSummaryComment,
  isCodexReviewCommand,
  isCodexReviewCommandForHead,
  isStrictlyAfterCodexReviewRequest,
  isTrustedAssociation,
  latestCodexNativeReviewResult,
  latestCodexReviewRequestMarker,
  latestTrustedCodexReviewCommand
} = helpers;
const {
  rerunCodexReviewForHead,
  selectCodexReviewRun,
  shouldRouteCodexReviewRerunEvent
} = rerun;
const { checkRunPayload, publishCodexReviewCheck } = publisher;

const headSha = "abc123def456";
const codexUser = { login: "chatgpt-codex-connector[bot]" };

function markerBody() {
  return createCodexReviewRequestMarkerBody({
    headSha,
    requestId: "10-abc123def456",
    sourceCommentId: "10",
    sourceCommentCreatedAt: "2026-08-05T12:00:00Z",
    requestedAt: "2026-08-05T12:00:00Z"
  });
}

test("trusted request associations and the Codex command are explicit", () => {
  const commandHeadSha = "abcdef0123456789abcdef0123456789abcdef01";
  assert.equal(isTrustedAssociation("OWNER"), true);
  assert.equal(isTrustedAssociation("MEMBER"), true);
  assert.equal(isTrustedAssociation("COLLABORATOR"), true);
  assert.equal(isTrustedAssociation("CONTRIBUTOR"), false);
  assert.equal(isCodexReviewCommand("@codex review"), true);
  assert.equal(isCodexReviewCommand("please @CoDeX   review this"), true);
  assert.equal(isCodexReviewCommand("@codex implement"), false);
  assert.equal(isCodexReviewCommandForHead(`@codex review ${commandHeadSha}`, commandHeadSha), true);
  assert.equal(isCodexReviewCommandForHead(`@codex review ${commandHeadSha}`, "b".repeat(40)), false);
  assert.equal(isCodexReviewCommandForHead("@codex review", commandHeadSha), false);
});

test("request markers bind a GitHub Actions comment to the current head", () => {
  assert.deepEqual(extractCodexReviewRequestMarker(markerBody()), {
    requestId: "10-abc123def456",
    sha: headSha,
    sourceCommentId: "10",
    sourceCommentCreatedAt: "2026-08-05T12:00:00Z",
    requestedAt: "2026-08-05T12:00:00Z"
  });

  const trusted = {
    id: 11,
    body: markerBody(),
    created_at: "2026-08-05T12:00:01Z",
    user: { login: "github-actions[bot]" }
  };
  assert.equal(latestCodexReviewRequestMarker([trusted], headSha)?.requestId, "10-abc123def456");
  assert.equal(
    latestCodexReviewRequestMarker([{ ...trusted, user: { login: "repo-owner" } }], headSha),
    null,
    "a user-authored forged marker must not be accepted"
  );
  assert.equal(latestCodexReviewRequestMarker([trusted], "new-head"), null);
  const olderRequestPublishedLater = {
    ...trusted,
    body: createCodexReviewRequestMarkerBody({
      headSha,
      requestId: "20-abc123def456",
      sourceCommentId: "20",
      sourceCommentCreatedAt: "2026-08-05T12:00:00Z",
      requestedAt: "2026-08-05T12:00:00Z"
    }),
    created_at: "2026-08-05T12:00:02Z"
  };
  const laterRequestPublishedFirst = {
    ...trusted,
    body: createCodexReviewRequestMarkerBody({
      headSha,
      requestId: "21-abc123def456",
      sourceCommentId: "21",
      sourceCommentCreatedAt: "2026-08-05T12:00:01Z",
      requestedAt: "2026-08-05T12:00:01Z"
    }),
    created_at: "2026-08-05T12:00:01Z"
  };
  assert.equal(
    latestCodexReviewRequestMarker([olderRequestPublishedLater, laterRequestPublishedFirst], headSha)?.sourceCommentId,
    "21",
    "markers are ordered by their source request, not delayed marker publication"
  );
});

test("the installation PR can bind directly to a trusted request comment", () => {
  const installationHeadSha = "abcdef0123456789abcdef0123456789abcdef01";
  const command = {
    id: 12,
    body: `@codex review ${installationHeadSha}`,
    created_at: "2026-08-05T12:00:00Z",
    author_association: "OWNER",
    user: { login: "repo-owner", type: "User" }
  };
  assert.equal(
    latestTrustedCodexReviewCommand([command], [], installationHeadSha)?.bootstrap,
    true
  );
  assert.equal(
    latestTrustedCodexReviewCommand(
      [command],
      [{ event: "committed", created_at: "2026-08-05T12:01:00Z" }],
      "new-head"
    ),
    null,
    "a later head update changes the required command SHA"
  );
  assert.equal(
    latestTrustedCodexReviewCommand(
      [{ ...command, author_association: "CONTRIBUTOR" }],
      [],
      installationHeadSha
    ),
    null
  );
});

test("native Codex reviews are current-head and P0-P2 blocking", () => {
  const review = {
    id: 20,
    commit_id: headSha,
    state: "COMMENTED",
    submitted_at: "2026-08-05T12:01:00Z",
    user: codexUser
  };

  assert.equal(classifyCodexNativeReview(review, [], headSha), "pass");
  assert.equal(classifyCodexNativeReview(review, [{
    pull_request_review_id: 20,
    body: "![P3 Badge] Advisory note",
    user: codexUser
  }], headSha), "pass");
  assert.equal(classifyCodexNativeReview(review, [{
    pull_request_review_id: 20,
    body: "![P2 Badge] Blocking issue",
    user: codexUser
  }], headSha), "fail");
  assert.equal(classifyCodexNativeReview({
    ...review,
    state: "APPROVED"
  }, [{
    pull_request_review_id: 20,
    body: "![P2 Badge] Blocking issue",
    user: codexUser
  }], headSha), "fail", "approved reviews must still inspect inline findings");
  assert.equal(classifyCodexNativeReview(review, [{
    pull_request_review_id: 20,
    body: "Unclassified finding",
    user: codexUser
  }], headSha), "fail");
  assert.equal(classifyCodexNativeReview(review, [], "new-head"), null);
  assert.equal(
    classifyCodexNativeReview({ ...review, user: { login: "fake-codex[bot]" } }, [], headSha),
    null
  );
});

test("manual trusted validation publishes a head-bound check result", async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ id: 1 }) };
  };
  await publishCodexReviewCheck({
    token: "token",
    repository: "owner/repo",
    headSha: "a".repeat(40),
    conclusion: "success",
    detailsUrl: "https://github.com/owner/repo/actions/runs/1",
    request
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/repos/owner/repo/check-runs");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: "Codex Review",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
    details_url: "https://github.com/owner/repo/actions/runs/1",
    output: {
      title: "Codex Review passed",
      summary: `Trusted manual validation passed for ${"a".repeat(40)}.`
    }
  });
  assert.throws(
    () => checkRunPayload({ headSha: "short", conclusion: "success", detailsUrl: "https://example.com" }),
    /40-character commit SHA/
  );
  assert.throws(
    () => checkRunPayload({ headSha: "a".repeat(40), conclusion: "neutral", detailsUrl: "https://example.com" }),
    /success or failure/
  );
});

test("native reviews require a strictly later request timestamp", () => {
  const request = { sourceCommentCreatedAt: "2026-08-05T12:00:00Z" };
  assert.equal(isStrictlyAfterCodexReviewRequest("2026-08-05T12:00:01Z", request), true);
  assert.equal(
    isStrictlyAfterCodexReviewRequest("2026-08-05T12:00:00Z", request),
    false,
    "same-second reviews cannot be attributed unambiguously to the latest request"
  );
});

test("Codex no-findings summaries must name the reviewed head", () => {
  const summary = {
    body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
    created_at: "2026-08-05T12:01:00Z",
    id: "31",
    user: codexUser
  };
  assert.equal(isAcceptableCodexSummaryComment(summary, headSha), true);
  assert.equal(
    isAcceptableCodexSummaryComment(summary, headSha, "2026-08-05T12:00:00Z"),
    true,
    "a current-head summary posted after the request is acceptable"
  );
  assert.equal(
    isAcceptableCodexSummaryComment(summary, headSha, "2026-08-05T12:02:00Z"),
    false,
    "an older summary cannot satisfy a newer review request"
  );
  assert.equal(
    isAcceptableCodexSummaryComment(summary, headSha, "2026-08-05T12:01:00Z", "30"),
    true,
    "a same-second summary posted after the request is acceptable"
  );
  assert.equal(
    isAcceptableCodexSummaryComment(summary, headSha, "2026-08-05T12:01:00Z", "32"),
    false,
    "a same-second summary posted before the request is rejected"
  );
  assert.equal(isAcceptableCodexSummaryComment({ ...summary, body: "Codex Review: Didn't find any major issues." }, headSha), false);
  assert.equal(isAcceptableCodexSummaryComment({ ...summary, body: summary.body.replace(headSha.slice(0, 10), "0000000000") }, headSha), false);
});

test("the latest current-head native Codex result wins", () => {
  const olderPass = {
    id: 1,
    commit_id: headSha,
    state: "COMMENTED",
    submitted_at: "2026-08-05T12:01:00Z",
    user: codexUser
  };
  const newerFail = {
    ...olderPass,
    id: 2,
    submitted_at: "2026-08-05T12:02:00Z"
  };
  assert.equal(latestCodexNativeReviewResult([olderPass, newerFail], [{
    pull_request_review_id: 2,
    body: "P1 regression",
    user: codexUser
  }], headSha), "fail");
  assert.equal(
    latestCodexNativeReviewResult([
      { ...olderPass, submitted_at: "2026-08-05T12:03:00Z" },
      { ...newerFail, submitted_at: "2026-08-05T12:03:00Z" }
    ], [{
      pull_request_review_id: 2,
      body: "P1 regression",
      user: codexUser
    }], headSha),
    "fail",
    "a higher native review ID wins a same-second tie"
  );
});

test("rerun routing accepts only exact trusted Codex evidence", () => {
  assert.equal(shouldRouteCodexReviewRerunEvent({ review: { user: codexUser } }), true);
  assert.equal(
    shouldRouteCodexReviewRerunEvent({
      issue: { pull_request: {} },
      comment: { body: "Codex Review: Didn't find any major issues.", user: codexUser }
    }),
    true
  );
  assert.equal(
    shouldRouteCodexReviewRerunEvent({ review: { user: { login: "fake-codex[bot]" } } }),
    false
  );
});

test("rerun selection is head-bound and waits for active runs before rerunning", () => {
  const failed = {
    id: 30,
    event: "pull_request",
    head_sha: headSha,
    status: "completed",
    conclusion: "failure",
    created_at: "2026-08-05T12:00:00Z"
  };
  assert.deepEqual(selectCodexReviewRun([failed], headSha), { action: "rerun", run: failed });
  const succeeded = { ...failed, conclusion: "success" };
  assert.deepEqual(
    selectCodexReviewRun([succeeded], headSha),
    { action: "rerun", run: succeeded },
    "fresh trusted evidence must re-evaluate a previously successful gate run"
  );
  const active = {
    ...failed,
    id: 31,
    status: "in_progress",
    conclusion: null,
    created_at: "2026-08-05T12:01:00Z"
  };
  assert.deepEqual(
    selectCodexReviewRun([failed, active], headSha),
    { action: "wait_for_active_then_rerun", run: active }
  );
  assert.deepEqual(selectCodexReviewRun([failed], "new-head"), {
    action: "not_found",
    run: null
  });
});

test("rerun helper waits for an active gate before rerunning it", async () => {
  const calls = [];
  const active = {
    id: 42,
    event: "pull_request",
    head_sha: headSha,
    status: "in_progress",
    conclusion: null,
    created_at: "2026-08-05T12:00:00Z"
  };
  let readCount = 0;
  const request = async (_token, _repository, path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (path.includes("/actions/workflows/codex-review.yml/runs")) {
      readCount += 1;
      return {
        workflow_runs: [readCount === 1 ? active : {
          ...active,
          status: "completed",
          conclusion: "success"
        }]
      };
    }
    return null;
  };

  const result = await rerunCodexReviewForHead({
    token: "token",
    repository: "owner/repo",
    headSha,
    request,
    sleep: async () => {}
  });

  assert.equal(result.action, "rerun");
  assert.equal(calls.filter(({ method }) => method === "GET").length, 2);
  assert.deepEqual(calls.at(-1), {
    path: "/repos/owner/repo/actions/runs/42/rerun",
    method: "POST"
  });
});

test("rerun helper calls the Actions endpoint for a failed head-bound run", async () => {
  const calls = [];
  const request = async (_token, _repository, path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (path.includes("/actions/workflows/codex-review.yml/runs")) {
      return {
        workflow_runs: [{
          id: 42,
          event: "pull_request",
          head_sha: headSha,
          status: "completed",
          conclusion: "failure",
          created_at: "2026-08-05T12:00:00Z"
        }]
      };
    }
    return null;
  };

  const result = await rerunCodexReviewForHead({
    token: "token",
    repository: "owner/repo",
    headSha,
    request
  });
  assert.equal(result.action, "rerun");
  assert.deepEqual(calls, [
    {
      path: `/repos/owner/repo/actions/workflows/codex-review.yml/runs?event=pull_request&head_sha=${headSha}&per_page=100`,
      method: "GET"
    },
    { path: "/repos/owner/repo/actions/runs/42/rerun", method: "POST" }
  ]);
});
