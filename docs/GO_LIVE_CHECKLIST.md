# Go-Live Checklist

Use this runbook before the first public deployment and before any materially similar re-launch.

QuickStud-E is now a deployable replay-governed adaptive tutoring platform. The goal of this checklist is not to increase capability. The goal is to verify that the public product surface, the bounded authority posture, and the internal governance boundary all remain intact at launch.

## Release Standard

Public deployment is acceptable only if all three conditions remain true:

- the student-facing tutoring product is coherent and usable
- adaptive authority remains bounded and shadow-first
- replay and governance surfaces remain operator-only

If any of those fail, hold deployment and fix the boundary rather than widening risk acceptance.

## 1. Operator Authorization

Set the operator allowlist before launch:

```text
INTERNAL_OPERATOR_CLERK_USER_IDS=user_abc123,user_xyz456
```

Requirements:

- include every operator Clerk user ID that should access replay and governance surfaces
- keep the variable set in the production environment
- prefer a small allowlist over broad internal exposure
- fail closed if the allowlist is missing or incomplete

## 2. Production Secrets And Connectivity

Set and verify the minimum production secrets before launch:

```text
INTERNAL_OPERATOR_CLERK_USER_IDS=user_abc123,user_xyz456
DATABASE_URL=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
```

Verify all of the following against the real deployment target:

- Neon database connectivity
- Prisma connectivity
- Clerk authentication
- operator allowlist presence

If any of those fail, do not proceed to public launch.

## 3. Access Boundary Verification

Verify each case with a real session before launch.

| Surface | Operator account | Regular student | Anonymous session |
| --- | --- | --- | --- |
| `/app/reasoning` | accessible | denied | denied |
| `/api/reasoning-runs` | accessible | denied | denied |
| `/api/governance/latest` | accessible | denied | denied |

Also verify that the replay console and its weekly governance snapshot panel are visible only to operator-authorized sessions.

Expected behavior:

- operator accounts can access the internal replay console and governance bundle
- regular student accounts cannot access replay or governance surfaces
- anonymous sessions cannot access replay or governance surfaces

The public UI should not advertise internal governance tooling.

## 4. Infrastructure Verification

Confirm the environment is operational before launch.

- verify Prisma migrations are applied
- verify adaptive environment variables are correct
- verify `INTERNAL_OPERATOR_CLERK_USER_IDS` is configured
- verify weekly governance report generation succeeds
- verify export scripts still run against the connected database

Minimum adaptive posture at launch:

- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`
- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `TUTORING_ADAPTIVE_POLICY_VERSION=offline_selected_v1`
- `TUTORING_ADAPTIVE_BLEND_WEIGHT=0.55`
- `TUTORING_ADAPTIVE_ABSTAIN_THRESHOLD=0.015`

## 5. Product Verification

Run a final pass on the public product surface.

- homepage loads and reflects adaptive tutoring, recovery-aware learning, and bounded authority accurately
- tutoring flow works end to end
- progress dashboard loads correctly
- recovery timeline renders correctly
- resume-this-concept routing lands in focused study as expected
- trust page loads and explains adaptive guidance clearly
- onboarding and sign-in flows work cleanly

The deployment target is a coherent tutoring product, not a demonstration of internal governance internals.

## 6. Governance Verification

Check the internal governance loop before launch.

- replay console loads for operator accounts
- latest governance bundle is visible in the replay console
- disagreement metrics are present when data exists
- abstention metrics are present when data exists
- recovery metrics are present when data exists
- weekly report generation runs without blocking errors

Absence of traffic is acceptable early. Absence of governance access control is not.

## 7. Final Build Check

Run the production build before deployment.

```powershell
npm run build
```

Treat build success as necessary but not sufficient. Launch readiness also depends on the access boundary and operational checks above.

## 8. Immediate Post-Deploy Posture

After launch:

- collect real tutoring traces
- review replay weekly
- preserve governance cadence
- inspect recovery progression
- monitor disagreement geometry
- preserve abstention discipline

Do not:

- widen authority
- reduce abstention aggressively
- enable planner authority
- add online RL authority
- bypass replay review
- optimize for aggressive automation

The weekly governance cadence command is:

```powershell
npm run reasoning:report:weekly
```

Do not skip it.

## 9. Correct Success Definition

The correct success definition for this phase is:

- safe public tutoring deployment
- continuous governance operation
- preserved bounded authority
- real evidence accumulation under traffic
- stable educational recovery monitoring

Success is not maximal autonomy.

## 10. Related Runbooks

- `docs/REASONING_ENGINE_ARCHITECTURE.md`
- `docs/ADAPTIVE_CHANGE_REVIEW.md`
- `docs/SHADOW_EXPORT_WORKFLOW.md`
- `docs/OPERATIONAL_REVIEW_CADENCE.md`