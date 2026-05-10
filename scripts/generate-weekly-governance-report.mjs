import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function defaultDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseArgs(argv) {
  const date = defaultDate();
  const outDir = `governance_reports/${date}`;
  const out = {
    date,
    outDir,
    shadowLimit: 500,
    recoveryLimit: 500,
    includeText: false,
    shadowOnly: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date" && argv[index + 1]) {
      out.date = argv[++index];
      out.outDir = `governance_reports/${out.date}`;
    } else if (arg === "--out-dir" && argv[index + 1]) out.outDir = argv[++index];
    else if (arg === "--shadow-limit" && argv[index + 1]) out.shadowLimit = Number(argv[++index]) || out.shadowLimit;
    else if (arg === "--recovery-limit" && argv[index + 1]) out.recoveryLimit = Number(argv[++index]) || out.recoveryLimit;
    else if (arg === "--include-text") out.includeText = true;
    else if (arg === "--allow-active") out.shadowOnly = false;
    else if (arg === "--help" || arg === "-h") return { help: true };
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "generate-weekly-governance-report.mjs",
    "",
    "Options:",
    "  --date <YYYY-MM-DD>      Report date folder (default: today)",
    "  --out-dir <path>         Output directory (default: governance_reports/<date>)",
    "  --shadow-limit <n>       Max tutor_guidance runs to export (default: 500)",
    "  --recovery-limit <n>     Max study_recovery runs to export (default: 500)",
    "  --include-text           Include text previews in the underlying exports",
    "  --allow-active           Include non-shadow adaptive traces in the shadow export step",
    "",
    "This command creates a dated governance report bundle with:",
    "  shadow_dataset.jsonl",
    "  shadow_summary.json",
    "  recovery_dataset.jsonl",
    "  recovery_summary.json",
    "  governance_report.json",
    "  disagreement_clusters.json",
    "  recovery_patterns.json",
    "  replay_digest.md",
    "  rollout_decision.md",
    "",
    "Example:",
    "  node scripts/generate-weekly-governance-report.mjs --date 2026-05-09 --shadow-limit 200 --recovery-limit 200",
  ].join("\n"));
  process.exit(0);
}

const reportDir = path.resolve(process.cwd(), args.outDir);
fs.mkdirSync(reportDir, { recursive: true });

const artifactPaths = {
  shadowDataset: path.join(reportDir, "shadow_dataset.jsonl"),
  shadowSummary: path.join(reportDir, "shadow_summary.json"),
  recoveryDataset: path.join(reportDir, "recovery_dataset.jsonl"),
  recoverySummary: path.join(reportDir, "recovery_summary.json"),
  governanceReport: path.join(reportDir, "governance_report.json"),
  reportStatus: path.join(reportDir, "report_status.json"),
  disagreementClusters: path.join(reportDir, "disagreement_clusters.json"),
  recoveryPatterns: path.join(reportDir, "recovery_patterns.json"),
  replayDigest: path.join(reportDir, "replay_digest.md"),
  rolloutDecision: path.join(reportDir, "rollout_decision.md"),
};

const shadowRun = runExport("adaptive shadow export", "export-adaptive-shadow-dataset.mjs", [
  "--out",
  artifactPaths.shadowDataset,
  "--summary-out",
  artifactPaths.shadowSummary,
  "--limit",
  String(args.shadowLimit),
  ...(args.includeText ? ["--include-text"] : []),
  ...(args.shadowOnly ? ["--shadow-only"] : []),
]);

const recoveryRun = runExport("tutoring recovery export", "export-tutoring-recovery-dataset.mjs", [
  "--out",
  artifactPaths.recoveryDataset,
  "--summary-out",
  artifactPaths.recoverySummary,
  "--limit",
  String(args.recoveryLimit),
  ...(args.includeText ? ["--include-text"] : []),
]);

const blockedReasons = [shadowRun, recoveryRun]
  .filter((result) => result.status === "blocked")
  .map((result) => result.reason);

const shadowSummary = shadowRun.status === "ok"
  ? readJson(artifactPaths.shadowSummary)
  : createBlockedSummary("shadow", shadowRun.reason);
const recoverySummary = recoveryRun.status === "ok"
  ? readJson(artifactPaths.recoverySummary)
  : createBlockedSummary("recovery", recoveryRun.reason);
const firstShadowExample = shadowRun.status === "ok" ? readFirstJsonLine(artifactPaths.shadowDataset) : null;

const governanceReport = {
  generatedAt: new Date().toISOString(),
  reportDate: args.date,
  reportStatus: blockedReasons.length ? "blocked_missing_reasoning_tables" : "ok",
  deploymentPosture: args.shadowOnly ? "shadow-only" : "mixed",
  policy: {
    policyVersion: firstShadowExample?.adaptive?.policy_version || null,
    selectedPolicyLabel: firstShadowExample?.adaptive?.selected_policy_label || null,
    scorerKind: firstShadowExample?.adaptive?.scorer_kind || null,
    blendWeight: firstShadowExample?.adaptive?.blend_weight ?? null,
    abstainThreshold: firstShadowExample?.adaptive?.abstain_threshold ?? null,
  },
  shadow: {
    totalExamples: shadowSummary.totalExamples || 0,
    disagreementRate: shadowSummary.disagreementRate || 0,
    abstentionRate: shadowSummary.abstentionRate || 0,
    overrideRate: shadowSummary.overrideRate || 0,
    abstentionShareOfDisagreements: shadowSummary.abstentionShareOfDisagreements || 0,
    scoreMargin: shadowSummary.scoreMargin || null,
    topShiftShare: shadowSummary.topShiftShare || 0,
    topStrategyShifts: (shadowSummary.topStrategyShifts || []).slice(0, 5),
    misconceptionSkew: shadowSummary.misconceptionSkew || null,
    strategySkew: shadowSummary.strategySkew || null,
    dataWarnings: shadowSummary.dataWarnings || [],
  },
  recovery: {
    totalExamples: recoverySummary.totalExamples || 0,
    recoveredCount: recoverySummary.recoveredCount || 0,
    stabilizedCount: recoverySummary.stabilizedCount || 0,
    averageReward: recoverySummary.averageReward || 0,
    averageConfidenceDelta: recoverySummary.averageConfidenceDelta || 0,
    classBalance: recoverySummary.classBalance || null,
    rewardDistribution: recoverySummary.rewardDistribution || null,
    confidenceDeltaDistribution: recoverySummary.confidenceDeltaDistribution || null,
    misconceptionSkew: recoverySummary.misconceptionSkew || null,
    strategyImbalance: recoverySummary.strategyImbalance || null,
    dataWarnings: recoverySummary.dataWarnings || [],
    byMisconception: (recoverySummary.byMisconception || []).slice(0, 5),
    byStrategy: (recoverySummary.byStrategy || []).slice(0, 5),
  },
  recommendedPosture: inferRecommendedPosture(shadowSummary, recoverySummary),
  blockedReasons,
  evidenceFiles: mapValues(artifactPaths, (value) => relativePath(value)),
};

const reportStatus = {
  generatedAt: governanceReport.generatedAt,
  reportDate: args.date,
  status: governanceReport.reportStatus,
  blockedReasons,
  guidance: blockedReasons.length
    ? "Apply the latest Prisma migrations or point the workspace at the database that already contains the reasoning schema, then rerun the weekly governance report generator."
    : "All report artifacts generated successfully.",
};

const disagreementClusters = {
  reportDate: args.date,
  topStrategyShifts: shadowSummary.topStrategyShifts || [],
  misconceptionBuckets: shadowSummary.misconceptionSkew?.entries || [],
  strategyBuckets: shadowSummary.strategySkew?.entries || [],
  warnings: shadowSummary.dataWarnings || [],
};

const recoveryPatterns = {
  reportDate: args.date,
  classBalance: recoverySummary.classBalance || null,
  averageReward: recoverySummary.averageReward || 0,
  averageConfidenceDelta: recoverySummary.averageConfidenceDelta || 0,
  misconceptionBuckets: recoverySummary.byMisconception || [],
  strategyBuckets: recoverySummary.byStrategy || [],
  warnings: recoverySummary.dataWarnings || [],
};

fs.writeFileSync(artifactPaths.governanceReport, `${JSON.stringify(governanceReport, null, 2)}\n`, "utf8");
fs.writeFileSync(artifactPaths.reportStatus, `${JSON.stringify(reportStatus, null, 2)}\n`, "utf8");
fs.writeFileSync(artifactPaths.disagreementClusters, `${JSON.stringify(disagreementClusters, null, 2)}\n`, "utf8");
fs.writeFileSync(artifactPaths.recoveryPatterns, `${JSON.stringify(recoveryPatterns, null, 2)}\n`, "utf8");
fs.writeFileSync(artifactPaths.replayDigest, buildReplayDigest(governanceReport), "utf8");
fs.writeFileSync(artifactPaths.rolloutDecision, buildRolloutDecision(governanceReport), "utf8");

console.log(`Generated weekly governance report bundle in ${relativePath(reportDir)}`);
for (const value of Object.values(artifactPaths)) {
  console.log(`- ${relativePath(value)}`);
}

function runExport(label, scriptName, exportArgs) {
  const scriptPath = path.resolve(process.cwd(), "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...exportArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (result.status === 0) {
    return { status: "ok", reason: null };
  }

  if (result.status === 2) {
    return {
      status: "blocked",
      reason: `${label} is blocked because the reasoning tables are missing in the current database.`,
    };
  }

  if (result.status !== 0) {
    console.error(`Failed during ${label}.`);
    process.exit(result.status || 1);
  }

  return { status: "ok", reason: null };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readFirstJsonLine(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return null;
  const firstLine = text.split(/\r?\n/, 1)[0];
  return JSON.parse(firstLine);
}

function inferRecommendedPosture(shadowSummary, recoverySummary) {
  if (shadowSummary.blocked || recoverySummary.blocked) {
    return "blocked_until_reasoning_schema_is_available";
  }

  const disagreementRate = Number(shadowSummary.disagreementRate || 0);
  const abstentionShare = Number(shadowSummary.abstentionShareOfDisagreements || 0);
  const topShiftShare = Number(shadowSummary.topShiftShare || 0);
  const stabilizationRate = Number(recoverySummary.classBalance?.stabilizationRate || 0);
  const warnings = [...(shadowSummary.dataWarnings || []), ...(recoverySummary.dataWarnings || [])];

  if (warnings.length || disagreementRate > 0.15 || abstentionShare < 0.35 || topShiftShare >= 0.75) {
    return "hold_shadow_mode";
  }
  if (stabilizationRate >= 0.55 && disagreementRate <= 0.05) {
    return "continue_shadow_collection_with_bounded_trial_review";
  }
  return "continue_shadow_collection";
}

function buildReplayDigest(report) {
  return [
    `# Replay Digest - ${report.reportDate}`,
    "",
    `Report status: ${report.reportStatus}`,
    ...(report.blockedReasons.length
      ? ["", "## Blockers", ...report.blockedReasons.map((item) => `- ${item}`)]
      : []),
    "",
    "## Policy",
    `- Policy version: ${report.policy.policyVersion || "unknown"}`,
    `- Selected policy label: ${report.policy.selectedPolicyLabel || "unknown"}`,
    `- Scorer kind: ${report.policy.scorerKind || "unknown"}`,
    `- Deployment posture: ${report.deploymentPosture}`,
    "",
    "## Shadow Summary",
    `- Total examples: ${report.shadow.totalExamples}`,
    `- Disagreement rate: ${report.shadow.disagreementRate}`,
    `- Abstention rate: ${report.shadow.abstentionRate}`,
    `- Override rate: ${report.shadow.overrideRate}`,
    `- Abstention share of disagreements: ${report.shadow.abstentionShareOfDisagreements}`,
    `- Mean top-two margin: ${report.shadow.scoreMargin?.mean ?? 0}`,
    "",
    "## Recovery Summary",
    `- Total examples: ${report.recovery.totalExamples}`,
    `- Recovery rate: ${report.recovery.classBalance?.recoveryRate ?? 0}`,
    `- Stabilization rate: ${report.recovery.classBalance?.stabilizationRate ?? 0}`,
    `- Average reward: ${report.recovery.averageReward}`,
    `- Average confidence delta: ${report.recovery.averageConfidenceDelta}`,
    "",
    "## Top Disagreement Shifts",
    ...(report.shadow.topStrategyShifts.length
      ? report.shadow.topStrategyShifts.map((shift) => `- ${shift.shift}: ${shift.count} (${shift.share})`)
      : ["- None recorded in this export slice."]),
    "",
    "## Warnings",
    ...formatList([...report.shadow.dataWarnings, ...report.recovery.dataWarnings], "No current warnings from export summaries."),
    "",
    "## Recommended Posture",
    `- ${report.recommendedPosture}`,
    "",
    "## Evidence Files",
    ...Object.entries(report.evidenceFiles).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ].join("\n");
}

function buildRolloutDecision(report) {
  return [
    `# Rollout Decision - ${report.reportDate}`,
    "",
    `Report status: ${report.reportStatus}`,
    `Date: ${report.reportDate}`,
    `Policy version: ${report.policy.policyVersion || "unknown"}`,
    `Selected policy label: ${report.policy.selectedPolicyLabel || "unknown"}`,
    `Deployment posture: ${report.deploymentPosture}`,
    `Recommended posture: ${report.recommendedPosture}`,
    "",
    "## Metrics",
    `- Disagreement rate: ${report.shadow.disagreementRate}`,
    `- Abstention rate: ${report.shadow.abstentionRate}`,
    `- Override rate: ${report.shadow.overrideRate}`,
    `- Recovery rate: ${report.recovery.classBalance?.recoveryRate ?? 0}`,
    `- Stabilization rate: ${report.recovery.classBalance?.stabilizationRate ?? 0}`,
    `- Average confidence delta: ${report.recovery.averageConfidenceDelta}`,
    "",
    "## Recovery Observations",
    "- Fill in the main recovery patterns observed from `recovery_patterns.json` and the student-facing recovery timeline.",
    "",
    "## Replay Observations",
    "- Fill in the main disagreement clusters and representative replay examples from `disagreement_clusters.json` and the replay console.",
    "",
    "## Drift Concerns",
    ...formatList([...report.blockedReasons, ...report.shadow.dataWarnings, ...report.recovery.dataWarnings], "None noted from current export summaries."),
    "",
    "## Decision",
    "- [ ] Hold shadow mode",
    "- [ ] Continue shadow collection",
    "- [ ] Tighten heuristics or thresholds",
    "- [ ] Investigate drift before any rollout change",
    "- [ ] Prepare bounded trial review package",
    "",
    "## Rollback Concerns",
    "- Document any reasons the system should remain fully heuristic-authoritative.",
    "",
    "## Owner",
    "- Fill in reviewer and sign-off owner.",
    "",
  ].join("\n");
}

function formatList(items, emptyLine) {
  if (!items.length) return [`- ${emptyLine}`];
  return items.map((item) => `- ${item}`);
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, fn(value)]));
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function createBlockedSummary(kind, reason) {
  return {
    blocked: true,
    kind,
    reason,
    totalExamples: 0,
    disagreementRate: 0,
    abstentionRate: 0,
    overrideRate: 0,
    abstentionShareOfDisagreements: 0,
    scoreMargin: { count: 0, min: 0, max: 0, mean: 0, p25: 0, p50: 0, p75: 0 },
    topShiftShare: 0,
    topStrategyShifts: [],
    misconceptionSkew: { uniqueCount: 0, top1Share: 0, top3Share: 0, entries: [] },
    strategySkew: { uniqueCount: 0, top1Share: 0, top3Share: 0, entries: [] },
    recoveredCount: 0,
    stabilizedCount: 0,
    averageReward: 0,
    averageConfidenceDelta: 0,
    classBalance: { recoveredCount: 0, stabilizedCount: 0, unrecoveredCount: 0, recoveryRate: 0, stabilizationRate: 0 },
    rewardDistribution: { count: 0, min: 0, max: 0, mean: 0, stddev: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, histogram: [] },
    confidenceDeltaDistribution: { count: 0, min: 0, max: 0, mean: 0, stddev: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, histogram: [] },
    strategyImbalance: { uniqueCount: 0, top1Share: 0, top3Share: 0, entries: [] },
    byMisconception: [],
    byStrategy: [],
    dataWarnings: [reason],
  };
}