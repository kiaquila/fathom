# Fathom

`fathom` is the public repository for an experimental web-art piece by
**ks·design**: a school of sequined goldfish drifting through painted water
that follows the visitor's local time of day.

View the live work at [fathom.ks-design.art](https://fathom.ks-design.art).

## Implementation

- The artwork is one dependency-free page in `website/src/index.html`, with
  inline CSS and JavaScript and system fonts.
- The only runtime fetches are the three same-origin fish pictures; the page
  remains functional if they fail to load.
- The build publishes only explicitly allowlisted files, and the Cloudflare
  Worker serves those static assets with security headers.
- User-facing motion honors `prefers-reduced-motion`, and the controls use
  native accessible elements.

## Structure

```text
website/
├── src/index.html       # the page: inline CSS, JavaScript, engine
├── src/fish-0?.webp     # the three painted fish
├── scripts/             # build and local preview
├── tests/               # shipped-output and policy tests
├── worker/index.ts      # security headers for static assets
└── wrangler.json        # deployable Worker configuration
```
