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
pending jobs rather than replacing them. An active gate finishes before requeue;
a successful run started after the evidence update needs no
duplicate rerun. The rerun helper rechecks the live PR head after waiting, and
the gate rechecks it after collecting evidence. Workflow completion events do
not trigger this path, so a rerun cannot recursively requeue itself.

For the first deployment of an event-routing fix, the old default-branch router
cannot recognize new prefixes. After the user-account request and actual native
receipt or formal review arrive, rerun the existing PR gate or dispatch
`codex-review.yml` **on the default branch**, with `pr_number` and the exact
`head_sha`. This uses the already trusted gate and publishes its actual result;
it does not execute proposed policy with write permissions. Never use a PR-ref
dispatch, fabricated check, protection change, or admin bypass to bootstrap it.

Run `node --test tests/codex-review-*.test.mjs` for receipt, event-filter,
requeue, live-head race, and invoked-gate regression coverage, then run the full
`npm run preflight`.
