# Fathom

`fathom` is a public development repository for a new experimental web-art
piece by **ks·design**. The repository is ready for concept work, but the
artwork itself is intentionally not defined yet.

## Current status

- Client decision (Kristina, 2026-09-03): create a public repository named
  `fathom` for a new art project in the same broad technical class as Ember.
- Client decision (Kristina, 2026-09-03): the artwork is the "Reference"
  scene from the fourth prototype round — a school of sequined goldfish with
  pointed snouts and veil fins, drifting right through painted water; the
  scene follows the visitor's local time of day; the page carries Ember's lab
  chrome (wordmark, footer credit) and the study number **03** at the top
  right.
- Implemented in `website/src/index.html`. The approved canonical domain is
  `fathom.ks-design.art`; Cloudflare deploys `main` to production and creates
  an isolated preview for non-production branches. Not yet approved: social
  card and PNG icons.

## The artwork

- **Fish.** Sixty-eight fantail goldfish in three depth planes (far fish are
  blurred and fogged, near fish sharp). Each fish is drawn procedurally at
  load: an egg-shaped body with a pointed snout, a darker cap and a rounded
  gill plate, an amber eye, a body of tiny sequins with a white blaze on the
  back, and translucent veil fins with fine rays and specks. Individual
  sequins glint at random; the tail runs as a travelling wave.
- **Water.** A brushed, vertically streaked ground, light shafts from above,
  drifting caustics and motes. At night the fish gain a warm glow.
- **Time of day.** The page reads the visitor's clock: day 07:00–16:30, dusk
  16:30–20:30 and 05:30–07:00, midnight otherwise. It re-checks every 20 s and
  cross-fades palette, ground and effects over six seconds when the mood
  changes. The bottom controls pin a mood (`auto` returns to the clock);
  `?mood=day|dusk|midnight` in the URL pins it for screenshots and reviews,
  and `?motion=reduce` forces the still frame for review.
- **Motion and access.** Under `prefers-reduced-motion: reduce` the scene
  renders a single still frame (the mood controls still work, re-rendering
  once). The canvas is decorative (`aria-hidden`); the hint line is a
  `role="status"` region that announces the current mood; the controls are
  native buttons with `aria-pressed`.
- **Budget.** One self-contained HTML file (about 48 KB raw); no fonts, images,
  scripts or requests beyond the page itself. The footer credit is the only
  outward link.

## Provenance

The repository harness is adapted from the lightweight `template/` in
`kiaquila/web-design` at commit
`ed75ce91e5b2d915b9093cb6beef2b41015cc370`. The dependency-free single-page
layout, strict build boundary, local preview, tests, and Cloudflare Worker
shape follow the structural pattern used by Ember at that same revision.

Only infrastructure patterns were carried over. Fathom owns its implementation
and will evolve independently.

The artwork engine grew through four local prototype rounds (65 variants in a
gallery that is not tracked here). Two paintings of sequined fish were used as
visual reference only, including the goldfish study by Zima Angela
(t.me/myangelart); no third-party imagery, fonts or code ship with the page.
The lab chrome (wordmark with the gold dot, study tag, footer credit) is
carried over from Ember by client decision.

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

The study is published by the Cloudflare Worker `fathom` at
[fathom.ks-design.art](https://fathom.ks-design.art) and
[fathom.ks-design.workers.dev](https://fathom.ks-design.workers.dev).
Cloudflare Workers Builds is connected directly to `kiaquila/fathom`: a merge
to `main` updates production, while non-production branches receive isolated
version preview URLs. No Cloudflare credential is stored in GitHub or in this
repository. The exact settings and verification contract are recorded in
[`docs/stage-hosting.md`](./docs/stage-hosting.md).

## Open questions

- social card and baked PNG icons (the page ships an inline SVG favicon only);
- whether the work ever gains sound (none planned);
- final browser, viewport, and performance support targets.
