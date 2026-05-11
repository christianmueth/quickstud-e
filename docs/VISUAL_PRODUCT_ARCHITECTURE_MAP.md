# Visual Product Architecture Map

This document is the visual companion to `docs/PRODUCT_FEATURE_MAP.md`.

It exists to give product, design, and frontend work a single bounded map of:

- public student-facing surfaces
- internal operator-only surfaces
- governed adaptive state
- offline LightZero, MuZero, and Muon integration points
- tiered product rollout priorities

The goal is product clarity, not authority expansion.

## 1. High-Level Product Structure

```text
┌───────────────────────────────────────────────────────────────┐
│                      PUBLIC PRODUCT LAYER                    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Homepage                                                     │
│   ├─ Product positioning                                      │
│   ├─ Adaptive tutoring explanation                            │
│   └─ Entry into guided study                                  │
│                                                               │
│  Study Workspace                                              │
│   ├─ Guided sessions                                          │
│   ├─ Tutor voice                                              │
│   ├─ Adaptive recommendations                                 │
│   ├─ Resume-this-concept                                      │
│   └─ Post-session reflection                                  │
│                                                               │
│  Progress Dashboard                                           │
│   ├─ Confidence trends                                        │
│   ├─ Recovery timeline                                        │
│   ├─ Tutor read                                               │
│   ├─ Next topics feed                                         │
│   └─ Tutor memory moments                                     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                 GOVERNED ADAPTIVE STATE LAYER                │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  StudentState                                                 │
│   ├─ Confidence                                               │
│   ├─ Weak concepts                                            │
│   ├─ Misconception history                                    │
│   ├─ Recovery speed                                           │
│   └─ Cadence / pacing                                         │
│                                                               │
│  ReasoningRun                                                 │
│   ├─ Tutoring sessions                                        │
│   ├─ Recovery events                                          │
│   ├─ Coaching metadata                                        │
│   ├─ Confidence deltas                                        │
│   └─ Recommendation traces                                    │
│                                                               │
│  Adaptive Policy Artifact                                     │
│   ├─ offline_selected_v1                                      │
│   ├─ Shadow-only scoring                                      │
│   ├─ Abstention thresholds                                    │
│   └─ Blend-weight policy                                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│            LIGHTZERO / MUZERO / MUON LAYER                   │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Allowed Uses (Current Phase)                                 │
│   ├─ Replay governance                                        │
│   ├─ Offline policy evaluation                                │
│   ├─ Candidate ranking                                        │
│   ├─ Trajectory comparison                                    │
│   ├─ Confidence / trust correction                            │
│   └─ Evidence-analysis infrastructure                         │
│                                                               │
│  Explicitly Not Active                                        │
│   ├─ Live planner authority                                   │
│   ├─ Online RL                                                │
│   ├─ Autonomous tutoring control                              │
│   ├─ Self-updating policy loops                               │
│   └─ Unrestricted Muon gating                                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│             INTERNAL GOVERNANCE & REVIEW LAYER               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Replay Console                                               │
│   ├─ Disagreement review                                      │
│   ├─ Abstention monitoring                                    │
│   ├─ Recovery inspection                                      │
│   ├─ Governance snapshot                                      │
│   └─ Weekly bundle review                                     │
│                                                               │
│  Governance Artifacts                                         │
│   ├─ reasoning:report:weekly                                  │
│   ├─ Shadow exports                                           │
│   ├─ Operational cadence                                      │
│   └─ Launch verification                                      │
│                                                               │
│  Operator Runtime Gates                                       │
│   ├─ INTERNAL_OPERATOR_CLERK_USER_IDS                         │
│   ├─ Three-session verification                               │
│   ├─ Fail-closed posture                                      │
│   └─ Shadow-only authority                                    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## 2. Product Experience Loop

```text
┌────────────────────┐
│  Tutor Framing     │
│  Before Session    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Guided Session     │
│ Adaptive Tutoring  │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Session Reflection │
│ Recovery Summary   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Updated Student    │
│ State & Recovery   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Next Guided Focus  │
│ Tutor Memory       │
└────────────────────┘
```

## 3. Tiered Feature Roadmap

### Tier 1: Visible Adaptivity

```text
Tutor Voice
Guided Sessions
Recommendation Explanations
Resume-this-concept
Post-session Reflection
Recovery Timeline
```

Goal:

> Make the adaptive system visibly feel like a tutor.

### Tier 2: Adaptive Depth

```text
Tutor Memory Moments
Adaptive Pacing
Next Topics Feed
Continuity-based Guidance
Recovery Progress Narratives
```

Goal:

> Strengthen continuity and educational intelligence.

### Tier 3: Exploratory Depth

```text
Concept Relationship Maps
Adaptive Quiz Mode
Scenario / Problem Solving
Long-Horizon Learning Narratives
```

Goal:

> Add richer educational exploration without widening authority.

## 4. Governance Doctrine

### Constitutional Rule

```text
Capability may evolve.
Authority must still be earned.
```

### Operational Enforcement

Authority is bounded through:

- replay-centered review
- operator-gated governance surfaces
- shadow-only deployment posture
- abstention discipline
- disagreement monitoring
- recovery monitoring
- weekly governance cadence
- executable launch verification
- persisted operational evidence

## 5. Deployment Doctrine

### Public Surfaces

```text
Homepage
Study Workspace
Progress Dashboard
Tutor Guidance
Recovery Timeline
```

### Internal Operator-Only Surfaces

```text
Replay Console
Governance Snapshot
Weekly Governance Reports
Adaptive Telemetry
Shadow Evaluation Data
```

## 6. Strategic Positioning

QuickStud-E is not:

```text
A flashcard app with AI features.
```

QuickStud-E is:

```text
A governed adaptive tutoring platform
with replay-centered operational oversight,
visible educational intelligence,
and bounded adaptive authority.
```

## 7. Current Product Priority

Current leverage is:

```text
Educational experience design
```

Not:

```text
More planner authority
More RL
More autonomous adaptation
```

The product goal for this phase is:

```text
Behaviorally adaptive UX
with governance continuity preserved.
```