# Adaptive Change Review Checklist

Any change that increases adaptive capability or adaptive authority must satisfy the following review gates.

This includes MuZero, Muon, and LightZero-inspired changes to candidate generation, value prediction, reranking, search, planning, or online adaptation.

## Checklist

### 1. Observable Before Authoritative

- Can the behavior run in shadow mode before it affects users?
- Are disagreements logged before any authority is granted?

### 2. Replay Inspectability

- Can replay show candidate scores, chosen path, rejected path, abstention status, and override status?
- Can a human explain representative disagreements from replay evidence?

### 3. Bounded Authority

- Is there an explicit override budget, disagreement budget, or other bounded authority control?
- Is heuristic fallback preserved as the default safe controller?

### 4. Abstention Semantics

- Can the system defer instead of forcing an adaptive decision?
- Is abstention rate monitored as a first-class signal?

### 5. Drift And Pathology Checks

- Are disagreement clusters tracked by misconception, strategy, and student-state features?
- Are score margins, calibration, and concentration monitored for collapse or local pathology?

### 6. Rollback

- Is there a feature flag or config switch to disable adaptive authority immediately?
- Can the system return to heuristic-only control without code changes?

## Rule

No adaptive change may gain authority unless it remains:

- observable
- replayable
- abstainable
- bounded
- reversible

If any of those properties are missing, the change may run in shadow mode only.

Offline improvement alone is not a justification for more live authority.

## Usage

Use this checklist during:

- implementation review
- rollout review
- artifact or policy upgrades
- future online-learning, RL, or planner-authority changes

This checklist is an implementation gate derived from the source-of-truth architecture doctrine in `docs/REASONING_ENGINE_ARCHITECTURE.md`.