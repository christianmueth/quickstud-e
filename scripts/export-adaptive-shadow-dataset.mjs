/*
Usage:
  node scripts/export-adaptive-shadow-dataset.mjs
  node scripts/export-adaptive-shadow-dataset.mjs --out tmp/adaptive-shadow.jsonl --summary-out tmp/adaptive-shadow.summary.json --limit 500 --include-text

What it exports:
  - One JSONL example per persisted `tutor_guidance` run that contains adaptive-policy telemetry.
  - Each example captures real shadow traces including:
      state     -> misconception and weak-topic context, verification confidence, student-state snapshot
      heuristic -> heuristic-selected strategy id and score
      adaptive  -> adaptive-selected strategy id, disagreement, abstention, override eligibility
      candidates -> candidate-local feature vectors and blended score trace
      context   -> prompt/title/origin plus replay-facing explanation fields

This is intended to create a durable real-traffic dataset for shadow analysis before any authority expansion.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    out: "tmp/real-shadow-dataset-v1.jsonl",
    summaryOut: "tmp/real-shadow-dataset-v1.summary.json",
    limit: 1000,
    includeText: false,
    shadowOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" && argv[index + 1]) out.out = argv[++index];
    else if (arg === "--summary-out" && argv[index + 1]) out.summaryOut = argv[++index];
    else if (arg === "--limit" && argv[index + 1]) out.limit = Number(argv[++index]) || out.limit;
    else if (arg === "--include-text") out.includeText = true;
    else if (arg === "--shadow-only") out.shadowOnly = true;
    else if (arg === "--help" || arg === "-h") return { help: true };
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "export-adaptive-shadow-dataset.mjs",
    "",
    "Options:",
    "  --out <path>           JSONL output file (default: tmp/real-shadow-dataset-v1.jsonl)",
    "  --summary-out <path>   Summary JSON output file (default: tmp/real-shadow-dataset-v1.summary.json)",
    "  --limit <n>            Max tutor_guidance runs to export (default: 1000)",
    "  --include-text         Include prompt and reasoning previews in each example",
    "  --shadow-only          Export only runs where adaptivePolicy.mode=shadow",
    "",
    "The summary file includes disagreement, abstention, score-margin, misconception concentration, and strategy concentration statistics.",
    "",
    "Example:",
    "  node scripts/export-adaptive-shadow-dataset.mjs --out tmp/adaptive-shadow.jsonl --limit 500 --include-text",
  ].join("\n"));
  process.exit(0);
}

const outPath = path.resolve(process.cwd(), args.out);
const summaryPath = path.resolve(process.cwd(), args.summaryOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });

try {
  const runs = await prisma.reasoningRun.findMany({
    where: {
      mode: "tutor_guidance",
      metadata: {
        path: ["adaptivePolicy", "mode"],
        not: PrismaJsonNull(),
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100000, Math.floor(args.limit))),
    select: {
      id: true,
      userId: true,
      deckId: true,
      origin: true,
      title: true,
      prompt: true,
      confidence: true,
      trajectoryScore: true,
      reasoning: true,
      finalAnswer: true,
      metadata: true,
      createdAt: true,
    },
  });

  const examples = runs
    .map((run) => toDatasetExample(run, { includeText: args.includeText }))
    .filter(Boolean)
    .filter((example) => !args.shadowOnly || example.adaptive.mode === "shadow");

  const jsonl = examples.map((example) => JSON.stringify(example)).join("\n");
  fs.writeFileSync(outPath, jsonl ? `${jsonl}\n` : "", "utf8");

  const summary = buildSummary(examples);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Exported ${examples.length} adaptive shadow examples`);
  console.log(`JSONL:   ${path.relative(process.cwd(), outPath)}`);
  console.log(`Summary: ${path.relative(process.cwd(), summaryPath)}`);
  console.log(`Disagreement rate: ${summary.disagreementRate}`);
  console.log(`Abstention rate: ${summary.abstentionRate}`);
  console.log(`Override rate: ${summary.overrideRate}`);
  console.log(`Avg top-2 margin: ${summary.scoreMargin.mean}`);
  if (summary.dataWarnings.length) {
    console.log("Warnings:");
    for (const warning of summary.dataWarnings) console.log(`- ${warning}`);
  }
  if (examples[0]) {
    console.log("Sample:");
    console.log(JSON.stringify(examples[0], null, 2));
  }
} catch (error) {
  if (isMissingReasoningTable(error)) {
    console.error("Adaptive shadow export is not available yet because the reasoning tables have not been created in the current database.");
    console.error("Apply the latest Prisma migrations before exporting adaptive shadow traces.");
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}

function toDatasetExample(run, options) {
  const metadata = toRecord(run.metadata);
  const adaptivePolicy = toRecord(metadata.adaptivePolicy);
  const verification = toRecord(metadata.verification);
  const studentState = toRecord(metadata.studentState);
  const worldModel = toRecord(metadata.worldModel);
  const selectedTransition = toRecord(worldModel.selectedTransition);
  const candidateScores = toArray(adaptivePolicy.candidateScores).map(toRecord);
  const selectedCandidates = toArray(metadata.selectedStrategy).length ? toArray(metadata.selectedStrategy) : [];

  if (!adaptivePolicy.mode || !candidateScores.length) return null;

  const candidates = candidateScores.map((candidate) => {
    const strategyId = toString(candidate.strategyId);
    return {
      strategy_id: strategyId,
      heuristic_score: toNumber(candidate.heuristicScore),
      artifact_value_score: toNumber(candidate.artifactValueScore),
      blended_score: toNumber(candidate.blendedScore),
      heuristic_selected: toBoolean(candidate.heuristicSelected),
      adaptive_selected: toBoolean(candidate.adaptiveSelected),
    };
  });

  const topTwoMargin = candidateMargin(candidates);

  return {
    example_id: run.id,
    created_at: run.createdAt.toISOString(),
    user_id: run.userId,
    deck_id: run.deckId,
    state: {
      misconception_signals: toStringArray(metadata.misconceptionSignals),
      weak_topic_matches: toStringArray(metadata.weakTopicMatches),
      verification_confidence: toNumber(verification.confidence),
      world_model: {
        version: toNullableString(worldModel.version),
        projected_confidence_delta: toNumber(selectedTransition.projectedConfidenceDelta),
        projected_recovery_probability: toNumber(selectedTransition.projectedRecoveryProbability),
        projected_stability_gain: toNumber(selectedTransition.projectedStabilityGain),
        projected_low_confidence_risk: toNumber(selectedTransition.projectedLowConfidenceRisk),
        projected_next_weak_topics: toStringArray(selectedTransition.projectedNextWeakTopics),
        projected_next_misconceptions: toStringArray(selectedTransition.projectedNextMisconceptions),
        explanation: toNullableString(selectedTransition.explanation),
      },
      student_state: {
        weak_concepts: toStringArray(studentState.weakConcepts),
        misconception_patterns: toStringArray(studentState.misconceptionPatterns),
        confidence_profile: toRecord(studentState.confidenceProfile),
        retention_profile: toRecord(studentState.retentionProfile),
        pacing_profile: toRecord(studentState.pacingProfile),
        preferred_explanation_style: toNullableString(studentState.preferredExplanationStyle),
        recent_failures: toStringArray(studentState.recentFailures),
        recent_successes: toStringArray(studentState.recentSuccesses),
      },
    },
    heuristic: {
      selected_strategy_id: toString(adaptivePolicy.heuristicSelectedStrategyId),
      selected_score: scoreForStrategy(candidates, toString(adaptivePolicy.heuristicSelectedStrategyId), "heuristic_score"),
    },
    adaptive: {
      mode: toString(adaptivePolicy.mode),
      policy_version: toString(adaptivePolicy.policyVersion),
      selected_policy_label: toString(adaptivePolicy.selectedPolicyLabel),
      scorer_kind: toString(adaptivePolicy.scorerKind),
      blend_weight: toNumber(adaptivePolicy.blendWeight),
      abstain_threshold: toNumber(adaptivePolicy.abstainThreshold),
      adaptive_selected_strategy_id: toString(adaptivePolicy.adaptiveSelectedStrategyId),
      effective_selected_strategy_id: toString(adaptivePolicy.effectiveSelectedStrategyId),
      disagreement: toBoolean(adaptivePolicy.disagreement),
      abstained: toBoolean(adaptivePolicy.abstained),
      override_applied: toBoolean(adaptivePolicy.overrideApplied),
      heuristic_vs_adaptive_delta: round3(
        scoreForStrategy(candidates, toString(adaptivePolicy.adaptiveSelectedStrategyId), "blended_score") -
        scoreForStrategy(candidates, toString(adaptivePolicy.heuristicSelectedStrategyId), "blended_score")
      ),
      top_two_margin: topTwoMargin,
    },
    candidates,
    context: {
      origin: toNullableString(run.origin),
      title: toNullableString(run.title),
      final_answer: options.includeText ? truncate(run.finalAnswer) : null,
      reasoning: options.includeText ? truncate(run.reasoning, 600) : null,
      prompt: options.includeText ? truncate(run.prompt, 600) : null,
      trajectory_score: toNumber(run.trajectoryScore),
      run_confidence: toNumber(run.confidence),
      replay_explanation: buildReplayExplanation(adaptivePolicy, topTwoMargin),
      selected_strategy_payload_present: selectedCandidates.length > 0,
    },
  };
}

function buildSummary(examples) {
  const disagreementCount = examples.filter((example) => example.adaptive.disagreement).length;
  const abstentionCount = examples.filter((example) => example.adaptive.abstained).length;
  const overrideCount = examples.filter((example) => example.adaptive.override_applied).length;
  const margins = examples.map((example) => example.adaptive.top_two_margin);
  const worldModelRecovery = examples.map((example) => example.state.world_model.projected_recovery_probability);
  const worldModelStability = examples.map((example) => example.state.world_model.projected_stability_gain);
  const byMisconception = new Map();
  const byEffectiveStrategy = new Map();
  const byShift = new Map();

  for (const example of examples) {
    for (const category of example.state.misconception_signals) {
      byMisconception.set(category, (byMisconception.get(category) || 0) + 1);
    }

    const effectiveStrategy = example.adaptive.effective_selected_strategy_id || "unknown";
    byEffectiveStrategy.set(effectiveStrategy, (byEffectiveStrategy.get(effectiveStrategy) || 0) + 1);

    if (example.adaptive.disagreement) {
      const shiftKey = `${example.heuristic.selected_strategy_id}=>${example.adaptive.adaptive_selected_strategy_id}`;
      byShift.set(shiftKey, (byShift.get(shiftKey) || 0) + 1);
    }
  }

  const misconceptionSkew = summarizeSkew(byMisconception, examples.length);
  const strategySkew = summarizeSkew(byEffectiveStrategy, examples.length);
  const topShiftShare = disagreementCount
    ? round3(Math.max(0, ...byShift.values()) / disagreementCount)
    : 0;

  return {
    exportedAt: new Date().toISOString(),
    totalExamples: examples.length,
    disagreementCount,
    abstentionCount,
    overrideCount,
    disagreementRate: rate(disagreementCount, examples.length),
    abstentionRate: rate(abstentionCount, examples.length),
    overrideRate: rate(overrideCount, examples.length),
    abstentionShareOfDisagreements: disagreementCount ? round3(abstentionCount / disagreementCount) : 0,
    scoreMargin: summarizeNumericDistribution(margins),
    worldModelRecovery: summarizeNumericDistribution(worldModelRecovery),
    worldModelStability: summarizeNumericDistribution(worldModelStability),
    misconceptionSkew,
    strategySkew,
    topShiftShare,
    topStrategyShifts: [...byShift.entries()]
      .map(([shift, count]) => ({ shift, count, share: disagreementCount ? round3(count / disagreementCount) : 0 }))
      .sort((left, right) => right.count - left.count || left.shift.localeCompare(right.shift))
      .slice(0, 10),
    dataWarnings: buildWarnings({
      totalExamples: examples.length,
      disagreementRate: rate(disagreementCount, examples.length),
      abstentionShareOfDisagreements: disagreementCount ? round3(abstentionCount / disagreementCount) : 0,
      scoreMargin: summarizeNumericDistribution(margins),
      misconceptionSkew,
      strategySkew,
      topShiftShare,
      worldModelRecovery: summarizeNumericDistribution(worldModelRecovery),
    }),
  };
}

function buildReplayExplanation(adaptivePolicy, topTwoMargin) {
  if (toBoolean(adaptivePolicy.overrideApplied)) {
    return `Adaptive override applied after disagreement; top-two blended-score margin ${round3(topTwoMargin)}.`;
  }
  if (toBoolean(adaptivePolicy.disagreement) && toBoolean(adaptivePolicy.abstained)) {
    return `Adaptive scorer disagreed but abstained under threshold; top-two blended-score margin ${round3(topTwoMargin)}.`;
  }
  if (toBoolean(adaptivePolicy.disagreement)) {
    return `Adaptive scorer disagreed with the heuristic path; top-two blended-score margin ${round3(topTwoMargin)}.`;
  }
  return `Adaptive scorer agreed with the heuristic selection; top-two blended-score margin ${round3(topTwoMargin)}.`;
}

function candidateMargin(candidates) {
  if (candidates.length < 2) return 0;
  const sorted = [...candidates].sort((left, right) => right.blended_score - left.blended_score);
  return round3(sorted[0].blended_score - sorted[1].blended_score);
}

function scoreForStrategy(candidates, strategyId, key) {
  const candidate = candidates.find((item) => item.strategy_id === strategyId);
  return candidate ? toNumber(candidate[key]) : 0;
}

function summarizeNumericDistribution(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) {
    return { count: 0, min: 0, max: 0, mean: 0, p25: 0, p50: 0, p75: 0 };
  }

  return {
    count: nums.length,
    min: round3(nums[0]),
    max: round3(nums[nums.length - 1]),
    mean: average(nums),
    p25: quantile(nums, 0.25),
    p50: quantile(nums, 0.5),
    p75: quantile(nums, 0.75),
  };
}

function summarizeSkew(countMap, totalExamples) {
  const entries = [...countMap.entries()]
    .map(([label, count]) => ({ label, count, share: rate(count, totalExamples) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    uniqueCount: entries.length,
    top1Share: entries[0]?.share || 0,
    top3Share: round3(entries.slice(0, 3).reduce((sum, entry) => sum + entry.share, 0)),
    entries: entries.slice(0, 10),
  };
}

function buildWarnings({ totalExamples, disagreementRate, abstentionShareOfDisagreements, scoreMargin, misconceptionSkew, strategySkew, topShiftShare, worldModelRecovery }) {
  const warnings = [];
  if (totalExamples < 50) warnings.push(`Shadow sample is small (${totalExamples} examples); disagreement geometry may still be unstable.`);
  if (disagreementRate > 0.15) warnings.push(`Disagreement rate is elevated at ${disagreementRate}; inspect replay before granting authority.`);
  if (abstentionShareOfDisagreements < 0.35) warnings.push(`Abstention share is low at ${abstentionShareOfDisagreements}; calibration drift may be present.`);
  if (scoreMargin.mean < 0.015) warnings.push(`Candidate-score margin is compressed (mean ${scoreMargin.mean}); real candidate separability may be weak.`);
  if (misconceptionSkew.top1Share >= 0.6) warnings.push(`Misconception concentration is high (top bucket ${misconceptionSkew.top1Share}).`);
  if (strategySkew.top1Share >= 0.7) warnings.push(`Effective strategy concentration is high (top strategy ${strategySkew.top1Share}).`);
  if (topShiftShare >= 0.75) warnings.push(`One disagreement shift dominates (${topShiftShare}); inspect for local pathology.`);
  if (worldModelRecovery.mean === 0) warnings.push("World-model recovery projections are missing from adaptive shadow exports.");
  return warnings;
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return 0;
  return round3(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round3(sortedValues[lower]);
  const weight = index - lower;
  return round3(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight);
}

function rate(numerator, denominator) {
  return denominator > 0 ? round3(numerator / denominator) : 0;
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toString(value) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toBoolean(value) {
  return value === true;
}

function truncate(value, max = 400) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isMissingReasoningTable(error) {
  return !!(
    error &&
    typeof error === "object" &&
    (error.code === "P2021" || /ReasoningRun|table .* does not exist|relation .* does not exist/i.test(String(error.message || "")))
  );
}

function PrismaJsonNull() {
  return null;
}