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
