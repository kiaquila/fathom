# Testing and performance

`projectChecks` must run the real implementation: lint or type checks when the
stack uses them, production build, and product tests. Commands are arrays so the
harness executes the named program directly without interpreting shell text.

The payload check measures the deployable output after the build. It rejects
unexpected file types and enforces total, per-extension, and critical
first-render budgets in raw and gzip bytes. Every critical file is compressed on
its own and the results are summed, because the browser fetches each one as a
separate gzip-encoded response. The defaults preserve the proven Alex Neon
ceilings of 48 KiB raw / 20 KiB gzip for JavaScript and 45 KiB gzip for critical
text. Adjust a limit only from measured output and explain the tradeoff in the
PR.

Automated checks complement visual QA. Record the smallest and largest
viewports, keyboard navigation and focus, reduced motion, console/network
errors, and the critical conversion or interaction path.

## Native Codex review events

The required `Codex Review` gate runs policy from the default branch. A trusted
human must post `@codex review <current-full-head-sha>`; only the exact
`chatgpt-codex-connector[bot]` identity supplies native review evidence. Legacy
no-findings comments and the `codex-review-receipt:v1` envelope require an explicit
positive verdict, a matching reviewed commit, and creation after that request.
Legacy receipt endings remain strict. Unseen presentation endings alone cannot
approve a review. A trusted current-request structured snapshot can
supply an independent verdict only with an exact full head SHA, completed code
review, explicit false findings flags, and inactive or equally clean security
review. Malformed, pending, stale, or negative snapshots block older positives;
an unknown receipt remains pending until a strictly newer affirmative snapshot.
Formal reviews retain their current-head and P0–P2 policy. A new request cannot
clear a blocking review, and unresolved Codex review threads block regardless of
severity or the commit on which they were created.

The rerun workflow and runtime router both accept receipt and
`codex-pull-request-review-summary` updates on `created` and `edited` events.
A complete strictly validated machine snapshot is also review evidence; a heading,
`Completed` label, or reaction alone never approves. Snapshot update time must
follow the latest trusted request; legacy receipts retain creation-time eligibility.

Request and evidence jobs share a per-PR queue with `queue: max`, preserving
pending jobs rather than replacing them. Both dispatch `codex-review.yml` on the
live repository default branch; no preceding PR workflow run is required. The
publishing workflow accepts only default-branch dispatches, checks out that
workflow's policy commit with no persisted Git credentials, and never checks
out or executes proposed PR code. Native review still requires the trusted
human request and actual qualifying evidence; dispatch itself is not approval.

An active matching dispatch finishes before another is queued; a successful
run started after the evidence update needs no duplicate dispatch. A dispatch
run's `head_sha` identifies its policy commit, so selection checks the default
branch plus the exact `Codex Review #<pr> @ <head-sha>` run name instead. The
helper rechecks that the PR is open and its head is unchanged after waiting,
and the gate rechecks the head after collecting evidence. A new dispatch uses
the current default-branch workflow rather than rerunning a historical workflow
definition. Workflow completion events do not trigger this path, so it cannot
recursively dispatch itself.

For the first deployment of routing or dispatch changes, the old default-branch
router may not recognize new events or find the removed PR workflow run. After
the user-account request and actual native receipt or formal review arrive,
dispatch the existing
`codex-review.yml` **on the default branch**, with `pr_number` and the exact
`head_sha`. This uses the already trusted gate and publishes its actual result;
it does not execute proposed policy with write permissions. Never use a PR-ref
dispatch, fabricated check, protection change, or admin bypass to bootstrap it.

Branch protection binds the required check to the GitHub Actions app, not a
particular workflow file. This separation protects the normal review publisher
from executing proposed code; it does not make the check name unforgeable by a
different workflow with permission to publish checks. Workflow changes remain
security-sensitive and require review.

Run `node --test tests/codex-review-*.test.mjs` for receipt, event-filter,
requeue, live-head race, and invoked-gate regression coverage, then run the full
`npm run preflight`.


Structured approval also requires the visible code-review completion timestamp
to be strictly newer than the trusted request. A security-only edit of the shared
summary cannot renew an old code verdict; a missing completion time stays pending.

Positive machine evidence is ordered by code completion time in whole-second
buckets, matching GitHub comment precision. Same-second request or pending
evidence remains blocking; security-only edits cannot advance that order.

Static clean receipts retain their publication time; unknown and negative receipt edits use their server update time and block older or equal-time machine completion.

## Structured history and native presentation

Trusted closed-schema current-head findings survive repeated requests. Each section requires its own strictly newer canonical clean completion to clear its history. Inactive security state, a code-only receipt, reactions, or a formal approval cannot clear security findings. Invalid own clocks fall back to observation time; own completion cannot predate comment creation or exceed the observed update bucket. Valid carried companion clocks retain their existing independent section semantics.

Completion-clock authority requires the entire native presentation: the exact summary envelope, heading and introduction, the contiguous native table, exactly the expected active rows with matching typed status/SHA/clock, and only the optional exact known Codex help footer. Blank lines inside the table, duplicate or hidden rows, extra protocol, unknown HTML, code examples and arbitrary prose do not provide clocks or clearing authority. Explicit typed negatives survive such unknown presentation at observation time. A fresh canonical same-section completion can recover; English wording and Markdown rendering are never used to decide that an unknown suffix is harmless enough to backdate a finding.

Static no-findings receipts require the exact verdict, one matching reviewed-commit binding and a closed catalog of observed native closings. One exact trailing service-owned View task link and the exact known help footer are supported. Uncatalogued or contradictory suffixes remain pending. The fixture corpus records 19 observed replies and their public provenance.

A completed code lifecycle with both finding flags null is not approval. With security inactive, it may accompany an independent trusted strict current-request receipt only when that receipt is unedited and its original creation falls between lifecycle creation and its validated own completion. The three observed native lifecycle pairs and negative mutations are regression fixtures. Active security, mixed flags, stale/edited/out-of-window receipts, unknown presentation, deletions, withdrawal markers and unresolved threads retain their independent blocking semantics.

Clean structured approval requires every active completed section clock to fit the server observation's whole-second bucket. A fractional observation never lends authority to the next second. A carried companion completion may predate this comment's creation; the current code verdict retains its own request and creation bounds.

Completed code lifecycle snapshots with unknown finding flags retain their server observation fence until an immutable in-window receipt corroborates them or a canonical clean **Code Review** completion is strictly newer. A later Security Review row carrying an older code clock cannot clear that fence; each section must clear independently. Completion upper bounds use the server observation’s whole-second bucket for approval, findings, retirement and history.
