# Shadow Export Workflow

This runbook defines the operational workflow for exporting real adaptive shadow telemetry from persisted `tutor_guidance` runs.

Use it to create repeatable evidence snapshots before any increase in adaptive authority.

## Purpose

The shadow exporter turns live governed telemetry into persistent artifacts for later comparison.

Each snapshot should preserve:

- disagreement traces
- abstentions
- candidate feature vectors
- heuristic vs adaptive deltas
- replay-facing explanation fields

These snapshots are the primary evidence source for real-world disagreement geometry, calibration drift, and localized pathology detection.

## Prerequisite

The current database must contain the reasoning tables.

If export fails with a missing `ReasoningRun` or reasoning-table error, apply the latest Prisma migrations or point the workspace at the database that already contains the reasoning schema.

## Export Commands

Default export:

```powershell
npm run reasoning:export:shadow
```

Small validation export:

```powershell
npm run reasoning:export:shadow -- --limit 50
```

Shadow-only export with text previews:

```powershell
npm run reasoning:export:shadow -- --shadow-only --include-text --limit 500 --out tmp/adaptive-shadow.jsonl --summary-out tmp/adaptive-shadow.summary.json
```

## Snapshot Naming Convention

Retain snapshots in dated folders so drift can be analyzed over time.

Recommended structure:

```text
shadow_exports/
  YYYY-MM-DD/
    shadow_dataset.jsonl
    summary.json
    replay_digest.json
```

If snapshots are stored outside the repo, preserve the same folder and file naming pattern.

## Required Snapshot Metadata

Each retained snapshot should record, alongside the exported files if not already embedded in the summary:

- policy artifact version
- selected policy label
- scorer kind
- shadow or active mode
- blend weight
- abstain threshold
- disagreement or override budget in effect
- export date
- schema version for the export format

At the current stage, the minimum acceptable comparison metadata is:

- `offline_selected_v1`
- blend `0.55`
- abstain threshold `0.015`
- deployment posture `shadow-only`

## Retention Cadence

Recommended cadence:

- daily while shadow traffic is still sparse
- weekly once the system has stable ongoing traffic

Do not overwrite earlier snapshots. Temporal comparison is the point.

## Daily Review Workflow

After each export, inspect:

- disagreement rate
- abstention rate
- override rate
- score-margin distribution
- misconception concentration
- strategy concentration
- dominant disagreement shifts

Healthy early patterns are:

- sparse disagreement
- common abstention
- non-collapsed score margins
- localized and interpretable disagreement clusters
- no single strategy or misconception family dominating the shadow traces

## Escalation Rule

Do not enable adaptive authority based only on offline lift or a single export snapshot.

Use exports together with replay inspection and the shadow-readiness panel to decide whether the current behavior is:

- hold shadow mode
- continue shadow collection
- eligible for a bounded trial

If exports show collapsed margins, low abstention, unexplained disagreement spikes, or concentrated pathology, keep authority disabled.

For the recurring weekly review loop that combines shadow exports with replay inspection and recovery-pattern monitoring, use `docs/OPERATIONAL_REVIEW_CADENCE.md`.