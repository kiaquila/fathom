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
Receipt endings allow the neutral encouragement observed in this repository or
emoji; unknown prose fails closed rather than hiding a contradictory verdict.
Formal reviews retain their current-head and P0–P2 policy. A new request cannot
clear a blocking review, and unresolved Codex review threads block regardless of
severity or the commit on which they were created.

The rerun workflow and runtime router both accept receipt and
`codex-pull-request-review-summary` updates on `created` and `edited` events.
The mutable activity summary is only a wakeup signal: its JSON, timestamps,
`Completed` label, and reactions never satisfy the gate. An updated summary may
have been created before the latest request; routing does not filter on its
creation time. Passing still requires a qualifying receipt or formal review.

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
