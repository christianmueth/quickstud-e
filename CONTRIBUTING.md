# Contributing

QuickStud-E accepts product and research-adjacent changes, but adaptive behavior in the product stack is governed by a stricter doctrine than ordinary feature work.

## Adaptive Systems Doctrine

Adaptive systems in this repo are governed by:

- observable before authoritative
- replay inspectability
- bounded rollout escalation

See:

- `docs/REASONING_ENGINE_ARCHITECTURE.md`
- `docs/ADAPTIVE_CHANGE_REVIEW.md`
- `.github/pull_request_template.md`

## What This Means In Practice

If a change increases adaptive capability or adaptive authority, it should not move directly to live control.

It must remain:

- observable in telemetry
- inspectable in replay
- able to abstain
- bounded by explicit rollout controls
- reversible through configuration or feature flags

## Review Expectations

Before opening a PR for an adaptive change:

1. Confirm whether the change increases adaptive capability or authority.
2. Run through `docs/ADAPTIVE_CHANGE_REVIEW.md`.
3. Make sure rollout posture is explicit: shadow-only, bounded trial, or no authority increase.
4. Document replay, telemetry, and rollback implications in the PR.

If those conditions are not met, the change should remain shadow-only or offline-only.