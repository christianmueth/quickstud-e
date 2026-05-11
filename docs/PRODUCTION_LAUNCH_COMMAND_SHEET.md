# Production Launch Command Sheet

Use this during the live launch window.

This is the shortest operator-facing launch runbook for production. It compresses the full governance and launch documents into one strict execution order under pressure.

Constitutional rule:

```text
Capability may evolve.
Authority must still be earned.
```

Primary references:

- `docs/GO_LIVE_CHECKLIST.md`
- `docs/PRODUCTION_OPERATOR_TEST_SCRIPT.md`

## T-24h: Freeze Main Branch

Only allow:

- deployment fixes
- environment fixes
- blocker fixes

Do not allow:

- new architecture changes
- adaptive authority changes
- planner work
- online RL changes
- unrestricted Muon gating changes
- large refactors unrelated to launch readiness

Run locally:

```powershell
npm install
npx prisma generate
npm run build
```

Pass only if:

- the current build is the intended bounded tutoring baseline
- the build succeeds
- the latest governance snapshot intended for launch is present

## T-12h: Configure Production Environment

Verify these production variables are live in the deployment host:

```env
DATABASE_URL=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
INTERNAL_OPERATOR_CLERK_USER_IDS=user_...
TUTORING_ADAPTIVE_RERANK_SHADOW=1
TUTORING_ADAPTIVE_RERANK_ENABLED=0
TUTORING_ADAPTIVE_POLICY_VERSION=offline_selected_v1
TUTORING_ADAPTIVE_BLEND_WEIGHT=0.55
TUTORING_ADAPTIVE_ABSTAIN_THRESHOLD=0.015
```

Pass only if:

- `INTERNAL_OPERATOR_CLERK_USER_IDS` contains real operator Clerk IDs only
- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`
- no placeholder values remain

## T-6h: Run Production Prisma Verification

Run against production:

```powershell
npx prisma migrate deploy
npx prisma migrate status
```

Pass only if:

- migrations apply successfully
- reasoning tables exist
- schema is up to date
- no drift is reported

## T-3h: Seed QA Accounts

Verify these personas exist:

- `newstudent@test.quickstude`
- `recoveringstudent@test.quickstude`
- `strongstudent@test.quickstude`

Use `recoveringstudent@test.quickstude` as the canonical demo and smoke-test account.

Pass only if seeded state includes:

- weak concepts
- stabilized concepts
- misconception patterns
- recovery events
- confidence history
- recommendation traces
- tutor memory moments
- prior guided-session summaries

If these surfaces appear empty, seed setup is not complete.

## T-2h: Three-Session Operator Boundary Test

Use:

- anonymous session
- signed-in student session
- operator session

Verify:

- `/app`
- `/app/reasoning`
- `/api/reasoning-runs`
- `/api/governance/latest`

Pass only if:

- anonymous traffic to protected routes redirects through `/?next=...`
- student can use the study workspace and progress surfaces
- student cannot access replay or governance APIs
- operator can access replay and governance surfaces
- all failures remain fail-closed

## T-1h: Auth Continuity Test

In an anonymous session:

1. Open `/app/progress`
2. Confirm redirect lands on `/?next=/app/progress`
3. Trigger modal auth from the homepage or header
4. Sign in as `recoveringstudent@test.quickstude`
5. Confirm the user returns to `/app/progress`

Pass only if:

- no redirect loop occurs
- no auth mismatch occurs
- the requested destination is preserved
- tutor voice and recommendations appear immediately after return

## Launch Execution

Deploy the public product surface.

Keep the production posture locked to:

- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- shadow-only adaptive tutoring
- no live planner authority
- no online RL rollout
- no unrestricted Muon gating

Do not launch if:

- operator isolation is wrong
- auth continuity breaks
- recovering-student adaptive state appears empty
- tutor continuity collapses into technical wording

## Post-Launch Day 1

Run without skipping cadence:

```powershell
npm run reasoning:report:weekly
```

Inspect:

- replay output
- recovery patterns
- disagreement metrics
- abstention metrics

Treat the first live phase as evidence collection, not authority expansion.

Do not use launch success to justify:

- planner authority
- online RL rollout
- unrestricted Muon gating
- widening adaptive override scope

## Highest-Risk Checks

- auth continuity through the `?next` flow
- operator isolation for replay and governance APIs
- recovery and recommendation visibility for seeded QA accounts
- tutor voice consistency through a guided session
- shadow-only flag enforcement in production

## Baseline Interpretation

The launch baseline is intentionally incomplete in the correct way.

What exists now:

- auth continuity
- operator isolation
- replay-centered governance
- recovery infrastructure
- student-facing tutor continuity
- shadow-only adaptive posture

What should still be accumulated after launch:

- real production tutoring traces
- real shadow disagreement evidence
- real adaptive telemetry volume

That remaining uncertainty is operational, not structural.