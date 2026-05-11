# Production Operator Test Script

Use this as a focused operator supplement to `docs/GO_LIVE_CHECKLIST.md`.

The primary launch gate is the go-live checklist. This document is narrower: it verifies the operator boundary, seeded adaptive visibility, and the highest-risk public auth continuity flow after the environment and migration checks already pass.

## 1. Confirm Production Environment Variables

Before using this script, first complete the environment and migration sections in `docs/GO_LIVE_CHECKLIST.md`.

Reconfirm these variables in the production host:

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

Pass only if `INTERNAL_OPERATOR_CLERK_USER_IDS` contains the real Clerk operator user ID for the production operator account and `TUTORING_ADAPTIVE_RERANK_ENABLED=0` still holds.

## 2. Verify Seed Personas Exist

Reconfirm the seeded QA accounts exist and are accessible:

- `newstudent@test.quickstude`
- `recoveringstudent@test.quickstude`
- `strongstudent@test.quickstude`
- `operator@test.quickstude`

Pass only if:

- the recovering-student account visibly shows adaptive state
- the new-student account remains sparse enough to exercise empty states
- the operator account is present in `INTERNAL_OPERATOR_CLERK_USER_IDS`

The recovering-student account is the canonical demo and smoke-test account.

## 3. Highest-Priority Public Flow

Open an anonymous session and navigate directly to:

```text
/app/progress
```

Verify:

- redirect lands on `/?next=/app/progress`
- homepage loads cleanly
- modal auth can be triggered from the homepage or header

Then sign in as:

```text
recoveringstudent@test.quickstude
```

Verify:

- user returns to `/app/progress`
- tutor progress read is visible
- recommendations are populated
- recovery summaries are visible
- tutor memory moments are visible

Do not continue to launch if the destination is lost or the adaptive surfaces appear empty.

## 4. Three-Session Boundary Test

Use three sessions:

| Session | Account | Expected |
| --- | --- | --- |
| Browser A | operator | can access `/app/reasoning` |
| Browser B | normal student | blocked from `/app/reasoning` |
| Incognito | anonymous | redirected or sign-in required |

Also test:

```text
/api/governance/latest
```

Expected:

- operator: JSON or a valid governance response
- student: denied
- anonymous: denied

Do not launch if any non-operator session can access the replay console, governance snapshot, or governance API.

## 5. Public Product Test

Verify:

- homepage loads
- resources page loads
- modal sign-in and sign-up work
- recovering-student dashboard loads with adaptive state
- recommendations route into focused study
- guided session reflection remains coherent

## 6. Final Governance Check

Confirm production still has:

```env
TUTORING_ADAPTIVE_RERANK_ENABLED=0
```

Do not launch if this is `1`.

## 7. After Launch

Run weekly:

```bash
npm run reasoning:report:weekly
```

Treat skipped cadence as an operational failure, not optional maintenance.