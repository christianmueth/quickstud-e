import fs from "node:fs";
import path from "node:path";

export type GovernanceReportSummary = {
  reportDate: string;
  generatedAt: string;
  reportStatus: string;
  deploymentPosture: string;
  recommendedPosture: string;
  blockedReasons: string[];
  policy: {
    policyVersion: string | null;
    selectedPolicyLabel: string | null;
    scorerKind: string | null;
    blendWeight: number | null;
    abstainThreshold: number | null;
  };
  shadow: {
    totalExamples: number;
    disagreementRate: number;
    abstentionRate: number;
    overrideRate: number;
    dataWarnings: string[];
  };
  recovery: {
    totalExamples: number;
    recoveredCount: number;
    stabilizedCount: number;
    averageConfidenceDelta: number;
    classBalance: {
      recoveryRate: number;
      stabilizationRate: number;
    } | null;
    dataWarnings: string[];
  };
  artifactPaths: {
    governanceReport: string;
    replayDigest: string;
    rolloutDecision: string;
    reportStatus: string;
  };
};

export function getLatestGovernanceReport(): GovernanceReportSummary | null {
  const reportsRoot = path.resolve(process.cwd(), "governance_reports");
  if (!fs.existsSync(reportsRoot)) return null;

  const reportFolders = fs.readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const folder of reportFolders) {
    const reportPath = path.join(reportsRoot, folder, "governance_report.json");
    if (!fs.existsSync(reportPath)) continue;

    const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return {
      reportDate: String(raw.reportDate || folder),
      generatedAt: String(raw.generatedAt || ""),
      reportStatus: String(raw.reportStatus || "unknown"),
      deploymentPosture: String(raw.deploymentPosture || "unknown"),
      recommendedPosture: String(raw.recommendedPosture || "unknown"),
      blockedReasons: toStringArray(raw.blockedReasons),
      policy: {
        policyVersion: toNullableString(raw.policy?.policyVersion),
        selectedPolicyLabel: toNullableString(raw.policy?.selectedPolicyLabel),
        scorerKind: toNullableString(raw.policy?.scorerKind),
        blendWeight: toNullableNumber(raw.policy?.blendWeight),
        abstainThreshold: toNullableNumber(raw.policy?.abstainThreshold),
      },
      shadow: {
        totalExamples: toNumber(raw.shadow?.totalExamples),
        disagreementRate: toNumber(raw.shadow?.disagreementRate),
        abstentionRate: toNumber(raw.shadow?.abstentionRate),
        overrideRate: toNumber(raw.shadow?.overrideRate),
        dataWarnings: toStringArray(raw.shadow?.dataWarnings),
      },
      recovery: {
        totalExamples: toNumber(raw.recovery?.totalExamples),
        recoveredCount: toNumber(raw.recovery?.recoveredCount),
        stabilizedCount: toNumber(raw.recovery?.stabilizedCount),
        averageConfidenceDelta: toNumber(raw.recovery?.averageConfidenceDelta),
        classBalance: raw.recovery?.classBalance
          ? {
              recoveryRate: toNumber(raw.recovery.classBalance.recoveryRate),
              stabilizationRate: toNumber(raw.recovery.classBalance.stabilizationRate),
            }
          : null,
        dataWarnings: toStringArray(raw.recovery?.dataWarnings),
      },
      artifactPaths: {
        governanceReport: toRelativeArtifactPath(raw.evidenceFiles?.governanceReport, folder, "governance_report.json"),
        replayDigest: toRelativeArtifactPath(raw.evidenceFiles?.replayDigest, folder, "replay_digest.md"),
        rolloutDecision: toRelativeArtifactPath(raw.evidenceFiles?.rolloutDecision, folder, "rollout_decision.md"),
        reportStatus: toRelativeArtifactPath(raw.evidenceFiles?.reportStatus, folder, "report_status.json"),
      },
    };
  }

  return null;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toRelativeArtifactPath(value: unknown, folder: string, fallbackFile: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.replace(/\\/g, "/");
  return `governance_reports/${folder}/${fallbackFile}`;
}