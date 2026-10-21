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
  const codeNegative = { ...negative, body: render({ ...state, code_review: { ...state.code_review, has_any_findings: true, has_unresolved_findings: true } }) };
  assert.equal(runGate({ comments: [marker, codeNegative, positive], reviews: [native] }).status, 1);
  assert.equal(runGate({ comments: [marker, codeNegative, clean] }).status, 0);
});
