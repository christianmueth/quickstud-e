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

## Adaptive Tutor Features

Phase 1 is the visible adaptive intelligence phase for the student product.

Phase objective:

- make QuickStud-E feel deeply adaptive
- expand continuity, not authority
- preserve bounded, interpretable tutor behavior across workspace, study, reflection, and progress surfaces

This phase is:

- continuity expansion
- tutor-presence expansion
- interpretability expansion

This phase is not:

- capability expansion for its own sake
- hidden authority expansion
- planner control rollout
- velocity-at-all-costs delivery

Constitutional constraints for this phase remain non-negotiable:

- no live planner authority
- no online RL rollout
- no unrestricted Muon gating
- no autonomous study execution
- no self-updating policy loops
- no hidden adaptive overrides

The standing rule remains:

```text
capability may evolve
authority must still be earned
```

### Phase 1: Visible Adaptive Intelligence

Timeline:

- Weeks 1 to 4

Primary goal:

- make the product feel like one continuous adaptive tutor across study sets, sessions, recommendations, progress, and reflection surfaces without expanding hidden authority

Implementation order:

1. persistent instructional chat
2. stronger reflection continuity
3. tutor memory presence
4. week-4 integration stabilization pass

Rationale:

- chat establishes ongoing context
- reflection turns session output into learning narrative
- memory hints reinforce tutor-student continuity over time
- integration stabilization ensures all surfaces feel like one product rather than several adaptive fragments

### Persistent Instructional Chat

Status: highest leverage, foundational for continuity

Student-facing goal:

- provide a persistent chat interface that is aware of the student's current learning context and prior tutoring history

Required context awareness:

- current study set and current session
- weak concepts and stabilized concepts
- misconception patterns and recovery events
- tutor memory moments and prior session hints
- preferred explanation style
- session context such as active prompt, queue position, and recent tutoring interactions

Implementation instructions:

- place the chat panel persistently in `/app`
- allow expand and collapse without interrupting queue flow
- read from `StudentState`, `ReasoningRun`, and recovery records already persisted in product tables
- ensure the chat references current adaptive state rather than generic free-form chat behavior
- ensure the chat can suggest and explain but cannot execute study actions on the student's behalf
- update tutor memory from new interactions only as continuity state, not as a hidden authority channel

Tutor voice rules:

- keep the voice calm, instructional, and continuity-aware
- prefer phrasing such as "Last session you struggled with X; here's a quick refresh before moving on."
- avoid product-internal wording such as "AI assistant", "agent", "planner", or "system state"

Testing and QA:

- verify chat continuity across reloads, workspace navigation, and study-set switching
- verify chat references actual weak concepts, stabilized concepts, and recovery history
- verify students cannot use chat to bypass governance or silently modify queues
- verify tutor-language conventions remain consistent with the rest of the product
- target typical load behavior under 200ms when context is already present in the workspace data path

### Stronger Reflection Continuity

Student-facing goal:

- turn post-session summaries into coherent, context-aware tutor narrative rather than isolated metrics

Implementation instructions:

- show a rich post-session summary panel at the end of a guided session
- include what improved, what remains unstable, what changed during the session, and which concept should come next
- surface stabilization tracking such as newly stabilized concepts, recurring weak areas, and recovery progression
- keep the narrative in tutor voice with wording such as "You made strong progress on X; Y remains shaky, so the next session will revisit it."
- pull from `study_recovery`, `ReasoningRun`, and prior tutor memory context already stored in product data
- provide actionable resume-this-concept links that route directly into the next adaptive study destination

Bounded delivery notes:

- avoid raw technical metrics, score dumps, or exposed internal delta numbers on the student surface
- reflection should summarize and guide, not autonomously set goals or widen control boundaries

Testing and QA:

- verify summaries reflect actual session events, weak concepts, and recovery outcomes
- verify next-step links preserve adaptive destination routing and continuity
- verify tutor voice remains consistent with workspace, progress, and guided-session surfaces

### Tutor Memory Presence

Student-facing goal:

- reinforce a persistent tutor-student relationship using interpretable memory cues drawn from real prior sessions

Implementation instructions:

- add lightweight memory references to the dashboard, workspace, study sessions, progress page, and reflection surfaces
- surface short hints such as prior hesitation history, successful explanation types, and stabilized concepts
- persist concise explanation-style memory such as concise vs detailed, example-first, hint-first, and pacing preference
- update tutor memory only after completed guided sessions, tutor-help interactions, and reflection completion

Bounded delivery notes:

- memory cues should inform guidance without altering authority boundaries
- avoid surveillance-like phrasing, hidden adaptation, or opaque preference shaping
- keep memory references short, positive, and educationally useful

Testing and QA:

- verify memory references point to real prior sessions and real explanation behavior
- verify memory hints never imply automatic action selection
- verify tutor memory remains supportive rather than creepy or over-personalized

### Week-By-Week Execution

#### Week 1: Persistent Instructional Chat Foundation

Deliverables:

- persistent tutor chat panel in `/app`
- context integration layer reading current study set, weak concepts, stabilized concepts, misconceptions, recovery events, explanation style, recent guided-session summaries, and tutor memory moments
- tutor voice rules enforced across chat entry, response, and continuity prompts

Week 1 validation:

- chat context awareness is accurate
- chat continuity survives navigation and reloads
- chat remains guidance-only and cannot silently modify study behavior

#### Week 2: Reflection Continuity

Deliverables:

- rich post-session reflection
- stabilization tracking
- resume guidance links into the next adaptive session

Week 2 validation:

- reflection accuracy matches real session activity
- language remains coherent and non-technical
- recommendation continuity and routing remain correct

#### Week 3: Tutor Memory Presence

Deliverables:

- tutor memory moments across dashboard, workspace, study, progress, and reflection surfaces
- explanation-style memory persistence
- bounded memory update logic tied to completed educational interactions

Week 3 validation:

- memory recall is factually correct
- no authority drift appears
- UX remains supportive and non-invasive

#### Week 4: Integration Stabilization

Deliverables:

- tutor voice consistency pass across loading states, empty states, errors, modals, recommendations, reflection, and chat
- workspace continuity pass across study, progress, memory, reflection, and auth continuity
- context-boundary review confirming bounded active context only and no silent adaptive escalation

Week 4 validation:

- full persona sweep across new student, recovering student, strong student, and operator
- recovering-student account visibly demonstrates tutor continuity, memory continuity, recommendation continuity, recovery continuity, and guided-session continuity

### Architecture And Governance Implications

Backend requirements:

- read from `StudentState`, `ReasoningRun`, and `study_recovery` without introducing authority-sensitive write loops

Frontend requirements:

- persistent tutor-consistent UI integrated into `/app`, guided sessions, progress, and reflection surfaces

Data integrity rule:

- tutor context can expand continuity but must remain read-only for authority-sensitive fields and rollout controls

Governance rule:

- preserve shadow-only posture throughout Phase 1; no planner rollout, no online RL expansion, and no hidden adaptive escalation

### Launch Boundaries For Phase 1

All Phase 1 features must:

- avoid autonomous study execution
- integrate with existing protected-route logic
- preserve modal auth and `?next=...` continuity
- maintain operator and replay isolation
- preserve fail-closed governance boundaries

### Success Criteria For Phase 1

Phase 1 succeeds if students consistently perceive one continuous adaptive tutor across:

- study sessions
- reflection surfaces
- recommendations
- workspace navigation
- progress surfaces
- persistent chat

Phase 1 fails if visible adaptivity requires:

- hidden authority expansion
- governance erosion
- opaque control behavior
- chat drift into unbounded autonomous assistant behavior

The correct model is:

- guided instructional continuity

The incorrect model is:

- agentic educational control

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