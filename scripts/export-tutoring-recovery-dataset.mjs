/*
Usage:
  node scripts/export-tutoring-recovery-dataset.mjs
  node scripts/export-tutoring-recovery-dataset.mjs --out tmp/recovery-value-dataset.jsonl --limit 500

What it exports:
  - One JSONL example per persisted `study_recovery` reasoning run.
  - Each example contains:
      state   -> student snapshot, misconception signals, prior confidence, weak topics
      action  -> selected tutoring strategy
      target  -> recovered/stabilized/confidence delta/reward proxy
      context -> prompt/answer previews and run metadata

This is intended as the first LightZero/MuZero bridge: a supervised tutoring recovery value dataset.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    out: "tmp/tutoring-recovery-value-dataset.jsonl",
    summaryOut: "tmp/tutoring-recovery-value-dataset.summary.json",
    limit: 1000,
    includeText: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out.out = argv[++i];
    else if (arg === "--summary-out" && argv[i + 1]) out.summaryOut = argv[++i];
    else if (arg === "--limit" && argv[i + 1]) out.limit = Number(argv[++i]) || out.limit;
    else if (arg === "--include-text") out.includeText = true;
    else if (arg === "--help" || arg === "-h") return { help: true };
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log([
    "export-tutoring-recovery-dataset.mjs",
    "",
    "Options:",
    "  --out <path>          JSONL output file (default: tmp/tutoring-recovery-value-dataset.jsonl)",
    "  --summary-out <path>  Summary JSON output file (default: tmp/tutoring-recovery-value-dataset.summary.json)",
    "  --limit <n>           Max study_recovery runs to export (default: 1000)",
    "  --include-text        Include prompt and answer previews in each example",
    "",
    "The summary file includes class balance, reward distribution, confidence-delta spread, misconception skew, and strategy imbalance.",
    "",
    "Example:",
    "  node scripts/export-tutoring-recovery-dataset.mjs --out tmp/recovery.jsonl --limit 500",
  ].join("\n"));
  process.exit(0);
}

const outPath = path.resolve(process.cwd(), args.out);
const summaryPath = path.resolve(process.cwd(), args.summaryOut);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });

try {
  const runs = await prisma.reasoningRun.findMany({
    where: { mode: "study_recovery" },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100000, Math.floor(args.limit))),
    select: {
      id: true,
      userId: true,
      deckId: true,
      mode: true,
      origin: true,
      title: true,
      prompt: true,
      confidence: true,
      trajectoryScore: true,
      metadata: true,
      createdAt: true,
    },
  });

  const examples = runs.map((run) => toDatasetExample(run, { includeText: args.includeText })).filter(Boolean);
  const jsonl = examples.map((example) => JSON.stringify(example)).join("\n");
  fs.writeFileSync(outPath, jsonl ? `${jsonl}\n` : "", "utf8");

  const summary = buildSummary(examples);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`Exported ${examples.length} recovery examples`);
  console.log(`JSONL:   ${path.relative(process.cwd(), outPath)}`);
  console.log(`Summary: ${path.relative(process.cwd(), summaryPath)}`);
  console.log(`Recovered: ${summary.classBalance.recoveredCount}/${summary.totalExamples} (${summary.classBalance.recoveryRate})`);
  console.log(`Stabilized: ${summary.classBalance.stabilizedCount}/${summary.totalExamples} (${summary.classBalance.stabilizationRate})`);
  console.log(`Reward mean/p50: ${summary.rewardDistribution.mean} / ${summary.rewardDistribution.p50}`);
  console.log(`Confidence delta mean/p50: ${summary.confidenceDeltaDistribution.mean} / ${summary.confidenceDeltaDistribution.p50}`);
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
    console.error("Reasoning recovery export is not available yet because the reasoning tables have not been created in the current database.");
    console.error("Apply the latest Prisma migrations before exporting tutoring recovery data.");
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}

function toDatasetExample(run, options) {
  const metadata = toRecord(run.metadata);
  const selectedStrategy = toRecord(metadata.selectedStrategy);
  const verification = toRecord(metadata.verification);
  const studentState = toRecord(metadata.studentState);
  const longitudinalState = toRecord(metadata.longitudinalState);
  const worldModel = toRecord(metadata.worldModel);
  const selectedTransition = toRecord(worldModel.selectedTransition);
  const misconceptionSignals = toStringArray(metadata.misconceptionSignals);
  const weakTopicMatches = toStringArray(metadata.weakTopicMatches);
  const priorConfidence = toNumber(metadata.priorConfidence);
  const postReviewConfidence = toNumber(metadata.postReviewConfidence);
  const confidenceDelta = toNumber(metadata.confidenceDelta);
  const recovered = toBoolean(metadata.recovered);
  const stabilized = toBoolean(metadata.stabilized);

  return {
    example_id: run.id,
    created_at: run.createdAt.toISOString(),
    user_id: run.userId,
    deck_id: run.deckId,
    state: {
      misconception_signals: misconceptionSignals,
      weak_topic_matches: weakTopicMatches,
      prior_confidence: priorConfidence,
      verification_confidence: toNumber(verification.confidence),
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
      longitudinal_state: {
        confidence_volatility: toNumber(longitudinalState.confidenceVolatility),
        frustration_level: toNumber(longitudinalState.frustrationLevel),
        misconception_persistence: toNumber(longitudinalState.misconceptionPersistence),
        prior_recovery_rate: toNumber(longitudinalState.priorRecoveryRate),
        recent_strategy_success_rate: toNumber(longitudinalState.recentStrategySuccessRate),
        recent_strategy_counts: toRecord(longitudinalState.recentStrategyCounts),
      },
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
    },
    action: {
      strategy_label: toNullableString(selectedStrategy.label),
      strategy_type: toNullableString(selectedStrategy.strategyType),
      strategy_confidence: toNumber(selectedStrategy.confidence),
      strategy_score: toNumber(selectedStrategy.score),
      strategy_hint: options.includeText ? toNullableString(selectedStrategy.hint) : null,
    },
    target: {
      recovered,
      stabilized,
      prior_confidence: priorConfidence,
      post_review_confidence: postReviewConfidence,
      confidence_delta: confidenceDelta,
      reward: computeReward({ recovered, stabilized, confidenceDelta, rating: toNullableString(metadata.rating) }),
    },
    context: {
      rating: toNullableString(metadata.rating),
      origin: run.origin,
      prompt: options.includeText ? truncate(run.prompt) : null,
      student_answer: options.includeText ? truncate(metadata.studentAnswer) : null,
      expected_answer: options.includeText ? truncate(metadata.expectedAnswer) : null,
      reasoning_confidence: toNumber(run.confidence),
      trajectory_score: toNumber(run.trajectoryScore),
    },
  };
}

function buildSummary(examples) {
  const byMisconception = new Map();
  const byStrategy = new Map();
  const rewards = [];
  const confidenceDeltas = [];
  const worldModelRecoveryProbabilities = [];
  const worldModelStabilityGains = [];
  let unlabeledExamples = 0;

  for (const example of examples) {
    rewards.push(example.target.reward);
    confidenceDeltas.push(example.target.confidence_delta);
    worldModelRecoveryProbabilities.push(example.state.world_model.projected_recovery_probability);
    worldModelStabilityGains.push(example.state.world_model.projected_stability_gain);
    if (!example.state.misconception_signals.length) unlabeledExamples += 1;

    for (const category of example.state.misconception_signals) {
      const bucket = byMisconception.get(category) || { examples: 0, recovered: 0, stabilized: 0, rewardSum: 0, confidenceDeltaSum: 0 };
      bucket.examples += 1;
      bucket.recovered += example.target.recovered ? 1 : 0;
      bucket.stabilized += example.target.stabilized ? 1 : 0;
      bucket.rewardSum += example.target.reward;
      bucket.confidenceDeltaSum += example.target.confidence_delta;
      byMisconception.set(category, bucket);
    }

    const strategyKey = example.action.strategy_type || example.action.strategy_label || "unknown";
    const strategyBucket = byStrategy.get(strategyKey) || { examples: 0, recovered: 0, rewardSum: 0 };
    strategyBucket.examples += 1;
    strategyBucket.recovered += example.target.recovered ? 1 : 0;
    strategyBucket.rewardSum += example.target.reward;
    byStrategy.set(strategyKey, strategyBucket);
  }

  const recoveredCount = examples.filter((example) => example.target.recovered).length;
  const stabilizedCount = examples.filter((example) => example.target.stabilized).length;
  const classBalance = {
    recoveredCount,
    stabilizedCount,
    unrecoveredCount: examples.length - recoveredCount,
    recoveryRate: rate(recoveredCount, examples.length),
    stabilizationRate: rate(stabilizedCount, examples.length),
  };

  const rewardDistribution = summarizeNumericDistribution(rewards);
  const confidenceDeltaDistribution = summarizeNumericDistribution(confidenceDeltas);
  const worldModelRecoveryDistribution = summarizeNumericDistribution(worldModelRecoveryProbabilities);
  const worldModelStabilityDistribution = summarizeNumericDistribution(worldModelStabilityGains);
  const misconceptionSkew = summarizeSkew(byMisconception, examples.length);
  const strategyImbalance = summarizeSkew(byStrategy, examples.length);
  const dataWarnings = buildWarnings({
    totalExamples: examples.length,
    classBalance,
    rewardDistribution,
    confidenceDeltaDistribution,
    worldModelRecoveryDistribution,
    misconceptionSkew,
    strategyImbalance,
    unlabeledRate: rate(unlabeledExamples, examples.length),
  });

  return {
    exportedAt: new Date().toISOString(),
    totalExamples: examples.length,
    recoveredCount,
    stabilizedCount,
    averageReward: average(examples.map((example) => example.target.reward)),
    averageConfidenceDelta: average(examples.map((example) => example.target.confidence_delta)),
    classBalance,
    rewardDistribution,
    confidenceDeltaDistribution,
    worldModelRecoveryDistribution,
    worldModelStabilityDistribution,
    misconceptionSkew,
    strategyImbalance,
    dataWarnings,
    byMisconception: [...byMisconception.entries()].map(([category, bucket]) => ({
      category,
      examples: bucket.examples,
      recoveryRate: rate(bucket.recovered, bucket.examples),
      stabilizationRate: rate(bucket.stabilized, bucket.examples),
      averageReward: round3(bucket.rewardSum / Math.max(1, bucket.examples)),
      averageConfidenceDelta: round3(bucket.confidenceDeltaSum / Math.max(1, bucket.examples)),
    })).sort((left, right) => right.examples - left.examples || left.category.localeCompare(right.category)),
    byStrategy: [...byStrategy.entries()].map(([strategy, bucket]) => ({
      strategy,
      examples: bucket.examples,
      recoveryRate: rate(bucket.recovered, bucket.examples),
      averageReward: round3(bucket.rewardSum / Math.max(1, bucket.examples)),
    })).sort((left, right) => right.examples - left.examples || left.strategy.localeCompare(right.strategy)),
  };
}

function summarizeNumericDistribution(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) {
    return { count: 0, min: 0, max: 0, mean: 0, stddev: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, histogram: [] };
  }

  return {
    count: nums.length,
    min: round3(nums[0]),
    max: round3(nums[nums.length - 1]),
    mean: average(nums),
    stddev: round3(stddev(nums)),
    p10: quantile(nums, 0.1),
    p25: quantile(nums, 0.25),
    p50: quantile(nums, 0.5),
    p75: quantile(nums, 0.75),
    p90: quantile(nums, 0.9),
    histogram: histogram(nums, 8),
  };
}

function summarizeSkew(countMap, totalExamples) {
  const entries = [...countMap.entries()]
    .map(([label, bucket]) => ({
      label,
      count: typeof bucket === "number" ? bucket : bucket.examples,
      share: rate(typeof bucket === "number" ? bucket : bucket.examples, totalExamples),
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return {
    uniqueCount: entries.length,
    top1Share: entries[0]?.share || 0,
    top3Share: round3(entries.slice(0, 3).reduce((sum, entry) => sum + entry.share, 0)),
    entries: entries.slice(0, 10),
  };
}

function buildWarnings({ totalExamples, classBalance, rewardDistribution, confidenceDeltaDistribution, worldModelRecoveryDistribution, misconceptionSkew, strategyImbalance, unlabeledRate }) {
  const warnings = [];
  if (totalExamples < 50) warnings.push(`Dataset is small (${totalExamples} examples); baseline results may be unstable.`);
  if (classBalance.recoveryRate <= 0.15 || classBalance.recoveryRate >= 0.85) {
    warnings.push(`Recovery class balance is skewed (${classBalance.recoveryRate}); consider class weighting or stratified sampling.`);
  }
  if (confidenceDeltaDistribution.stddev < 0.05) {
    warnings.push(`Confidence delta spread is narrow (stddev ${confidenceDeltaDistribution.stddev}); the value target may be weak.`);
  }
  if (rewardDistribution.p90 === rewardDistribution.p10) {
    warnings.push("Reward distribution is nearly collapsed; inspect reward shaping before training.");
  }
  if (misconceptionSkew.top1Share >= 0.6) {
    warnings.push(`Misconception skew is high (top category share ${misconceptionSkew.top1Share}).`);
  }
  if (strategyImbalance.top1Share >= 0.6) {
    warnings.push(`Strategy imbalance is high (top strategy share ${strategyImbalance.top1Share}).`);
  }
  if (unlabeledRate >= 0.3) {
    warnings.push(`Many examples lack misconception labels (${unlabeledRate}); classifier coverage may need improvement.`);
  }
  if (worldModelRecoveryDistribution.mean === 0) {
    warnings.push("World-model recovery projections are missing from the exported recovery dataset.");
  }
  return warnings;
}

function computeReward({ recovered, stabilized, confidenceDelta, rating }) {
  const base = recovered ? 1 : -1;
  const stabilizationBonus = stabilized ? 0.5 : 0;
  const ratingBonus = rating === "easy" ? 0.25 : rating === "good" ? 0.1 : -0.1;
  return round3(base + stabilizationBonus + confidenceDelta + ratingBonus);
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return 0;
  return round3(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function stddev(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (nums.length <= 1) return 0;
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
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

function histogram(sortedValues, buckets) {
  if (!sortedValues.length) return [];
  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];
  if (min === max) {
    return [{ start: round3(min), end: round3(max), count: sortedValues.length }];
  }
  const width = (max - min) / buckets;
  const counts = Array.from({ length: buckets }, () => 0);
  for (const value of sortedValues) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.max(0, Math.min(buckets - 1, rawIndex));
    counts[index] += 1;
  }
  return counts.map((count, index) => ({
    start: round3(min + width * index),
    end: round3(index === buckets - 1 ? max : min + width * (index + 1)),
    count,
  }));
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

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toBoolean(value) {
  return value === true;
}

function toNullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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