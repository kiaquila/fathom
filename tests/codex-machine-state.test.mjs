import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCodexCommentEvidence } from "../scripts/codex-review-helpers.mjs";
const headSha = "0123456789abcdef0123456789abcdef01234567";
const oldSha = "fedcba9876543210fedcba9876543210fedcba98";
const requestMarker = { sourceCommentCreatedAt: "2026-10-01T10:00:00Z", sourceCommentId: "1" };
const state = (overrides = {}) => ({ code_review: { commit_sha: headSha, status: "completed", has_any_findings: false, has_unresolved_findings: false, ...overrides }, security_review: { commit_sha: null, status: null, has_any_findings: null, has_unresolved_findings: null } });
const comment = (body, time = "2026-10-01T10:02:00Z", extra = {}) => ({ body, user: { login: "chatgpt-codex-connector[bot]" }, created_at: time, updated_at: time, ...extra });
const receipt = `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``;
const summary = (value = state()) => `<!-- codex-pull-request-review-summary -->
<!-- codex-review-state:v1 ${JSON.stringify(value)} -->

## Codex Review Summary

This comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-01T10:02:00Z">2026-10-01T10:02:00Z</relative-time> | \`${headSha.slice(0, 7)}\` | Manual request |${value.security_review.status !== null ? `\n| 🛡️ **Security Review** | ✅ **Completed** | \`${headSha.slice(0, 7)}\` | Manual request |` : ""}`;


const evaluate = (comments) => evaluateCodexCommentEvidence(comments, headSha, requestMarker);
test("independent complete machine proof accepts opaque closings only when newer", () => {
  for (const closing of ["Swish!", "You're on a roll.", "Another round soon, please!", "Chef's kiss.", "A sparkling little triumph!", "No worries!"]) {
    const opaque = receipt.replace("Swish!", closing);
    if (["Swish!", "A sparkling little triumph!", "No worries!"].includes(closing))
      assert.equal(evaluate([comment(opaque)]), "pending");
    for (const time of ["2026-10-01T10:01:00Z", "2026-10-01T10:03:00Z"])
      assert.equal(evaluate([comment(opaque, time), comment(summary())]),
        time < "2026-10-01T10:02:00Z" || ["You're on a roll.", "Another round soon, please!", "Chef's kiss."].includes(closing) ? "pass" : "pending", closing);
  }
});
test("machine proof is strict, fresh, exact-head and cannot erase newer bad state", () => {
  for (const body of [summary(state({ commit_sha: oldSha })), summary(state({ status: "running" })),
    summary(state({ has_any_findings: true })), summary(state({ has_any_findings: null })),
    summary().replace('"status":"completed"', '"status":"completed","status":"completed"'),
    summary().replace('"completed"', 'false'), summary().replace(':v1', ':v2'),
    summary() + "\n<!-- unknown -->", summary() + "\nP1: issue",
    summary({ ...state(), security_review: { ...state().code_review, status: "running" } }),
    summary({ ...state(), security_review: { ...state().code_review, has_any_findings: true } })]) {
    assert.notEqual(evaluate([comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:01:00Z"), "2026-10-01T10:01:00Z"), comment(body), comment(receipt, "2026-10-01T10:03:00Z")]), "pass", body);
  }
  assert.notEqual(evaluate([comment(summary(), "2026-10-01T09:59:00Z"), comment(receipt)]), "pass");
  assert.notEqual(evaluate([comment(summary(), undefined, { user: { login: "spoof[bot]" } }), comment(receipt)]), "pass");
});
test("opaque receipt cannot smuggle known findings, metadata or malformed structure", () => {
  for (const suffix of ["P3 advisory; P0 issue.", "Found a P0 issue.", "Found a P1 issue.", "Found a P2 issue.", "Authentication leaks credentials.", "The deployment deletes all customer data.", "Review incomplete.", "<!-- unknown -->", "Status: completed", "\nExtra line", "Codex Review: Approved."]) {
    assert.notEqual(evaluate([comment(summary()), comment(receipt.replace("Swish!", suffix), "2026-10-01T10:03:00Z")]), "pass", suffix);
  }
});


test("equal-time malformed, wrong-head and pending snapshots invalidate clean proof", () => {
  for (const body of [summary(state({ commit_sha: oldSha })), summary().replace(':v1', ':v2'),
    summary().replace(':v1 {', ':v1 {bad'), summary(state({ status: "running" }))]) {
    for (const snapshots of [[comment(summary()), comment(body)], [comment(body), comment(summary())]])
      assert.notEqual(evaluate([...snapshots, comment(receipt)]), "pass", body);
  }
  for (const body of [receipt + "\n<!-- codex-review-receipt:v1 -->", receipt + "\n<!-- unknown -->",
    receipt + "\n**Reviewed commit:** `0123456789`", receipt + "\nP0: issue",
    receipt.replace("Swish!", "Swish!\nAnother line"), receipt.replace("0123456789", "fedcba9876")])
    assert.notEqual(evaluate([comment(summary()), comment(body, "2026-10-01T10:03:00Z")]), "pass", body);
});

test("unknown receipt at the same time as clean proof remains pending", () => {
  assert.equal(evaluate([comment(receipt), comment(summary())]), "pending");
});

test("unknown contrary prose never inherits earlier or equal-time clean proof", () => {
  for (const closing of ["Do not merge.", "A vulnerability remains.", "Needs work."]) {
    const body = receipt.replace("Swish!", closing);
    assert.notEqual(evaluate([comment(body), comment(summary())]), "pass", closing);
    assert.notEqual(evaluate([comment(summary()), comment(body, "2026-10-01T10:03:00Z")]), "pass", closing);
    assert.equal(evaluate([comment(body), comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:03:00Z"), "2026-10-01T10:03:00Z")]), "pass", closing);
  }
});

test("security-only summary updates cannot renew an old code result for a new request", () => {
  const repeated = { ...requestMarker, sourceCommentCreatedAt: "2026-10-01T10:03:00Z" };
  for (const body of [summary(), summary().replace(/ <relative-time[^>]+>[^<]+<\/relative-time>/, "")]) {
    const laterEdit = comment(body, "2026-10-01T10:01:00Z", { updated_at: "2026-10-01T10:04:00Z" });
    assert.notEqual(evaluateCodexCommentEvidence([laterEdit], headSha, repeated), "pass");
  }
  const fresh = summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:04:00Z");
  assert.equal(evaluateCodexCommentEvidence([comment(fresh, "2026-10-01T10:04:00Z")], headSha, repeated), "pass");
});
test("strict receipts keep same-second source-comment ID ordering", () => {
  const strict = receipt.replace("Swish!", ":rocket:");
  assert.equal(evaluate([comment(strict, requestMarker.sourceCommentCreatedAt, { id: "2" })]), "pass");
  assert.notEqual(evaluate([comment(strict, requestMarker.sourceCommentCreatedAt, { id: "1" })]), "pass");
});

test("security-only edits do not advance a code verdict over intervening unknown prose", () => {
  const edited = comment(summary(), "2026-10-01T10:02:00Z", { updated_at: "2026-10-01T10:04:00Z" });
  assert.equal(evaluate([edited, comment(receipt, "2026-10-01T10:03:00Z")]), "pending");
  assert.equal(evaluate([comment(summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:05:00Z")), comment(receipt)]), "pending", "future row time cannot approve");
});

test("fractional machine times cannot outrun same-second receipts or requests", () => {
  const fractional = summary().replaceAll("2026-10-01T10:02:00Z", "2026-10-01T10:02:00.500Z");
  assert.equal(evaluate([comment(fractional), comment(receipt)]), "pending");
  assert.equal(evaluateCodexCommentEvidence([comment(fractional)], headSha, { ...requestMarker, sourceCommentCreatedAt: "2026-10-01T10:02:00Z" }), "pending");
});
