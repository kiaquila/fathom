# Stage hosting

Fathom is served from one Cloudflare Worker named `fathom`, built by Cloudflare
Workers Builds from the connected GitHub repository `kiaquila/fathom`. The
repository is the source of truth for the Worker name and runtime configuration
in [`website/wrangler.json`](../website/wrangler.json); Cloudflare owns the Git
connection and build credential, so no Cloudflare token is stored in GitHub or
committed here.

| Event | Command after `npm run build` | Result |
| --- | --- | --- |
| Push or merge to `main` | `npm run stage:deploy` | Updates production |
| Push to any other branch | `npm run stage:preview` | Uploads an isolated version and reports its URL on the pull request |

The stable URLs are `https://fathom.ks-design.workers.dev` and the canonical
custom domain `https://fathom.ks-design.art`. Pull-request previews use a
Cloudflare-assigned version prefix shaped like
`https://<version>-fathom.ks-design.workers.dev`; the prefix must not be
hard-coded.

## Cloudflare build settings

| Setting | Value |
| --- | --- |
| Worker name | `fathom` |
| Repository | `kiaquila/fathom` |
| Production branch | `main` |
| Root directory | `website` |
| Build command | `npm run build` |
| Production deploy command | `npm run stage:deploy` |
| Non-production deploy command | `npm run stage:preview` |
| Builds for non-production branches | enabled |

The `Cloudflare Workers and Pages` GitHub App must retain explicit access to
`kiaquila/fathom`. Public read access is enough for a manual clone, but not for
the push webhooks that start production and preview builds.

`workers_dev: true` keeps the stable workers.dev route available and
`preview_urls: true` enables versioned previews. `run_worker_first: true`
ensures the security headers in `website/worker/index.ts` are attached to every
response. Unknown paths use the single-page fallback because the artwork is one
self-contained page.

The custom domain is bound to the Worker in Cloudflare, not to GitHub. The page
names it in an exact canonical tag, and the build rejects every other outward
reference except the footer credit to `https://ks-design.art`.

## Verification

- Both stable URLs return Fathom, and an unknown path returns the same page.
- Pull requests receive a versioned preview URL and do not update production.
- The Worker response includes the security headers from
  `website/worker/index.ts`, including `connect-src 'none'`.
- The console is clean and no runtime request leaves the origin.
- The smallest and largest supported layouts, keyboard focus, all four mood
  controls, and reduced motion work end to end.

## Rollback

In Cloudflare, roll the Worker back to the last known-good version. The custom
domain follows the active Worker version, so rollback requires no DNS change.
