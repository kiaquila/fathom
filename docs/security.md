# Security

- Keep secrets and production data outside Git in the deployment platform's
  secret store or an ignored local file.
- Give workflows top-level least-privilege permissions and pin external actions
  to full commit SHAs.
- Do not use `pull_request_target` for candidate code.
- Do not deploy, publish, change DNS, or mutate external systems from ordinary
  pull-request validation.
- Review new network dependencies, embeds, analytics, and trackers for purpose,
  license, privacy, and failure behavior.
- Keep Dependabot alerts and security updates enabled in the repository
  settings; `.github/dependabot.yml` only schedules routine version updates.
- Let a new dependency version cool down before adopting it, group only minor
  and patch updates, and review every major update on its own.
