# Rollout Decision - 2026-05-10

Report status: ok
Date: 2026-05-10
Policy version: unknown
Selected policy label: unknown
Deployment posture: shadow-only
Recommended posture: hold_shadow_mode

## Metrics
- Disagreement rate: 0
- Abstention rate: 0
- Override rate: 0
- Recovery rate: 0.434
- Stabilization rate: 0.19
- Average confidence delta: 0.063

## Recovery Observations
- Fill in the main recovery patterns observed from `recovery_patterns.json` and the student-facing recovery timeline.

## Replay Observations
- Fill in the main disagreement clusters and representative replay examples from `disagreement_clusters.json` and the replay console.

## Drift Concerns
- Shadow sample is small (0 examples); disagreement geometry may still be unstable.
- Abstention share is low at 0; calibration drift may be present.
- Candidate-score margin is compressed (mean 0); real candidate separability may be weak.

## Decision
- [ ] Hold shadow mode
- [ ] Continue shadow collection
- [ ] Tighten heuristics or thresholds
- [ ] Investigate drift before any rollout change
- [ ] Prepare bounded trial review package

## Rollback Concerns
- Document any reasons the system should remain fully heuristic-authoritative.

## Owner
- Fill in reviewer and sign-off owner.
