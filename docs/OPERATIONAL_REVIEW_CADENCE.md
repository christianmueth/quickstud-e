# Operational Review Cadence

This runbook defines the recurring operational review loop for adaptive tutoring after the public product loop is live.

Use it to keep shadow telemetry, replay review, recovery monitoring, and bounded authority discipline aligned over time.

## Purpose

QuickStud-E is now beyond the stage where product work alone is sufficient.

The next risk is operational drift:

- disagreement geometry changing under real traffic
- recovery patterns degrading while surface UX still looks healthy
- concentrated misconception pathologies hiding inside aggregate metrics
- pressure to widen authority before the evidence base is mature

This review cadence exists to keep adaptive behavior governed after launch, not just before launch.

## Core Rule

Do not widen adaptive authority unless the live operational loop remains:

- replay-visible
- shadow-backed
- educationally coherent
- bounded
- reversible

Offline lift is still not enough.

The standing constitutional asymmetry is:

```text
capability may improve
authority must still be earned
```

That rule takes precedence over offline metrics, planner sophistication, product pressure, or convenience.

## Standing Operating Procedure

Treat the following as ongoing operating procedure, not temporary rollout advice.

### 1. Freeze The Authority Boundary

Maintain the current bounded rollout posture unless operational evidence explicitly justifies change:

- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`
- `TUTORING_ADAPTIVE_POLICY_VERSION=offline_selected_v1`
- `TUTORING_ADAPTIVE_BLEND_WEIGHT=0.55`
- `TUTORING_ADAPTIVE_ABSTAIN_THRESHOLD=0.015`

Do not widen override budgets, lower abstention aggressively, enable planner authority, or introduce online RL authority during this phase.

### 2. Treat Replay As The Operational Center

The replay console is now the primary governance surface.

Every review cycle should include:

- disagreement inspection
- abstention inspection
- replay coherence review
- recovery progression review
- localized pathology analysis
- override pressure review
- governance bundle summary review

Replay review must remain meaningful, not ceremonial.

### 3. Never Skip Cadence

The largest long-term risk is cadence erosion.

Run the full governance loop continuously, including:

- weekly governance bundles
- replay review
- recovery monitoring
- rollout review

Continuity matters more than perfect metrics.

### 4. Preserve Institutional Memory

Do not delete:

- governance bundles
- blocked reports
- replay digests
- rollout decisions
- recovery summaries
- operational warnings
- disagreement artifacts

These are institutional governance evidence, not temporary logs.

### 5. Keep Recovery Monitoring Central

Continue reviewing:

- confidence rebuilding
- misconception stabilization
- repeated recovery failures
- unstable topics
- tutoring effectiveness over time

Educational recovery remains a primary operational metric.

### 6. Preserve Abstention Discipline

Healthy abstention is evidence of:

- calibration
- bounded authority
- governance integrity

Sparse explainable corrections are preferable to dense autonomous intervention.

### 7. Resist Capability Pressure Explicitly

Standing rule:

```text
offline capability improvements do not justify authority expansion
```

Authority expansion requires sustained operational evidence, stable replay geometry, healthy recovery progression, and continuous governance cadence.

### 8. Keep LightZero And MuZero Usage Bounded

Continue using LightZero concepts only as:

- replay governance evidence
- trajectory review oversight
- bounded value comparison
- offline policy evaluation
- future-only, evidence-gated planning

Do not let planning sophistication replace replay-centered governance.

## Review Cadence

### Daily

Run the shadow export workflow when traffic is sparse or when a policy/config change has recently shipped.

Check:

- disagreement rate
- abstention rate
- override rate
- score-margin compression
- strategy concentration
- misconception concentration

If any of those spike unexpectedly, keep the system in shadow-only mode and escalate to replay review.

### Weekly

Run a structured replay and recovery review.

Check both operational and educational signals:

- representative disagreement clusters in replay
- top strategy shifts by misconception family
- recovery timeline patterns on real students
- whether confidence rebuilding still looks plausible and localized
- whether the same misconception families remain unstable across weeks
- whether recommendations are still landing in coherent study flows

The weekly review is the main decision point for whether the current posture is:

- hold shadow mode
- continue shadow collection
- tighten heuristics or thresholds
- investigate drift
- prepare evidence for a bounded trial

### Release-Adjacent

Perform an additional review whenever any of the following changes:

- serialized policy artifact version
- blend weight
- abstain threshold
- disagreement or override budget
- tutoring strategy generation logic
- candidate feature definitions
- persistence or replay schema

These reviews should happen even if the feature flags remain shadow-only.

## Recovery Pattern Monitoring

The student-facing dashboard now exposes recovery progress and a recovery timeline.

Treat that surface as an educational signal, not as decorative UX.

Monitor whether live recovery events suggest:

- confidence rebuilding in repeated concepts
- misconception stabilization over time
- fewer repeated recovery misses for the same topic family
- plausible progression from "needs reinforcement" to "recovering" to "stabilizing"

Escalate if the timeline starts showing:

- persistent repeated recovery misses in the same area
- flat or negative confidence transitions across many events
- unstable or confusing recommendation-to-study loops
- strategy patterns that look disconnected from educational outcomes

## Drift Inspection

Inspect drift from two angles:

### Operational drift

- disagreement distribution changes sharply
- abstention drops while disagreement rises
- score margins collapse
- one strategy family dominates too much traffic

### Educational drift

- recovery events stop improving over time
- misconception concentration narrows around one recurring failure mode
- recommendations send students into loops without visible stabilization
- dashboard progress looks optimistic while replay suggests instability

If either drift pattern appears, keep adaptive authority frozen and investigate before changing thresholds or policy versions.

## Minimum Weekly Evidence Set

Each weekly review should preserve:

- one retained shadow export snapshot
- one replay review summary covering representative disagreements
- one short recovery-pattern summary from live `study_recovery` events
- the active policy artifact version and thresholds
- the resulting operational decision

Recommended generator command:

```powershell
npm run reasoning:report:weekly -- --date YYYY-MM-DD
```

By default this creates:

```text
governance_reports/
	YYYY-MM-DD/
		shadow_dataset.jsonl
		shadow_summary.json
		recovery_dataset.jsonl
		recovery_summary.json
		governance_report.json
		disagreement_clusters.json
		recovery_patterns.json
		replay_digest.md
		rollout_decision.md
```

Recommended decision log format:

```text
Date:
Policy version:
Shadow posture:
Disagreement summary:
Recovery summary:
Drift concerns:
Decision:
Owner:
```

## Escalation Threshold

Do not consider bounded live overrides unless all of the following remain true over repeated reviews:

- disagreement remains sparse or interpretable
- abstention remains meaningful
- recovery trends remain educationally coherent
- replay review can explain representative disagreements
- no concentrated pathology dominates one misconception or strategy family

If those conditions are not met, the correct action is still to keep authority bounded and shadow-only.

## Success Criteria

Success in this phase is not maximal adaptation, maximal autonomy, or minimal abstention.

Success means:

- continuous cadence
- meaningful replay review
- bounded authority
- healthy abstention
- stable recovery progression
- sparse explainable overrides
- preserved institutional memory

## Relationship To Other Docs

This runbook complements:

- `docs/REASONING_ENGINE_ARCHITECTURE.md` for source-of-truth doctrine
- `docs/ADAPTIVE_CHANGE_REVIEW.md` for implementation-time gating
- `docs/SHADOW_EXPORT_WORKFLOW.md` for export mechanics and retention

The executable weekly report bundle is generated by `npm run reasoning:report:weekly`.

This document is the recurring operational layer after those documents are already in place.