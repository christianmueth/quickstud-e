# Go-Live Checklist

Use this as the operator runbook before first public deployment and before any materially similar relaunch.

Public launch is blocked unless all of the following are true:

- the production build succeeds
- production migrations succeed
- `INTERNAL_OPERATOR_CLERK_USER_IDS` is correctly configured with real operator IDs
- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- anonymous -> protected route -> homepage `?next=...` -> modal auth -> restored destination works
- operator-only replay and governance surfaces remain fail-closed for non-operators

If any of those fail, do not launch.

## 1. Repo Baseline

Run:

```powershell
git status
git log -1
npm install
npx prisma generate
npm run build
```

Pass only if:

- working tree is in the expected deploy state
- dependencies install cleanly
- Prisma client generates cleanly
- build succeeds without fatal route or runtime failures

## 2. Production Environment

Verify the real production environment contains:

```text
DATABASE_URL=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
INTERNAL_OPERATOR_CLERK_USER_IDS=user_abc123,user_xyz456
TUTORING_ADAPTIVE_RERANK_SHADOW=1
TUTORING_ADAPTIVE_RERANK_ENABLED=0
TUTORING_ADAPTIVE_POLICY_VERSION=offline_selected_v1
TUTORING_ADAPTIVE_BLEND_WEIGHT=0.55
TUTORING_ADAPTIVE_ABSTAIN_THRESHOLD=0.015
```

Pass only if:

- `INTERNAL_OPERATOR_CLERK_USER_IDS` contains real Clerk user IDs only
- placeholder IDs are removed
- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`

## 3. Database Verification

Run against production:

```powershell
npx prisma migrate deploy
npx prisma migrate status
```

Pass only if:

- migrations apply successfully
- reasoning tables exist
- no pending migration drift is reported
- no connectivity failures occur

## 4. Seed Account Verification

Verify these accounts and their intended states exist before QA:

- `newstudent@test.quickstude`
- `recoveringstudent@test.quickstude`
- `strongstudent@test.quickstude`
- `operator@test.quickstude`

The canonical demo and smoke-test account is `recoveringstudent@test.quickstude`.

Pass only if the recovering-student account visibly demonstrates:

- weak concepts
- stabilized concepts
- misconception patterns
- recovery events
- recommendation traces
- tutor memory moments
- prior guided-session summaries

If these adaptive surfaces appear empty, do not treat seed setup as complete.

## 5. Highest-Priority Auth Flow

Test this first.

1. Open an anonymous browser session.
2. Navigate directly to `/app/progress`.
3. Verify redirect lands on `/?next=/app/progress`.
4. Verify the homepage loads cleanly and modal auth can be triggered from the homepage or header.
5. Sign in as `recoveringstudent@test.quickstude`.
6. Verify the user returns to `/app/progress`.
7. Verify all of the following are visible immediately:
	- tutor progress read
	- recommendations
	- recovery summaries
	- tutor memory moments

Pass only if:

- no redirect loop occurs
- no auth mismatch occurs
- the requested destination is preserved
- adaptive surfaces are populated immediately
- tutor voice remains coherent

## 6. Guided Session Verification

Using `recoveringstudent@test.quickstude`:

1. Open the progress dashboard.
2. Click a recommended concept.
3. Verify focused guided session framing appears.
4. Verify the session shows why the tutor picked the concept.
5. Answer incorrectly.
6. Request tutor help.
7. Verify the tutoring references a weak concept or misconception pattern.
8. Grade the step as `Still shaky`.
9. Finish the session.
10. Verify post-session reflection references actual weak concepts or stabilization state.

Pass only if:

- tutor voice does not disappear mid-flow
- no raw technical wording leaks into the session
- recommendations feel continuous with the dashboard state
- reflection references seeded adaptive state rather than generic copy

## 7. Empty-State Verification

Using `newstudent@test.quickstude`:

1. Open `/app/progress`.
2. Verify calm onboarding language and minimal recommendations.
3. Verify recovery state is light but supportive rather than empty or mechanical.
4. Create a first study set.
5. Generate guided review.

Pass only if:

- empty states remain supportive
- no technical jargon leaks through
- tutor continuity remains intact through first-set creation

## 8. Operator Boundary Verification

Use three sessions:

- anonymous browser
- signed-in student browser
- signed-in operator browser

Verify:

| Surface | Operator account | Regular student | Anonymous session |
| --- | --- | --- | --- |
| `/app/reasoning` | accessible | denied | redirected or denied |
| `/api/reasoning-runs` | accessible | denied | denied |
| `/api/governance/latest` | accessible | denied | denied |

Pass only if:

- replay is inaccessible to students
- governance APIs are inaccessible to students and anonymous sessions
- operator session can load the replay console and governance snapshot
- failures remain fail-closed

## 9. Public Product Verification

Verify public and student-facing surfaces:

- homepage loads cleanly
- resources page loads and explains bounded adaptive guidance accurately
- modal sign-in and sign-up work from homepage and header
- study workspace loads
- progress page loads
- recommendations route into focused study
- recovery timeline renders when adaptive state exists

Verify language remains consistent with the live product vocabulary:

- study set
- guided review
- study prompt
- guided session
- study workspace

Avoid launch if visible student flows regress back into raw technical wording or brittle auth routes.

## 10. Final Governance Verification

Verify before public traffic:

- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`
- no planner authority is enabled
- no online RL authority is enabled
- no unrestricted Muon gating is enabled
- weekly governance generation runs without blocking errors

Run:

```powershell
npm run reasoning:report:weekly
```

## 11. Launch And Post-Launch

Launch only after all sections above pass.

Immediately after launch:

- collect tutoring traces
- collect recovery trajectories
- review replay weekly
- inspect recommendation coherence
- inspect abstention behavior
- preserve governance cadence without interruption

Stop and review immediately if:

- redirect loops appear
- `?next` preservation breaks
- adaptive surfaces appear empty for the recovering-student persona
- tutor continuity collapses into technical wording
- replay or governance becomes visible to students
- adaptive authority is widened accidentally

## 12. Related Documents

- `docs/PRODUCTION_LAUNCH_COMMAND_SHEET.md`
- `docs/LAUNCH_BRIEF.md`
- `docs/REASONING_ENGINE_ARCHITECTURE.md`
- `docs/ADAPTIVE_CHANGE_REVIEW.md`
- `docs/SHADOW_EXPORT_WORKFLOW.md`
- `docs/OPERATIONAL_REVIEW_CADENCE.md`
- `docs/PRODUCTION_OPERATOR_TEST_SCRIPT.md`