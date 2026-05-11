# Launch Brief

QuickStud-E is launching as a governed adaptive tutoring platform.

It is not launching as:

- an autonomous tutoring AI
- an unrestricted planner system
- a self-modifying educational agent
- a hidden-control recommendation engine

The operating rule remains:

```text
Capability may evolve.
Authority must still be earned.
```

## Product Posture

Current student-facing product includes:

- public homepage with modal sign-in and sign-up
- public resources page explaining adaptive guidance
- authenticated study workspace at `/app`
- study-set creation from URL, pasted text, PDF or PPTX, subtitles, and uploaded audio or video
- guided review generation and study notes generation
- study library and individual study-set pages
- guided sessions with answer-first tutoring, optional tutor help, confidence-style grading, and post-session reflection
- progress page with tutor read, recovery timeline, recommendations, and tutor memory moments

Current governance posture includes:

- operator-only replay console at `/app/reasoning`
- fail-closed operator boundary using `INTERNAL_OPERATOR_CLERK_USER_IDS`
- shadow-only adaptive posture
- no live planner authority, online RL rollout, unrestricted Muon gating, or self-updating policy loops
- weekly governance cadence via `npm run reasoning:report:weekly`

Current auth posture includes:

- protected routes redirect anonymous users to the homepage with `?next=...`
- homepage modal auth preserves the requested destination
- navbar modal auth preserves the requested destination
- `/sign-in` and `/sign-up` are guidance pages, not the primary auth surface

## Canonical Seed Personas

### New student

- email: `newstudent@test.quickstude`
- purpose: onboarding, empty-state UX, first-session flow
- expected state: one study set, minimal history, little or no recovery data, little or no tutor memory

### Recovering student

- email: `recoveringstudent@test.quickstude`
- purpose: primary demo and QA account
- expected state: visible weak concepts, misconception patterns, recovery events, recommendation traces, tutor memory moments, and prior session summaries
- use this account first for any post-deploy smoke pass because it exercises the visible adaptive features that differentiate the product

### Strong student

- email: `strongstudent@test.quickstude`
- purpose: pacing and retention validation
- expected state: mostly stabilized concepts, limited weak areas, light guidance and maintenance-oriented recommendations

### Operator

- email: `operator@test.quickstude`
- purpose: replay and governance validation
- required config: must be present in `INTERNAL_OPERATOR_CLERK_USER_IDS`

Seeded accounts are QA assets, not public demo credentials. Keep access controlled and do not expose them as general public sign-in accounts.

## Required Adaptive Seed State

Seeded data must include more than study content. It must include visible adaptive state such as:

- weak concepts
- stabilized concepts
- misconception patterns
- recovery events
- confidence history
- recommendation traces
- tutor memory moments
- prior guided-session summaries

Without this state, the product will appear structurally complete but behaviorally empty during QA.

## Highest-Risk Flows

Test these first:

1. Anonymous -> protected route -> homepage `?next=...` -> modal auth -> restored destination
2. Recovering-student adaptive visibility: recommendations, recovery summaries, tutor memory moments, weak-topic focus
3. Guided session coherence: tutor voice, calm fallback states, post-session reflection
4. Operator isolation: replay and governance surfaces inaccessible to students and anonymous sessions

## Launch Success Definition

Initial launch succeeds only if:

- public tutoring flows are stable
- adaptive surfaces are visibly populated for the recovering-student persona
- auth continuity is preserved through modal sign-in
- operator boundaries remain fail-closed
- weekly governance cadence continues uninterrupted
- adaptive authority remains shadow-only

## Freeze And Operator Handoff

Use the following message when transitioning from active design work into the launch window.

```text
QuickStud-E is now entering launch freeze.

From this point until launch completion, the repository is no longer in active design mode. It is now in launch execution mode.

Allowed changes:
- deployment fixes
- environment fixes
- blocker fixes
- production defect fixes

Disallowed changes:
- new architecture work
- adaptive authority changes
- planner work
- online RL changes
- unrestricted Muon gating changes
- large refactors unrelated to launch readiness

Launch objective:
Ship the bounded adaptive tutoring surface with operator-only governance access and shadow-only adaptive posture intact.

Constitutional rule:
capability may evolve
authority must still be earned

Operators should execute only from these runbooks:
- docs/PRODUCTION_LAUNCH_COMMAND_SHEET.md
- docs/GO_LIVE_CHECKLIST.md
- docs/PRODUCTION_OPERATOR_TEST_SCRIPT.md

Highest-priority launch gates:
1. production environment correctness
2. Prisma migration success
3. seeded recovering-student adaptive visibility
4. three-session operator boundary test
5. auth continuity through the `?next` flow

Do not treat successful launch as permission to widen authority.

The first live phase is for:
- evidence collection
- replay review
- governance cadence preservation
- operational stability validation

Adaptive tutoring remains shadow-governed:
- no planner authority
- no online RL rollout
- no unrestricted Muon gating
- no self-updating policy loops
```

Related execution documents:

- `docs/PRODUCTION_LAUNCH_COMMAND_SHEET.md`
- `docs/GO_LIVE_CHECKLIST.md`
- `docs/PRODUCTION_OPERATOR_TEST_SCRIPT.md`