import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createCodexReviewRequestMarkerBody,
  hasUnresolvedCodexFindings,
  isAcceptableCodexSummaryComment
} from "../scripts/codex-review-helpers.mjs";
import {
  dispatchCodexReviewForHead,
  shouldRouteCodexReviewRerunEvent
} from "../scripts/codex-review-rerun.mjs";

const headSha = "2667f79cd7676ff331730cabf661d38dbbcddb0d";
const codexUser = { login: "chatgpt-codex-connector[bot]" };
const requestedAt = "2026-10-15T12:00:00Z";
const receipt = "<!-- codex-review-receipt:v1 -->\n\n" +
  "Codex Review: Didn't find any major issues. :rocket:\n\n" +
  "**Reviewed commit:** `2667f79cd7`";
const helpFooter = `<details> <summary>ℹ️ About Codex in GitHub</summary>
<br/>
[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you
- Open a pull request for review
- Mark a draft as ready
- Comment "@codex review" or "@codex security review".
Codex reacts with 👀 while any review is running, comments if it has suggestions, and reacts with 👍 once all reviews finish with no findings.
</details>`;
const state = {
  code_review: { commit_sha: headSha, has_any_findings: false,
    has_unresolved_findings: false, status: "completed" },
  security_review: { commit_sha: null, has_any_findings: null,
    has_unresolved_findings: null, status: null }
};
const summary = `<!-- codex-pull-request-review-summary -->\n` +
  `<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n\n## Codex Review Summary`;
const comment = (body = receipt) => ({
  id: 30, user: codexUser, body,
  created_at: "2026-10-15T12:01:00Z", updated_at: "2026-10-15T12:01:00Z"
});

test("observed native receipt and legacy verdict retain exact commit binding", () => {
  for (const body of [receipt, receipt.replace("<!-- codex-review-receipt:v1 -->\n\n", ""),
    receipt.replace(":rocket:", "Keep it up!"),
    // Observed on this PR's native receipt, not a fixed set of encouragement.
    ...["What shall we delve into next?", "Another round soon, please!", "Delightful!",
      "Chef's kiss.", "You're on a roll.", "Can't wait for the next one!", "Breezy!",
      "Already looking forward to the next diff.", "More of your lovely PRs please.",
      "Keep them coming!", "Hooray!", ":+1:", ":tada:", "🚀"].map(suffix => receipt.replace(":rocket:", suffix)),
    receipt + "\n\n" + helpFooter,
    receipt.replace("`2667f79cd7`", `\`${headSha}\``)]) {
    assert.equal(isAcceptableCodexSummaryComment(comment(body), headSha, requestedAt, "20"), true, body);
  }
  for (const body of [
    receipt.replace("2667f79cd7", "0000000000"),
    receipt.replace("2667f79cd7", headSha.slice(0, 9)),
    receipt.replace("2667f79cd7", headSha.slice(0, 10) + "b".repeat(30)),
    receipt.replace(/\*\*Reviewed commit:[\s\S]*/, ""),
    receipt.replace("Didn't find any major issues.", "Found a P2 regression."),
    receipt.replace("Didn't find any major issues.", "Review in progress."),
    receipt.replace("Didn't find any major issues.", "Completed"),
    receipt + "\nP1: blocking finding", receipt + "\nReview incomplete",
    receipt.replace(":rocket:", "But there are unresolved findings."),
    receipt.replace(":rocket:", "However, I found a serious bug."),
    receipt.replace(":rocket:", "Delightful! However, I found a serious bug."),
    receipt.replace(":rocket:", "Unknown prose."),
    receipt + "\n**Reviewed commit:** `0000000000`",
    receipt + "\n<!-- codex-review-receipt:v1 -->",
    receipt.replace("receipt:v1", "receipt:v2"),
    receipt.replace("receipt:v1 -->", "receipt:v1"),
    summary, summary + "\n" + receipt,
    receipt + "\n<!-- codex-review-state:v1 {} -->", "👍", "Completed"
  ]) {
    assert.equal(isAcceptableCodexSummaryComment(comment(body), headSha, requestedAt, "20"), false, body);
  }
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(), user: { login: "spoof[bot]" } }, headSha), false);
  assert.equal(isAcceptableCodexSummaryComment(comment(), "2667f79cd7"), false);
  assert.equal(isAcceptableCodexSummaryComment(comment(), headSha, "2026-10-15T12:02:00Z"), false);
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(), created_at: requestedAt,
    updated_at: "2026-10-15T12:02:00Z", id: 10 }, headSha, requestedAt, "20"), false,
  "editing an old receipt does not prove a fresh review");
});

const workflow = readFileSync(new URL("../.github/workflows/codex-review-rerun.yml", import.meta.url), "utf8");
const jobIf = workflow.match(/    if: \|\n([\s\S]*?)(?:    # Only eligible|    runs-on:)/)?.[1];
function workflowRoutes(event, eventName = "issue_comment") {
  const github = { event_name: eventName, event: { issue: {}, comment: { user: {} },
    review: { user: {} }, ...event } };
  // Evaluate the actual workflow's boolean expression against the event fixtures.
  return Boolean(Function("github", "startsWith", `return (${jobIf});`)(
    github, (text, prefix) => String(text || "").toLowerCase().startsWith(prefix.toLowerCase())
  ));
}

test("created and edited native events pass both workflow and runtime routing", () => {
  assert.match(workflow, /issue_comment:\n    types: \[created, edited\]/);
  assert.doesNotMatch(workflow, /^concurrency:/m);
  assert.match(workflow, /^    concurrency:/m);
  assert.match(workflow, /queue: max\n      cancel-in-progress: false/);
  const requestWorkflow = readFileSync(new URL("../.github/workflows/codex-review-request.yml", import.meta.url), "utf8");
  assert.match(requestWorkflow, /^    concurrency:/m);
  assert.match(requestWorkflow, /queue: max\n      cancel-in-progress: false/);
  assert.match(requestWorkflow, /group: codex-review-rerun-\$\{\{ github.event.issue.number \}\}/);
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  for (const action of ["created", "edited"]) {
    for (const body of [receipt, "Codex Review: Didn't find any major issues.", summary,
      summary.replace('"completed"', '"in_progress"'),
      summary.replace('"has_any_findings":false', '"has_any_findings":true')]) {
      const event = { action, issue: { pull_request: {}, number: 1 }, comment: comment(body) };
      assert.equal(workflowRoutes(event), true, `${action}: ${body}`);
      assert.equal(shouldRouteCodexReviewRerunEvent(event), true);
      const spoofed = { ...event, comment: { ...event.comment, user: { login: "codex[bot]" } } };
      assert.equal(workflowRoutes(spoofed), false);
      assert.equal(shouldRouteCodexReviewRerunEvent(spoofed), false);
    }
  }
  for (const body of ["👍", "Completed", "Please review", "<!-- codex-review-receipt:v2 -->"]) {
    const event = { issue: { pull_request: {} }, comment: comment(body) };
    assert.equal(workflowRoutes(event), false);
    assert.equal(shouldRouteCodexReviewRerunEvent(event), false);
  }
  const issue = { issue: {}, comment: comment() };
  assert.equal(workflowRoutes(issue), false);
  assert.equal(shouldRouteCodexReviewRerunEvent(issue), false);
  const formal = { review: { user: codexUser } };
  assert.equal(workflowRoutes(formal, "pull_request_review"), true);
  assert.equal(shouldRouteCodexReviewRerunEvent(formal), true);
});

test("reruns coalesce evidence already evaluated by a later run", async () => {
  let polls = 0;
  const posts = [];
  const result = await dispatchCodexReviewForHead({
    token: "test", repository: "owner/repo", headSha, pullRequestNumber: 1,
    evidenceUpdatedAt: requestedAt,
    sleep: async () => {},
    request: async (_token, _repo, path, options = {}) => {
      if (options.method === "POST") posts.push(path);
      if (path === "/repos/owner/repo") return { default_branch: "main" };
      if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: headSha } };
      return { workflow_runs: [{ id: 42, event: "workflow_dispatch", head_branch: "main",
        display_title: `Codex Review #1 @ ${headSha}`,
        status: ++polls === 1 ? "in_progress" : "completed", conclusion: "success",
        run_started_at: "2026-10-15T12:00:01Z" }] };
    }
  });
  assert.equal(result.action, "already_evaluated");
  assert.equal(posts.length, 0);
});

test("a push while the old gate is active prevents requeue of the obsolete head", async () => {
  let polls = 0;
  const posts = [];
  const result = await dispatchCodexReviewForHead({
    token: "test", repository: "owner/repo", headSha, pullRequestNumber: 1,
    sleep: async () => {},
    request: async (_token, _repo, path, options = {}) => {
      if (options.method === "POST") posts.push(path);
      if (path === "/repos/owner/repo") return { default_branch: "main" };
      if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: "b".repeat(40) } };
      return { workflow_runs: [{ id: 42, event: "workflow_dispatch", head_branch: "main",
        display_title: `Codex Review #1 @ ${headSha}`,
        status: ++polls === 1 ? "in_progress" : "completed" }] };
    }
  });
  assert.equal(result.action, "stale");
  assert.equal(posts.length, 0);
});

const root = resolve(import.meta.dirname, "..");
test("the publishing workflow checks out only its default-branch policy commit", () => {
  const gate = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  assert.match(gate, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(gate, /^  pull_request:/m);
  assert.match(gate, /if: github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(gate, /ref: \$\{\{ github.sha \}\}/);
  assert.match(gate, /persist-credentials: false/);
  assert.doesNotMatch(gate, /Checkout proposed|ref: \$\{\{ inputs.head_sha|CODEX_REVIEW_BOOTSTRAP/);
  assert.equal((gate.match(/uses: actions\/checkout@/g) || []).length, 1);
  assert.match(gate, /run-name: "Codex Review #\$\{\{ inputs.pr_number \}\} @ \$\{\{ inputs.head_sha \}\}"/);
  assert.match(gate, /CODEX_REVIEW_REQUIRE_HEAD_MATCH: "true"/);
  assert.match(gate, /CODEX_REVIEW_CONCLUSION: \$\{\{ steps.gate.outcome == 'success' && 'success' \|\| 'failure' \}\}/);
  assert.match(gate, /queue: max\n  cancel-in-progress: false/);
});

function runGate(overrides = {}) {
  const fixture = {
    headSha, comments: [{ id: 21, user: { login: "github-actions[bot]" },
      body: createCodexReviewRequestMarkerBody({ headSha, requestId: "20-head", sourceCommentId: "20",
        sourceCommentCreatedAt: requestedAt, requestedAt }), created_at: requestedAt }, comment()],
    reviews: [], reviewComments: [], threads: [], ...overrides
  };
  const program = `
    const fixture = ${JSON.stringify(fixture)};
    let pulls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      let value;
      if (path.endsWith('/graphql')) {
        const cursor = JSON.parse(options.body).variables.cursor;
        const pages = fixture.threadPages || [fixture.threads];
        const index = cursor ? Number(cursor) : 0;
        value = {data:{repository:{pullRequest:{reviewThreads:{nodes:pages[index],
          pageInfo:{hasNextPage:index + 1 < pages.length, endCursor:String(index + 1)}}}}}};
      } else if (path.endsWith('/pulls/1')) {
        pulls++;
        value = {head:{sha:fixture.moveHeadAt && pulls >= fixture.moveHeadAt ? 'b'.repeat(40) : fixture.headSha}};
      } else if (path.endsWith('/issues/1/comments')) value = fixture.comments;
      else if (path.endsWith('/reviews')) value = fixture.reviews;
      else if (path.endsWith('/pulls/1/comments')) value = fixture.reviewComments;
      else throw new Error('Unexpected API: ' + url);
      return {ok:true, json:async () => value};
    };
    await import(${JSON.stringify(pathToFileURL(resolve(root, "scripts/codex-review-gate.mjs")).href)});
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "test",
      GITHUB_REPOSITORY: "owner/repo", CODEX_REVIEW_PR_NUMBER: "1", CODEX_REVIEW_HEAD_SHA: headSha,
      CODEX_REVIEW_DEBOUNCE_MS: "0", CODEX_REVIEW_WAIT_MS: "1", CODEX_REVIEW_POLL_MS: "1",
      CODEX_REVIEW_REQUIRE_HEAD_MATCH: "true", GITHUB_STEP_SUMMARY: "" }
  });
}
const codexThread = (isResolved = false) => ({ isResolved,
  comments: { nodes: [{ author: { __typename: "Bot", login: "chatgpt-codex-connector" } }] } });

test("the invoked gate passes receipts but never treats mutable activity summaries as approval", () => {
  const passed = runGate();
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /Codex Review passed/);
  for (const body of [summary, summary.replace('"completed"', '"in_progress"'),
    summary.replace('"has_any_findings":false', '"has_any_findings":true'),
    "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {malformed} -->\nCompleted"]) {
    const failed = runGate({ comments: [
      { user: { login: "github-actions[bot]" }, body: createCodexReviewRequestMarkerBody({
        headSha, requestId: "20-head", sourceCommentId: "20", requestedAt }) },
      { ...comment(body), created_at: "2026-10-14T12:00:00Z" }
    ] });
    assert.equal(failed.status, 1, failed.stdout);
    assert.doesNotMatch(failed.stdout, /Codex Review passed/);
  }
});

test("new requests cannot clear earlier blocking reviews or unresolved findings on any page", () => {
  const blockedReview = runGate({ reviews: [{ id: 1, commit_id: headSha, state: "CHANGES_REQUESTED",
    submitted_at: "2026-10-15T11:59:00Z", user: codexUser }] });
  assert.equal(blockedReview.status, 1);
  assert.match(blockedReview.stderr, /state: fail/);
  for (const threadPages of [[[], [codexThread()]], [[codexThread()]]]) {
    const blockedThread = runGate({ threadPages });
    assert.equal(blockedThread.status, 1);
    assert.match(blockedThread.stderr, /state: fail/);
  }
  const resolved = runGate({ threads: [codexThread(true)] });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(hasUnresolvedCodexFindings([{ isResolved: false,
    comments: { nodes: [{ author: { __typename: "User", login: "chatgpt-codex-connector" } }] } }]), false);
});

test("the gate rechecks HEAD after evidence before reporting success", () => {
  const moved = runGate({ moveHeadAt: 4 });
  assert.equal(moved.status, 1, moved.stdout);
  assert.match(moved.stderr, /head changed/);
});


test("the invoked gate accepts only full clean machine proof for opaque receipt endings", () => {
  const machine = summary + `\n\nThis comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-15T12:01:00Z">2026-10-15T12:01:00Z</relative-time> | \`${headSha.slice(0, 7)}\` | Manual request |`;
  const request = { user: { login: "github-actions[bot]" }, body: createCodexReviewRequestMarkerBody({ headSha, requestId: "20-head", sourceCommentId: "20", requestedAt }) };
  const opaque = { ...comment(receipt.replace(":rocket:", "Swish!")), created_at: "2026-10-15T12:00:30Z", updated_at: "2026-10-15T12:00:30Z" };
  const passed = runGate({ comments: [request, opaque, comment(machine)] });
  assert.equal(passed.status, 0, passed.stderr);
  for (const body of [machine.replace('"completed"', '"running"'), machine.replace('"has_any_findings":false', '"has_any_findings":true'), machine.replace(headSha, "0".repeat(40))])
    assert.equal(runGate({ comments: [request, opaque, comment(body)] }).status, 1, body);
});


test("the actual gate dates unknown edits by observation and static approval by publication", () => {
  const markerTime = "2026-10-15T12:02:00Z";
  const request = { user: { login: "github-actions[bot]" }, body: createCodexReviewRequestMarkerBody({ headSha, requestId: "20-head", sourceCommentId: "20", requestedAt: markerTime }) };
  const machine = summary + `\n\nThis comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-15T12:04:00Z">2026-10-15T12:04:00Z</relative-time> | \`${headSha.slice(0, 7)}\` | Manual request |`;
  const clean = { ...comment(machine), created_at: "2026-10-15T12:04:00Z", updated_at: "2026-10-15T12:04:00Z" };
  for (const [created, updated, expected] of [
    ["12:01", "12:03", 0], ["12:03", "12:03", 0],
    ["12:01", "12:05", 1], ["12:01", "12:04", 1],
    ["12:05", "12:05", 1]]) {
    const unknown = { ...comment(receipt.replace(":rocket:", "Swish!")), created_at: `2026-10-15T${created}:00Z`, updated_at: `2026-10-15T${updated}:00Z` };
    const result = runGate({ comments: [request, unknown, clean] });
    assert.equal(result.status, expected, `${created}/${updated}: ${result.stderr}`);
  }
  const oldPositive = { ...comment(), updated_at: "2026-10-15T12:05:00Z" };
  assert.equal(runGate({ comments: [request, oldPositive] }).status, 1);
  assert.equal(runGate({ comments: [request, oldPositive, clean] }).status, 0);
});


test("actual gate retains section findings until that section completes cleanly", () => {
  const time = minute => `2026-10-15T12:0${minute}:00Z`;
  const render = (value, securityTime = null) => `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(value)} -->\n\n## Codex Review Summary

This comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="${time(4)}">${time(4)}</relative-time> | \`${headSha.slice(0,7)}\` | Manual request |${value.security_review.status !== null ? `\n| 🛡️ **Security Review** | ✅ **Completed**${securityTime ? ` <relative-time datetime="${securityTime}">${securityTime}</relative-time>` : ""} | \`${headSha.slice(0,7)}\` | Manual request |` : ""}`;
  const marker = { user: { login: "github-actions[bot]" }, body: createCodexReviewRequestMarkerBody({ headSha, requestId: "repeat", sourceCommentId: "20", requestedAt: time(3) }) };
  const negativeState = { ...state, security_review: { ...state.code_review, has_any_findings: true, has_unresolved_findings: true } };
  const negative = { ...comment(render(negativeState, time(2))), created_at: time(2), updated_at: time(2) };
  const positive = { ...comment(receipt), created_at: time(5), updated_at: time(5) };
  const native = { id: 90, user: codexUser, commit_id: headSha, state: "APPROVED", body: "Approved.", submitted_at: time(5) };
  assert.equal(runGate({ comments: [marker, negative, positive], reviews: [native] }).status, 1);
  const markerProse = { ...negative, body: negative.body + "\nThe codex-review-state: parser has a defect." };
  assert.equal(runGate({ comments: [marker, markerProse, positive], reviews: [native] }).status, 1, "ordinary marker prose cannot erase findings");
  const cleanState = { ...state, security_review: { ...state.code_review } };
  for (const [value, securityTime, expected] of [[state, null, 1], [cleanState, null, 1], [cleanState, time(2), 1], [cleanState, time(2).replace("00Z", "00.999Z"), 1], [cleanState, "2026-02-30T12:04:00Z", 1], [cleanState, "October 15, 2026 12:04:00 GMT", 1], [cleanState, time(4), 0]]) {
    const clean = { ...comment(render(value, securityTime)), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ comments: [marker, negative, clean, positive], reviews: [native] }).status, expected);
  }
  const duplicateSection = { ...negative, body: render(cleanState, time(4)) + "\n| 🛡️ **Security Review** | 🔄 **Running** |", created_at: time(4), updated_at: time(4) };
  assert.equal(runGate({ comments: [marker, negative, duplicateSection] }).status, 1, "duplicate affected section cannot clear findings");
  const clean = { ...comment(render(state)), created_at: time(4), updated_at: time(4) };
  assert.equal(runGate({ comments: [marker, markerProse, clean, positive], reviews: [native] }).status, 1, "marker prose cannot erase historical security findings before code-only snapshot");
  for (const body of [negative.body.replaceAll(headSha, "b".repeat(40)), negative.body.replace('"has_any_findings":true', '"has_any_findings":true,"has_any_findings":true'), negative.body.replace(":v1", ":v2")])
    assert.equal(runGate({ comments: [marker, { ...negative, body }, clean] }).status, 0);
  for (const section of ["code_review", "security_review"]) {
    const value = { ...state, [section]: { ...state.code_review, has_any_findings: true, has_unresolved_findings: true } };
    const editedNegative = { ...negative, body: render(value, time(1)).replaceAll(time(4), time(1)), updated_at: time(5) };
    const fullClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ comments: [marker, editedNegative, fullClean] }).status, 0, section + " other-section edit cannot renew old finding");
  }
  const mixedState = { ...negativeState, code_review: { ...negativeState.security_review } };
  const oldMixed = { ...negative, body: render(mixedState, time(3)).replaceAll(time(4), time(1)), updated_at: time(3) };
  const staggeredClean = { ...negative, body: render(cleanState, time(5)).replaceAll(time(4), time(4)), created_at: time(5), updated_at: time(5) };
  assert.equal(runGate({ comments: [marker, oldMixed, staggeredClean] }).status, 0, "each clean section outruns its finding independently");
  for (const mode of ["row", "false-companion", "global", "malformed", "older-clear", "none", "old-receipt", "malformed-receipt", "running"]) {
    let observedBody = render(mode === "false-companion" ? { ...mixedState, security_review: { ...mixedState.security_review, has_any_findings: false, has_unresolved_findings: false } } : mixedState, time(6)).replaceAll(time(4), time(1)).replace(/(\| 🛡️[^\n]*\| )Manual request( \|)/, "$1P1 blocker$2");
    if (mode === "global") observedBody += "\nP1 blocker";
    if (mode === "malformed") observedBody = observedBody.replace(time(6) + "</relative-time>", time(5) + "</relative-time>");
    const observed = { ...negative, body: observedBody, updated_at: time(6) };
    const codeClear = { ...negative, body: render(state), created_at: time(4), updated_at: time(4) };
    const clearTime = time(mode === "older-clear" ? 5 : 7);
    const securityClear = { ...negative, body: render(cleanState, clearTime).replaceAll(time(4), time(1)), created_at: clearTime, updated_at: clearTime };
    if (mode === "running") securityClear.body = securityClear.body.replaceAll('"status":"completed"', '"status":"running"');
    const current = { ...positive, body: mode === "malformed-receipt" ? receipt.replace(headSha.slice(0,10), "b".repeat(10)) : receipt, created_at: time(mode === "old-receipt" ? 2 : 8), updated_at: time(8) };
    const actual = runGate({ comments: [marker, observed, codeClear, securityClear, ...(mode === "none" ? [] : [current])], reviews: [native] });
    assert.equal(actual.status, mode === "row" ? 0 : 1, "section-scoped warning clock " + mode + "\n" + actual.stdout + actual.stderr);
  }
  const foreignCodeSecurity = { ...negative, body: render({ ...negativeState, code_review: { ...negativeState.code_review, commit_sha: "b".repeat(40) } }, time(2)) };
  assert.equal(runGate({ comments: [marker, foreignCodeSecurity, clean] }).status, 1, "current-head security findings survive foreign-head code state");
  for (const other of [{}, { status: "running" }, { commit_sha: "b".repeat(40) }]) {
    const historicalNegative = { ...negative, body: render(negativeState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(1) };
    let resolution = { ...negative, body: render({ ...cleanState, code_review: { ...cleanState.code_review, ...other } }, time(2)).replaceAll(time(4), time(2)).replace("| 📝 **Code Review** | ✅ **Completed**", other.status === "running" ? "| 📝 **Code Review** | 🔄 **Running**" : "| 📝 **Code Review** | ✅ **Completed**"), created_at: time(2), updated_at: time(2) };
    if (other.commit_sha) resolution.body = resolution.body.replace(/(\| 📝 \*\*Code Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2");
    assert.equal(runGate({ comments: [marker, historicalNegative, resolution, clean, positive], reviews: [native] }).status, 0, "historical section resolution survives repeated request and other-section progress");
  }
  const oldFinding = { ...negative, body: render(negativeState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(1) };
  const malformedResolution = { ...negative, body: render(cleanState, time(2)).replaceAll(time(4), time(2)).replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "$1 Do not merge."), created_at: time(2), updated_at: time(2) };
  assert.equal(runGate({ comments: [marker, oldFinding, malformedResolution, clean, positive], reviews: [native] }).status, 1, "fifth-column prose cannot supply canonical section resolution");
  const editedForeignNegative = { ...negative, body: render({ ...negativeState, code_review: { ...negativeState.code_review, commit_sha: "b".repeat(40) } }, time(1)).replaceAll(time(4), time(1)).replace(/(\| 📝 \*\*Code Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2"), created_at: time(1), updated_at: time(5) };
  const historicalResolution = { ...negative, body: render(cleanState, time(2)).replaceAll(time(4), time(2)), created_at: time(2), updated_at: time(2) };
  assert.equal(runGate({ comments: [marker, editedForeignNegative, historicalResolution, clean, positive], reviews: [native] }).status, 0, "resolved current-head security finding does not inherit foreign code-section edit clock");
  const wrongRowHead = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
  assert.equal(runGate({ comments: [marker, oldFinding, wrongRowHead, clean, positive], reviews: [native] }).status, 1, "affected row SHA must match current head");
  for (const status of ["running", "failed"]) {
    const activeNegative = { ...negative, body: render({ ...negativeState, security_review: { ...negativeState.security_review, status } }, time(1)), updated_at: time(5) };
    const laterClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ comments: [marker, activeNegative, laterClean, positive], reviews: [native] }).status, 1, "noncompleted own status retains update clock despite old Completed row");
  }
  const companionState = { ...state, code_review: { ...cleanState.code_review, has_any_findings: true, has_unresolved_findings: true }, security_review: { ...cleanState.security_review, commit_sha: "b".repeat(40) } };
  const companionNegative = { ...negative, body: render(companionState, time(1)).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(5) };
  assert.equal(runGate({ comments: [marker, companionNegative, historicalResolution, clean, positive], reviews: [native] }).status, 1, "resolved finding cannot discard mismatched companion row");
  const validCompanionNegative = { ...companionNegative, body: companionNegative.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
  assert.equal(runGate({ comments: [marker, validCompanionNegative, historicalResolution, clean, positive], reviews: [native] }).status, 0, "coherent foreign-head companion does not renew resolved finding");
  for (const foreignFlags of [false, true]) {
    const foreignState = { ...companionState, security_review: { ...companionState.security_review, has_any_findings: foreignFlags, has_unresolved_findings: foreignFlags } };
    const malformedCompanion = { ...companionNegative, body: render(foreignState, time(1)).replaceAll(time(4), time(1)) };
    assert.equal(runGate({ comments: [marker, malformedCompanion, historicalResolution, clean, positive], reviews: [native] }).status, 1, "foreign finding flags cannot hide malformed companion");
    const coherentCompanion = { ...malformedCompanion, body: malformedCompanion.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*`)[a-f0-9]{7}(`)/, "$1bbbbbbb$2") };
    assert.equal(runGate({ comments: [marker, coherentCompanion, historicalResolution, clean, positive], reviews: [native] }).status, 0);
  }
  for (const indent of ["    ", "\t"]) {
    const indentMarkers = body => body.replace(/^<!-- codex-/gm, indent + "<!-- codex-");
    const exampleFinding = { ...oldFinding, body: indentMarkers(oldFinding.body) };
    assert.equal(runGate({ comments: [marker, exampleFinding, clean, positive], reviews: [native] }).status, 0, "indented markers cannot latch historical findings");
    const exampleClear = { ...historicalResolution, body: indentMarkers(historicalResolution.body) };
    assert.equal(runGate({ comments: [marker, oldFinding, exampleClear, clean, positive], reviews: [native] }).status, 1, "indented markers cannot resolve findings");
    const exampleApproval = { ...negative, body: indentMarkers(render(cleanState, time(4))), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ comments: [marker, exampleApproval] }).status, 1, "indented markers cannot approve");
  }
  const unknownProtocolClear = { ...historicalResolution, body: historicalResolution.body + "\n<!-- CODEX-unknown -->" };
  assert.equal(runGate({ comments: [marker, oldFinding, unknownProtocolClear, clean, positive], reviews: [native] }).status, 1, "unknown protocol HTML cannot clear historical finding");
  const uppercaseSignal = { ...negative, body: render(cleanState, time(4)).replaceAll("codex-", "CODEX-"), created_at: time(4), updated_at: time(5) };
  assert.equal(runGate({ comments: [marker, uppercaseSignal, clean, positive], reviews: [native] }).status, 1, "uppercase protocol is observed as pending");
  const genuineWithExample = { ...oldFinding, body: oldFinding.body + "\n    <!-- codex-review-state:v1 example -->" };
  assert.equal(runGate({ comments: [marker, genuineWithExample, clean, positive], reviews: [native] }).status, 1, "later indented example cannot erase genuine finding");
  const dangerousCompanion = { ...historicalResolution, body: historicalResolution.body.replace(/\| 📝 \*\*Code Review\*\*[^\n]*/, "| 📝 **Code Review** | ⚠️ Do not merge | `" + headSha.slice(0,7) + "` | Manual request |") };
  assert.equal(runGate({ comments: [marker, oldFinding, dangerousCompanion, clean, positive], reviews: [native] }).status, 1, "projection cannot erase companion row verdict");
  const codeFindingOnly = { ...negative, body: render({ ...state, code_review: { ...cleanState.code_review, has_any_findings: true, has_unresolved_findings: true } }).replaceAll(time(4), time(1)), created_at: time(1), updated_at: time(5) };
  const hiddenNullRow = { ...codeFindingOnly, body: codeFindingOnly.body + "\n    | 🛡️ **Security Review** | ⚠️ Do not merge |" };
  assert.equal(runGate({ comments: [marker, hiddenNullRow, historicalResolution, clean, positive], reviews: [native] }).status, 1, "inactive section label cannot hide behind indentation");
  for (const companion of ["🛡️ **Security Review** | ✅ **Completed** |", "<details><summary>ℹ️ About Codex in GitHub</summary>information</details>\n| 🛡️ **Security Review** | ⚠️ Failed |\n</details>", "<details><summary>ℹ️ About Codex in GitHub</summary>\n> | 🛡️ **Security&#32;Review** | ✅ **Completed** |\n</details>"]) {
    const ambiguousNull = { ...codeFindingOnly, body: codeFindingOnly.body + "\n" + companion };
    assert.equal(runGate({ comments: [marker, ambiguousNull, historicalResolution, clean, positive], reviews: [native] }).status, 1, "rendered inactive companion contradicts null state independent of container");
  }
  for (const label of ["Security&#32;Review", "Security&nbsp;Review", "Security<strong> </strong>Review", "SECURITY REVIEW"]) {
    const renderedNull = { ...hiddenNullRow, body: hiddenNullRow.body.replace("**Security Review**", "**" + label + "**").replace("⚠️ Do not merge", "Completed") };
    assert.equal(runGate({ comments: [marker, renderedNull, historicalResolution, clean, positive], reviews: [native] }).status, 1, "rendered inactive companion label keeps observed edit authority");
  }
  for (const whitespace of [" ", "\n", "   "]) {
    const normalizedResolution = { ...historicalResolution, body: whitespace + historicalResolution.body };
    assert.equal(runGate({ comments: [marker, oldFinding, normalizedResolution, clean, positive], reviews: [native] }).status, 0, "accepted envelope whitespace remains valid resolution");
  }
  const foreignResolutionState = { ...cleanState, code_review: { ...cleanState.code_review, commit_sha: "b".repeat(40) } };
  const mismatchedResolution = { ...historicalResolution, body: render(foreignResolutionState, time(2)).replaceAll(time(4), time(2)) };
  assert.equal(runGate({ comments: [marker, oldFinding, mismatchedResolution, clean, positive], reviews: [native] }).status, 1, "historical clearing requires coherent companion SHA");
  const genuineWithFencedExample = { ...oldFinding, body: oldFinding.body + "\n```html\n<!-- codex-review-state:v1 example -->\n```" };
  assert.equal(runGate({ comments: [marker, genuineWithFencedExample, clean, positive], reviews: [native] }).status, 1, "later fenced example cannot erase genuine finding");
  for (const indent of ["    ", "\t"]) {
    const bomExample = { ...negative, body: "\uFEFF" + render(cleanState, time(4)).replace(/^<!-- codex-/gm, indent + "<!-- codex-"), created_at: time(4), updated_at: time(4) };
    assert.equal(runGate({ comments: [marker, bomExample] }).status, 1, "BOM cannot normalize indented protocol example into authority");
  }
  const runningStateCompletedRow = { ...historicalResolution, body: render({ ...cleanState, code_review: { ...cleanState.code_review, status: "running" } }, time(2)).replaceAll(time(4), time(2)) };
  assert.equal(runGate({ comments: [marker, oldFinding, runningStateCompletedRow, clean, positive], reviews: [native] }).status, 1, "running typed companion requires Running rendering");
  for (const indent of ["    ", "\t"]) {
    const indentedTodoClear = { ...historicalResolution, body: historicalResolution.body + "\n" + indent + "<!-- TODO -->" };
    assert.equal(runGate({ comments: [marker, oldFinding, indentedTodoClear, clean, positive], reviews: [native] }).status, 1, "indented nonprotocol HTML cannot normalize into history clearance");
  }
  for (const trailing of ["\n> ```html\n> <!-- codex-review-state:v1 {} -->\n> ```", "\n<!-- codex-review-state:v1 {} -->"]) {
  const genuineWithQuotedFence = { ...oldFinding, body: oldFinding.body + trailing };
  assert.equal(runGate({ comments: [marker, genuineWithQuotedFence, clean, positive], reviews: [native] }).status, 1, "nested blockquote fenced example cannot erase genuine finding");
  }
  const fullyClean = { ...negative, body: render(cleanState, time(4)), created_at: time(4), updated_at: time(4) };
  const lateVisibleNegative = { ...oldFinding, body: oldFinding.body + "\nP1: Security review failed.", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, lateVisibleNegative, fullyClean, positive], reviews: [native] }).status, 1, "visible negative edit uses observation clock");
  const lateFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound an issue", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, lateFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "singular finding article keeps observed edit time");
  const lateHtmlFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound <em>an</em> issue", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, lateHtmlFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "rendered finding article keeps observed edit time");
  const lateWordedFoundNegative = { ...oldFinding, body: oldFinding.body + "\nFound one issue", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, lateWordedFoundNegative, fullyClean, positive], reviews: [native] }).status, 1, "worded finding count keeps observed edit time");
  for (const statement of ["A bug is present", "A problem persists", "An issue is outstanding", "A security issue got flagged.", "No code changes were needed and one security issue remains.", "This issue is not resolved.", "Issues persist.", "Findings are outstanding.", "A security issue has gotten flagged.", "A security issue had gotten flagged.", "Security issue: authentication bypass.", "A security issue: was flagged.", "A vulnerability was detected."]) {
    const footerNegative = { ...oldFinding, body: oldFinding.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>" + statement + "\n</details>", updated_at: time(6) };
    assert.equal(runGate({ comments: [marker, footerNegative, fullyClean, positive], reviews: [native] }).status, 1, "appended About finding retains observation clock: " + statement);
    if (statement === "A security issue got flagged.") {
      const recovery = { ...fullyClean, body: render(cleanState, time(7)), created_at: time(7), updated_at: time(7) };
      assert.equal(runGate({ comments: [marker, footerNegative, recovery, positive], reviews: [native] }).status, 0, "new canonical clear retires got-passive warning");
    }
  }
  const lateBugNegative = { ...oldFinding, body: oldFinding.body + "\nThere is a bug.", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, lateBugNegative, fullyClean, positive], reviews: [native] }).status, 1, "explicit bug edit keeps observed time");
  const bugRecovery = { ...fullyClean, body: render(cleanState, time(7)), created_at: time(7), updated_at: time(7) };
  assert.equal(runGate({ comments: [marker, lateBugNegative, bugRecovery, positive], reviews: [native] }).status, 0, "genuinely newer canonical clear resolves bug edit");
  for (const benign of ["Found <em>no</em> issues", "Do&nbsp not&nbsp merge", "<!-- P1 blocker -->", "There is no bug.", "Found issues: zero", "Issues found: zero", "No security issues found", "[safe]: P1", "The word issues is emphasized.", "The words security issues are documented below", "A security issue got eliminated.", "No code or security issues were found.", "No issues or findings were found.", "There is an issue that was resolved", "This is not an issue.", "This is no longer an issue.", "This is not considered a bug.", "This isn't a bug.", "This is a bug-free change", "P_1 is not a priority token", "P*1", "paragraph\n<span>\n[safe](P1)", "[safe]: /url\n  \"title [^note]\"\n[^note]: P1", "There is not a bug.", "Found\n\nan issue.", "Found <code>0</code> issues", "[^doc]: P1", "[safe](https://example.test/[^note])\n\n[^note]: P1 example", "[safe]: https://example.test/[^note]\n[^note]: P1 example", "[^bad label]: P1", "note[^bad label]\n\n[^bad label]: P1", "[^doc]: safe\n  P1", "[^doc]: safe\n    P1", "<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[^doc]: safe\n  P1\n</details>", "<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[^doc]: safe\n    P1\n</details>", "> <div>\n[safe](P1)", "- <div>\n\n[safe](P1)", "<div>\n<img / P1>\n</div>", "<div>\n</span P1>\n</div>", "[safe](" + "(".repeat(32) + "P1" + ")".repeat(32) + ")"]) {
    const noFindingsEdit = { ...oldFinding, body: oldFinding.body + "\n" + benign, updated_at: time(6) };
    assert.equal(runGate({ comments: [marker, noFindingsEdit, fullyClean, positive], reviews: [native] }).status, 0, "rendered no findings does not renew old negative: " + benign);
  }
  const footerNegative = { ...oldFinding, body: oldFinding.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>P1 remains.</details>", updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, footerNegative, fullyClean, positive], reviews: [native] }).status, 1, "visible About-footer finding uses observed edit time");

  const warningLabel = { ...oldFinding, body: oldFinding.body.replace("| 🛡️ **Security Review** |", "| ⚠️ P1 🛡️ **Security Review** |"), updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, warningLabel, fullyClean, positive], reviews: [native] }).status, 1, "warning-bearing own row cannot borrow old completion clock");
  const malformedStatusState = { ...negativeState, security_review: { ...negativeState.security_review, status: "<!-- codex-review-state:" } };
  const malformedStatus = { ...oldFinding, body: render(malformedStatusState, time(1)).replaceAll(time(4), time(1)) };
  assert.equal(runGate({ comments: [marker, malformedStatus, clean, positive], reviews: [native] }).status, 0, "duplicate protocol inside envelope is not durable authority");
  const fencedResolution = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "```markdown\n$1\n````") };
  assert.equal(runGate({ comments: [marker, oldFinding, fencedResolution, clean, positive], reviews: [native] }).status, 1, "fenced completed row cannot clear findings");
  for (const indent of ["    ", "\t", "\uFEFF    ", "<!-- presentation metadata -->    "]) {
    const codeHeadingClear = { ...historicalResolution, body: historicalResolution.body.replace("## Codex Review Summary", indent + "## Codex Review Summary") };
    assert.equal(runGate({ comments: [marker, oldFinding, codeHeadingClear, clean, positive], reviews: [native] }).status, 1, "indented code heading cannot clear findings");
  }
  const pipeCommentClear = { ...historicalResolution, body: historicalResolution.body.replaceAll("Manual request", "Manual <!-- | --> request") };
  assert.equal(runGate({ comments: [marker, oldFinding, pipeCommentClear, clean, positive], reviews: [native] }).status, 1, "raw table delimiters cannot vanish in comments");
  const escapedTickClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + "\\`[safe](P1)\\`" + "\n</details>" };
  assert.equal(runGate({ comments: [marker, oldFinding, escapedTickClear, clean, positive], reviews: [native] }).status, 0, "escaped opening backticks leave active link destination hidden");
  const safeReferenceClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n[safe][doc]\n[doc]: https://example.test/P1\n</details>" };
  assert.equal(runGate({ comments: [marker, oldFinding, safeReferenceClear, clean, positive], reviews: [native] }).status, 0, "recognized reference definition destination is hidden");
  for (const tag of ["script", "style"]) {
    const rawDetailsClear = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<details>\n<" + tag + ">\n</details>\n</" + tag + ">\n$1\n</details>") };
    assert.equal(runGate({ comments: [marker, oldFinding, rawDetailsClear, clean, positive], reviews: [native] }).status, 1, "raw text details closer cannot grant row authority");
  }
  for (const literal of ["<span>P&#49</span> blocker", "`P&#49` blocker"]) {
    const markdownNumericClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + literal + "\n</details>" };
    assert.equal(runGate({ comments: [marker, oldFinding, markdownNumericClear, clean, positive], reviews: [native] }).status, 0, "semicolonless numeric text stays literal outside raw HTML blocks");
  }
  const afterVisibleClear = { ...fullyClean, body: fullyClean.body.replaceAll(time(4), time(7)), created_at: time(7), updated_at: time(7) };
  assert.equal(runGate({ comments: [marker, lateVisibleNegative, afterVisibleClear, positive], reviews: [native] }).status, 0, "newer strict same-section completion clears earlier visible finding");
  for (const warning of ["P&#49; blocker", "P&#x31; blocker", "P*1* blocker", "Do&#32;not&#32;merge", "Do&MediumSpace;not&MediumSpace;merge", "Do&hairsp;not&hairsp;merge", "P<strong>1</strong> blocker", "Do <em>not</em> merge", "Do [not](https://example.com) merge", "Do [not]( https://example.com ) merge", "Do [not]() merge", "P&#8203;1 blocker", "P\uFE0F1 blocker", "[safe](P1>)", "Do [not] merge\n[not]:\n  https://example.com", "\n> ~~~\n> [safe](P1)\n> ~~~", "`<P1> blocker`", "```\n<P1> blocker\n```", "\n\n    [safe](P1)", "\n\n\t[safe](P1)", "[safe [inner](url)](P1)", "<P1?> blocker", "[safe\\]( P1)", "`[safe](P1)`", "```\n[safe](P1)\n```", "<code>[safe](P1)</code>", "\\[safe](P1)", "[safe\n\nlabel](P1)", "Do [not\n](https://example.com) merge", "Do<br>not<br>merge", "P`1` blocker", "Do `not` merge", "[foo[bar]: https://example.test/P1", "[doc]: P1)", "<div>\n[safe](P1)\n</div>", "<div>\n[P1]: https://example.test\n</div>", "Found\nan issue.", "<div>\nP&#49 blocker\n</div>", "<div>\nDo&#32not&#32merge\n</div>", "Found issues.", "Found an issue", "Found one issue", "There is an issue.", "There is 1 issue", "Detected 1 issue", "Detected an issue.", "1 bug is not fixed", "There is an issue that was not resolved", "This is not safe because there is a bug.", "Found 1,000 issues.", "One security issue was identified", "Multiple security issues remain", "Found 1 issue: zero", "A bug is present", "A problem persists", "An issue is outstanding", "No code issues: 1 security issue found", "Found an issue that is not yet resolved.", "Not clean: one bug remains.", "This is not resolved: a bug remains.", "\n\n    safe\n<span>\n[safe](P1)", "> safe\n<span>\n[safe](P1)", "- safe\n<span>\n[safe](P1)", "There is a bug.", "Bug found.", "One issue found.", "Multiple findings remain.", "An issue was detected.", "Several issues were detected.", "Some problems remain.", "paragraph\n\n<span>\n[safe](P1)", "<!-->P1 blocker", "<!--->P1 blocker", "<div>Do&nbsp not&nbsp merge</div>", "note[^SS]\n\n[^ß]: P1 blocker", "1 unresolved finding", "1 security issue found", "note[^DOC]\n\n[^doc]: P1", "note[^doc]\n\n[^doc]: safe\n  P1", "note[^doc]\n\n[^doc]: safe\n    P1", "root[^a]\n\n[^a]: safe [^b]\n[^b]: P1", "[^bad label]: P1 blocker", "<img / P1>", "<img =P1>", "<span P1?>safe</span>", "note[^doc]\n\n[^doc]: P1", "[safe][^doc]\n\n[^doc]: P1", "[safe](" + "(".repeat(33) + "P1" + ")".repeat(33) + ")", "</span P1>", "Found 0 code issues and 1 security issue", "-  <div>\n \t[safe](P1)\n</div>", "- > <div>\n  > [safe](P1)\n  > </div>", "> - <div>\n>   [safe](P1)\n>   </div>", "> <div>\n> [safe](P1)\n> </div>", "- <div>\n  [safe](P1)\n  </div>", "Security review failed.", "Review pending.", "Changes requested.", "[safe](P1\\ blocker)", "<!--[x](foo-->P1)", "[safe][P1 blocker]", 'Do [not](https://example.com "title") merge', "Do [not](https://example.com 'title') merge", "Do [not](https://example.com (title)) merge", 'Do <span title="&#34;>">not</span> merge', "Do [not][] merge\n[not]: https://example.com", "Do [not] merge\n[not]: https://example.com", '<img src="invalid" alt="P1 blocker">', "[safe](P1 blocker)", "Do [not][x] merge\n[x]: https://example.com", 'Do <span title=">">not</span> merge', "Do [not](https://example.com/(x)) merge", "Found **1** issue", "Found &#49; issue", "P<!--hidden-->1 blocker", "Do <!--hidden-->not merge", "Do&#8203;not&#8203;merge", "Do&ZeroWidthSpace;not&ZeroWidthSpace;merge", "Do&ThinSpace;not&ThinSpace;merge"]) {
    const renderedWarning = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\n\n" + warning + "\n</details>" };
    assert.equal(runGate({ comments: [marker, oldFinding, renderedWarning, clean, positive], reviews: [native] }).status, 1, "rendered warning cannot clear findings");
  }
  for (const indent of [" ", "  ", "   "]) {
    const duplicateIndentedRow = { ...historicalResolution, body: historicalResolution.body + "\n" + indent + "| 🛡️ **Security Review** | ✅ **Completed** <relative-time datetime=\"" + time(2) + "\">" + time(2) + "</relative-time> | `bbbbbbb` | Manual request |" };
    assert.equal(runGate({ comments: [marker, oldFinding, duplicateIndentedRow, clean, positive], reviews: [native] }).status, 1, "accepted row indentation cannot hide duplicate section");
  }
  const commentedNegativeRow = { ...oldFinding, body: oldFinding.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<!--\n$1\n-->"), updated_at: time(6) };
  assert.equal(runGate({ comments: [marker, commentedNegativeRow, fullyClean, positive], reviews: [native] }).status, 1, "HTML-comment row cannot backdate a negative edit");
  const unterminatedCommentClear = { ...historicalResolution, body: historicalResolution.body.replace("| 🛡️ **Security Review** |", "<!--\n| 🛡️ **Security Review** |") };
  assert.equal(runGate({ comments: [marker, oldFinding, unterminatedCommentClear, clean, positive], reviews: [native] }).status, 1, "unterminated HTML comment cannot supply section completion");
  const splitRowClear = { ...historicalResolution, body: historicalResolution.body.replaceAll("✅ **Completed** <relative-time", "✅ **Completed** <!--\nmetadata\n--> <relative-time") };
  assert.equal(runGate({ comments: [marker, oldFinding, splitRowClear, clean, positive], reviews: [native] }).status, 1, "comment removal cannot join split rows into completion proof");
  const collapsedRowClear = { ...historicalResolution, body: historicalResolution.body.replace(/(\| 🛡️ \*\*Security Review\*\*[^\n]*)/, "<details><summary>ℹ️ About Codex in GitHub</summary>\n$1\n</details>") };
  assert.equal(runGate({ comments: [marker, oldFinding, collapsedRowClear, clean, positive], reviews: [native] }).status, 1, "collapsed help details cannot supply section completion");
  const securityRow = historicalResolution.body.match(/^\| 🛡️[^\n]*$/m)[0];
  const nestedHiddenClear = { ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<details><summary>outer</summary><details><summary>inner</summary></details>\n" + securityRow + "\n</details>") };
  const commentedFenceClear = { ...historicalResolution, body: historicalResolution.body + "\n<!--\n```\n-->\n" + securityRow };
  const visibleSummaryClear = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>\n" + securityRow.replace(/`[a-f0-9]+`/, "`bbbbbbb`") + "\n</summary></details>" };
  const renderedDuplicateClear = { ...historicalResolution, body: historicalResolution.body + "\n" + securityRow.replace("Security Review", "Security&#32;Review").replace(/`[a-f0-9]+`/, "`bbbbbbb`") };
  const duplicateAfterAbout = { ...historicalResolution, body: historicalResolution.body + "\n<details><summary>ℹ️ About Codex in GitHub</summary>\ninformation\n</details>\n" + securityRow };
  const unmatchedCloserClear = { ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<details>\n</pre>\n" + securityRow + "\n</details>") };
  const rawBlockClears = ["pre", "code", "div", "script", "style", "textarea", "table", "section", "article", "blockquote", "kbd"].map(tag => ({ ...historicalResolution, body: historicalResolution.body.replace(securityRow, "<" + tag + ">\n" + securityRow + "\n</" + tag + ">") }));
  for (const tag of ["pre", "code", "div", "script", "style", "textarea", "table", "section", "article", "blockquote", "kbd"]) {
    const rawBlockNegative = { ...oldFinding, body: oldFinding.body.replace(/^(\| 🛡️[^\n]*)/m, "<" + tag + ">\n$1\n</" + tag + ">"), updated_at: time(6) };
    assert.equal(runGate({ comments: [marker, rawBlockNegative, fullyClean, positive], reviews: [native] }).status, 1, "raw-block negative retains updated observation clock");
  }
  for (const invalidClear of [nestedHiddenClear, commentedFenceClear, visibleSummaryClear, renderedDuplicateClear, duplicateAfterAbout, unmatchedCloserClear, ...rawBlockClears]) assert.equal(runGate({ comments: [marker, oldFinding, invalidClear, clean, positive], reviews: [native] }).status, 1, "hidden containers cannot synthesize unique completion proof");
  const bomMarkerClear = { ...historicalResolution, body: historicalResolution.body.replace(/^<!-- codex-pull-request-review-summary/, "    \uFEFF<!-- codex-pull-request-review-summary") };
  assert.equal(runGate({ comments: [marker, oldFinding, bomMarkerClear, clean, positive], reviews: [native] }).status, 1, "BOM between indentation and marker cannot create authority");
  assert.equal(runGate({ comments: [marker, oldFinding, { ...bomMarkerClear, body: bomMarkerClear.body.replace("\uFEFF", "\u00A0") }, clean, positive], reviews: [native] }).status, 1, "NBSP between indentation and marker cannot create authority");
  const codeNegative = { ...negative, body: render({ ...state, code_review: { ...state.code_review, has_any_findings: true, has_unresolved_findings: true } }) };
  assert.equal(runGate({ comments: [marker, codeNegative, positive], reviews: [native] }).status, 1);
  assert.equal(runGate({ comments: [marker, codeNegative, clean] }).status, 0);
});
