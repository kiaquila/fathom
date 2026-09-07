# Fathom

`fathom` is a public repository for an experimental web-art piece by
**ks·design**: a school of sequined goldfish drifting through painted water
that follows the visitor's local time of day.

## Current status

- Client decision (Kristina, 2026-09-03): create a public repository named
  `fathom` for a new art project in the same broad technical class as Ember.
- Client decision (Kristina, 2026-09-03): the artwork is the "Reference"
  scene from the fourth prototype round — a school of sequined goldfish with
  pointed snouts and veil fins, drifting right through painted water; the
  scene follows the visitor's local time of day; the page carries Ember's lab
  chrome (wordmark, footer credit) and the study number **03** at the top
  right.
- Client decision (Kristina, 2026-09-04): the fish are painted pictures, not
  code. Three cut-out goldfish supplied by Kristina replace the procedurally
  drawn ones; the engine, motion and time-of-day contract stay as approved.
- Client decision (Kristina, 2026-09-05): the favicon is one goldfish from
  the study on a rounded midnight tile — head to the right, veil fins, a warm
  glow — drawn as vector paths and shipped inline; it replaces the plain gold
  disc.
- Client decision (Kristina, 2026-09-07, approved on the stage preview from
  her iPhone and desktop): the water's brush marks are soft washes instead
  of hard-edged bars; on small screens the school's pace is lifted up to
  1.6× (halfway between the original crawl and a first cut at 2.2× that read
  as too quick on the phone); on iPhones the water runs on under Safari's
  bottom bar while the status bar is tinted to the water. See "The artwork"
  below.
- Implemented in `website/src/index.html` with the three fish files beside it.
  The approved canonical domain is
  `fathom.ks-design.art`; Cloudflare deploys `main` to production and creates
  an isolated preview for non-production branches. Not yet approved: social
  card and PNG icons.

## The artwork

- **Fish.** Fifty-six goldfish in three depth planes (far fish are blurred
  and fogged, near fish sharp), drawn from three painted pictures
  (`fish-01.webp` … `fish-03.webp`): sequined veiltail goldfish, side view,
  facing right, cut out on a transparent ground. At load the engine scales
  each picture per depth plane, grades it for the mood, and samples its
  brightest sequins as glint sites; the tail still runs as a travelling wave
  because the sprite is drawn in vertical strips (assembled on whole pixels
  on a scratch canvas, so the translucent fins show no seams). `?fish=drawn` keeps the
  earlier procedural school for side-by-side review, and it also stands in
  automatically if the pictures fail to load or do not arrive within eight
  seconds (whatever has loaded by then is used).
- **Water.** A brushed, vertically streaked ground, light shafts from above,
  drifting caustics and motes. At night the fish gain a warm glow. The brush
  marks are soft washes: tapered marks painted on two coarse sheets (quarter
  and half scale) and laid onto the ground blurred, so they read as paint;
  drawn as hard-edged bars they overlapped into fine stripes and blocks that
  looked like interference (fixed 2026-09-06). Two more hairline sources
  are closed the same week: every fish is warped on one shared scratch
  canvas, and a bilinear blit reads one texel past its source rectangle, so
  a smaller fish carried a bright hairline of the previous, larger sprite
  (its glow, at midnight) along its right and bottom edges — the margin is
  now cleared too; and the caustic tiles are built at device resolution and
  scrolled by whole device pixels, so their repeat edge is never resampled.
- **Time of day.** The page reads the visitor's clock: day 07:00–16:30, dusk
  16:30–20:30 and 05:30–07:00, midnight otherwise. It re-checks every 20 s and
  cross-fades palette, ground and effects over six seconds when the mood
  changes. The bottom controls pin a mood (`auto` returns to the clock);
  `?mood=day|dusk|midnight` in the URL pins it for screenshots and reviews,
  and `?motion=reduce` forces the still frame for review.
- **Pace and screen.** Fish sizes and speeds follow the short side of the
  canvas, so a phone would show a school a quarter the size drifting at a
  quarter of the pixels per second; a pace factor lifts small screens back
  part of the way back towards the desktop feel: 1 at a 1000 px short side,
  about 1.12 on a 746 px laptop window, about 1.45 on a 390 px phone, 1.6 at
  most. Fixed-viewport
  browsers on phones leave strips of flat colour above and below the page;
  the page opts into the full screen (`viewport-fit=cover`) with the
  wordmark, controls and credit kept inside the safe area. On iPhones in
  portrait the canvas is laid out as document content, 120 px taller than
  the large viewport, so the document runs on through the zone of Safari's
  bottom bar and the water shows in the bar's glass (Safari clips the page
  at the document's bottom inside that zone, so a taller *fixed* canvas was
  cut at the bar's edge and the bar showed Safari's own flat fill). Safari
  never lets a page paint its status bar, so that strip is tinted instead:
  `theme-color` (iOS 15–18) and a fixed 8 px strip at the page's top edge
  (iOS 26 samples the fixed element it finds there and ignores
  `theme-color`) follow the mean colour of the water's top edge through
  every mood and fade. A resize event that changes nothing (iPhone Safari
  sends them on tab switches and bar toggles) leaves the scene alone.
- **Motion and access.** Under `prefers-reduced-motion: reduce` the scene
  renders a single still frame (the mood controls still work, re-rendering
  once). The canvas is decorative (`aria-hidden`); the mood carries no visible
  caption (client decision, 2026-09-04) but is still announced through a
  visually hidden `role="status"` region; the controls are native buttons in a
  labelled group, each carrying `aria-pressed`.
- **Budget.** One HTML file (about 65 KB raw) plus three WebP fish
  (about 110–160 KB each, alpha included; about 400 KB in total); no fonts,
  scripts or requests beyond these same-origin files. The footer credit is
  the only outward link.

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

The three fish pictures were generated by Kristina in ChatGPT (image model,
2026-09-04) from a text brief describing a sequined veiltail goldfish, and
supplied to the project as her own assets. Two of the three arrived with a
fake checkerboard "transparency" baked in; their backgrounds were removed
locally with Apple's Vision subject lifting, the third carried a real alpha
channel. All three were then trimmed, given veil-like translucency on the
fins (alpha reduced on pale, unsaturated pixels outside the body), resized to
1400 px and encoded as WebP with alpha.

The favicon (2026-09-05) was redrawn by hand as SVG paths from an icon
Kristina generated in ChatGPT as a reference; the tile uses the midnight
water gradient (`#1c2c3c` → `#141f2b`), the fish the study's gold and fin
tones. No raster or third-party asset ships with it: it is a base64 data URI
in the page head, about 4.4 KB.

The lab chrome (wordmark, study tag, footer credit) is carried over from Ember
as it ships on ember.ks-design.art by client decision (2026-09-03, confirmed
2026-09-04): the letters in the system face at 11px, weight 600 and 0.22em
tracking, the dot 0.42em on the baseline in the 1:2 proportion. The dot's
colour is the ks·design token pair — `#818cf8` into `#22d3ee` along the 135°
diagonal (client decision, 2026-08-28, which replaced the earlier brand-gold
amber); it is drawn as an inline SVG circle rather than Ember's CSS rounded
box, with the same corner-to-corner gradient.

## Structure

```text
website/
├── src/index.html       # the page: inline CSS, JavaScript, engine
├── src/fish-0?.webp     # the three painted fish (cut out, alpha)
├── scripts/             # build and local preview
├── tests/               # shipped-output and policy tests
├── worker/index.ts      # security headers for static assets
└── wrangler.json       # deployable Worker configuration
```

Root-level scripts provide repository policy, project-check orchestration,
performance budgets, and dependency scanning. Every pull request also goes
through the required `Codex Review` gate: the check stays red until Codex has
reviewed the current head. Request a review by commenting
`@codex review <current-full-head-sha>` on the pull request; trusted
default-branch orchestration binds the request and result to that exact
40-character head SHA.

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
