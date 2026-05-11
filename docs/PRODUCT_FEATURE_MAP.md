# Product Feature Map

This document defines the next high-value student-facing product work for QuickStud-E.

For a visual system map spanning public surfaces, governed adaptive state, offline model roles, and operator-only governance layers, see `docs/VISUAL_PRODUCT_ARCHITECTURE_MAP.md`.

For post-deploy experiential review of session flow, continuity, and pacing, see `docs/UX_REVIEW_PLAYBOOK.md`.

The goal is not to increase authority. The goal is to make existing adaptive behavior feel visible, coherent, and useful to students while keeping the system bounded, interpretable, and replay-governed.

## Product Principle

QuickStud-E is already technically adaptive. The next phase is to make it behaviorally adaptive.

That means prioritizing:

- visible tutor behavior
- guided session structure
- continuity and memory in student-facing copy
- interpretable recommendation reasons
- bounded delivery backed by existing student-state and replay evidence

Do not prioritize more planner authority, online RL, or opaque control loops for this phase.

## Delivery Tiers

## Tier 1: Immediate Product Leverage

These features should ship first because they make adaptivity visible without expanding authority.

### 1. Conversational Tutor Layer

Status: partially shipped

Current anchor:

- tutor voice on the progress dashboard
- tutor guide in guided study

Next additions:

- tutor voice on the main study workspace
- stronger continuity language across deck entry, study, and progress surfaces
- explanation variants tuned to confidence, misconception, and recent recovery

Dependencies:

- `StudentState`
- tutoring guidance API
- recent `ReasoningRun` summaries

Bounded integration notes:

- use current tutoring outputs and student-state fields only
- do not add new authority to strategy selection
- keep recommendation reasons explicit in the UI

### 2. Adaptive Guided Sessions

Student-facing goal:

- replace generic deck study with a clear "today's guided session" flow

Core behavior:

- prioritize weak concepts first
- interleave stabilized topics so sessions do not feel punitive
- bias toward recent recovery opportunities
- keep the sequence explainable

Dependencies:

- `StudentState.weakConcepts`
- recovery metadata from `study_recovery`
- study queue ordering in `/api/deck/[id]/study`

Bounded integration notes:

- use heuristic queue construction with replay-informed signals
- do not expose planner language or autonomous sequencing claims
- every focused session should explain why it exists

### 3. Post-Session Reflection Card

Student-facing goal:

- end each session with a short tutor summary

Minimum output:

- what improved
- what remains unstable
- what to study next

Dependencies:

- current review grading
- recent session confidence and misconception signals
- tutoring strategy summaries already persisted in `ReasoningRun`

Bounded integration notes:

- reflection is summarization, not autonomous goal setting
- keep tone instructional and concrete

### 4. Stronger Recommendation Explanations

Student-facing goal:

- make every recommendation answer "why am I seeing this?"

Minimum UX pattern:

- because your recall dropped recently
- because this misconception repeated
- because this concept stabilized less than related concepts

Dependencies:

- current recommendation card rendering
- weak-topic memory
- recovery timeline summaries

Bounded integration notes:

- prefer short causal explanations over opaque scores
- never expose internal governance or replay jargon on student surfaces

## Tier 2: Structured Adaptive Depth

These features add real value after Tier 1 is stable.

### 5. Adaptive Difficulty And Pacing

Student-facing goal:

- adjust session tempo and explanation intensity based on confidence and recovery behavior

Examples:

- slow down after repeated misses
- switch to examples-first tutoring
- increase mixture and retrieval after stabilization

Dependencies:

- pacing profile in `StudentState`
- tutoring strategy types
- recent confidence and recovery signals

Bounded integration notes:

- use low-authority pacing adjustments inside existing heuristic control
- keep changes reversible and replay-visible

### 6. Continuity Memory

Student-facing goal:

- make the tutor feel like it remembers prior struggles and wins

Examples:

- last week this concept caused hesitation
- you usually recover faster with worked examples first
- this topic stabilized faster than expected

Dependencies:

- `recentFailures`
- `recentSuccesses`
- preferred explanation style
- recovery timeline data

Bounded integration notes:

- continuity should summarize existing state, not infer hidden personal traits
- avoid anthropomorphic overclaiming

### 7. Recovery Timeline Enhancements

Student-facing goal:

- make recovery and confidence change more interpretable over time

Potential additions:

- weekly view
- predicted next-step mastery likelihood
- clearer stabilized versus unstable transitions

Dependencies:

- existing recovery timeline
- offline `confidence_delta` model outputs when available

Bounded integration notes:

- predictions should be framed as study guidance, not certainty
- show the reason for a prediction when possible

### 8. Personalized Next Topics Feed

Student-facing goal:

- give students a small, always-available set of recommended next concepts

Minimum output:

- top 3 to 5 concepts
- why each is recommended
- expected effort or study scope

Dependencies:

- student-state
- recent recovery outcomes
- confidence trend summaries

Bounded integration notes:

- treat this as ranking plus explanation, not autonomous curriculum control

## Tier 3: Richer Exploration Surfaces

These features are valuable, but they should wait until the core tutor experience is coherent.

### 9. Concept Relationship Map

Student-facing goal:

- show how concepts connect, which are fragile, and what depends on what

Dependencies:

- concept extraction from decks and runs
- offline weighting from replay or value-style review

Bounded integration notes:

- the map should guide exploration, not silently control study plans

### 10. Adaptive Quiz Mode

Student-facing goal:

- provide short quizzes focused on weak spots after study or recovery sessions

Dependencies:

- question candidate generation
- confidence-delta-informed ranking
- post-quiz reflection summaries

Bounded integration notes:

- keep delivery heuristic-authoritative
- keep any learned ranking in shadow or bounded low-authority mode until enough live evidence exists

### 11. Scenario Or Problem-Solving Mode

Student-facing goal:

- add multi-step reasoning practice beyond flashcards

Dependencies:

- structured problem content
- candidate solution trajectories
- explanation comparison and verification flows

Bounded integration notes:

- expose multiple solution paths as reviewed alternatives
- do not present this as live autonomous planning

## Operator-Only Surfaces

These stay internal-only and must not be blended into student-facing UX:

- replay console
- governance snapshot
- disagreement monitoring
- abstention monitoring
- rollout readiness review

Student-facing surfaces may benefit from their outputs indirectly, but must not expose internal governance tooling.

## Website Cleanup Plan

## Navigation

Top-level navigation should group features into a small number of stable buckets:

- Study
- Progress
- Resources

Operator-only tooling should remain undiscoverable from public navigation.

## Visual Consistency

Align:

- page headers
- card spacing
- empty states
- recommendation explanation blocks
- tutor voice panels

Tutor panels should feel like one consistent product language across dashboard, study, and future reflection surfaces.

## Feature Surfacing Rule

Only surface features that are operational today.

Do not surface:

- planner authority
- experimental RL pages
- dormant research tooling
- speculative adaptive controls

## Performance And Hygiene

Before broader traffic:

- verify production dependencies are necessary
- review unresolved audit vulnerabilities
- keep experiment trees out of the deploy baseline
- confirm Prisma migrations are applied before launch

## Rollout Order

The recommended implementation order is:

1. finish tutor voice coverage across student-facing entry points
2. add post-session reflection
3. deepen recommendation explanations and next-topics feed
4. improve adaptive pacing and continuity memory
5. extend recovery timeline and confidence prediction surfaces
6. add concept map and adaptive quiz mode
7. add scenario or problem-solving mode

## LightZero, MuZero, And Muon Integration Rule

For this product phase, these systems remain bounded to:

- replay governance infrastructure
- offline policy evaluation
- value-style review
- disagreement analysis
- evidence-backed ranking support

They do not provide:

- autonomous planner authority
- live online RL rollout control
- hidden student-facing authority expansion

The governing rule remains:

```text
capability may evolve
authority must still be earned
```