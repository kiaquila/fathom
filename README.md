# Fathom

`fathom` is a public development repository for a new experimental web-art
piece by **ks·design**. The repository is ready for concept work, but the
artwork itself is intentionally not defined yet.

## Current status

- Client decision (Kristina, 2026-09-03): create a public repository named
  `fathom` for a new art project in the same broad technical class as Ember.
- The development harness and static-site architecture are prepared.
- No final visual concept, motion language, sound, copy, canonical domain, or
  deployment has been approved.
- No Ember artwork, copy, imagery, sound, or generated assets are included.

## Provenance

The repository harness is adapted from the lightweight `template/` in
`kiaquila/web-design` at commit
`ed75ce91e5b2d915b9093cb6beef2b41015cc370`. The dependency-free single-page
layout, strict build boundary, local preview, tests, and Cloudflare Worker
shape follow the structural pattern used by Ember at that same revision.

Only infrastructure patterns were carried over. Fathom owns its implementation
and will evolve independently.

## Structure

```text
website/
├── src/index.html       # self-contained page shell
├── scripts/             # build and local preview
├── tests/               # shipped-output and policy tests
├── worker/index.ts      # security headers for static assets
└── wrangler.json       # deployable Worker configuration
```

Root-level scripts provide repository policy, project-check orchestration,
performance budgets, and dependency scanning. Codex reviews are requested on
the current pull-request head and evaluated before merge; they are not exposed
as a required status check because GitHub does not provide the native Codex
review as an app-bound check run in this repository.

## Commands

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix website
npm run preflight
npm --prefix website run dev
```

`npm run preflight` runs the repository guard, harness regression tests, the
website build/tests, and payload budgets. The local preview uses port `4660` by
default; set `PORT` to override it.

## Deployment

`website/wrangler.json` prepares a Worker named `fathom`, with static assets
served through the Worker so security headers apply consistently. Nothing in
this repository deploys automatically, and no Worker, domain, or production
environment is created by the bootstrap pull request.

## Open questions

- visual and interaction concept;
- whether the work uses sound and, if so, its user-gesture and mute contract;
- final identity, copy, favicon, and social card;
- canonical domain and deployment approval;
- final browser, viewport, and performance support targets.
