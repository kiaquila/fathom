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

Valid exact-head structured findings survive a repeated request until a newer clean machine snapshot completes the affected review section. A security finding requires its own newer canonical Security Review completion timestamp; all-null security state and code-only approval cannot clear it. Same-second completions remain pending. Malformed, duplicate or foreign-head history cannot create this durable fence; the latest invalid signal still blocks.

Completed typed findings are dated by their affected section’s valid canonical completion row; an edit to another section does not renew them. Missing or invalid completion rows retain the server observation time.

Historical section resolution uses independent canonical clean proof for that same head and section, regardless of later requests or the other section’s progress. It does not itself approve the current request. Visible conflicting findings cannot provide resolution proof.

Protocol marker openers indented by four spaces or a tab are Markdown examples and grant no typed authority, including approval and historical resolution. Foreign-head finding companions still require a coherent canonical row before an edited observation can be retired.

Malformed protocol discovery is case-insensitive and remains pending. Indentation examples are excluded only in leading-envelope context; a later indented snippet cannot erase real findings. Section projection validates known companion-row rendering before removing it.

Historical resolution validates each visible companion against its typed SHA, status, and canonical clock; canonical running progress remains compatible. All-null companions cannot hide any rendered section label. Accepted leading whitespace is normalized consistently for conflict scanning.

BOM-prefixed indented envelopes remain examples. Later fenced marker examples cannot erase a genuine leading finding. Indented nonprotocol HTML cannot be normalized into historical clearance.

Explicit negative facts in a canonical leading summary marker, closed typed state and summary heading survive trailing presentation, including protocol examples. This negative-only extraction never grants approval or section clearance; those require strict full-body validation. Duplicate markers within the leading envelope remain invalid.

Visible negative edits retain server observation time; fenced example rows cannot supply completion clocks. Negative-only parsing still requires marker uniqueness within the leading envelope.

Protocol and completion-row extraction share the same stateful Markdown fence scanner; a closer with the same character and at least the opener length ends the example.

A summary heading indented as Markdown code cannot establish typed authority. A later strict same-section completion can still clear an earlier visible finding.

Visible contradiction checks decode numeric character references and inline Markdown before checking P0–P2 and the known “Do not merge” warning. Canonical row scans exclude HTML comments and use the same accepted zero-to-three-space indentation when detecting duplicate sections. Raw protocol, JSON, SHA and timestamp validation remain unchanged.

HTML-comment row exclusion consumes an unterminated comment through EOF and preserves line boundaries. A BOM does not hide code indentation before the summary heading; rendered whitespace references cannot hide the known Do not merge warning.

Existing warning checks use rendered HTML text and Markdown link labels, ignoring Unicode default-ignorable characters, including variation selectors. Collapsed informational details cannot supply canonical completion rows.

BOM placement cannot erase raw code indentation before protocol markers; zero-width formatting cannot hide the known Do not merge warning.

Visible warning projection preserves quoted HTML attributes, image alternative text, balanced and reference link labels, and literal malformed links. Completion-row visibility removes comments before Markdown fences and tracks nested details through the outer closing tag.

Presentation warning checks remove raw comments before links, tokenize quoted HTML before decoding entities, and resolve defined full, collapsed, shortcut references and optional inline-link titles. Undefined or malformed links stay literal. Visible details-summary section text can invalidate completion evidence, but never supplies canonical authority.

Canonical completion rows cannot come from raw HTML block containers; container closing names must match. Escaped Markdown link openers remain literal across inline and defined-reference warning projection.

Warning projection preserves literal code spans, fenced blocks and raw code content; link syntax inside literal code cannot hide its visible warning text.
