/*
Usage:
  node scripts/train-lightzero-world-model-artifact.mjs
  node scripts/train-lightzero-world-model-artifact.mjs --limit 1000 --epochs 900

What it does:
  - Loads synthetic `study_recovery` runs from the reasoning replay tables.
  - Expands them into candidate-level supervised examples.
  - Fits four linear value heads compatible with the live LightZero world-model loader.
  - Writes a deployable JSON artifact into the repo.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FEATURE_NAMES = [
  "strategyConfidence",
  "priorLocalSuccessRate",
  "misconceptionAlignment",
  "noveltyScore",
  "lowCognitiveLoad",
  "hintGranularity",
  "overallConfidence",
  "retentionStrength",
  "lowConfidenceRisk",
  "verificationConfidence",
  "weakTopicCount",
  "misconceptionCount",
];

function parseArgs(argv) {
  const out = {
    out: "lib/reasoningEngine/artifacts/lightzeroWorldModelArtifact.json",
    limit: 1000,
    epochs: 1200,
    learningRate: 0.04,
    l2: 0.0015,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" && argv[index + 1]) out.out = argv[++index];
    else if (arg === "--limit" && argv[index + 1]) out.limit = Math.max(50, Math.min(20000, Number(argv[++index]) || out.limit));
    else if (arg === "--epochs" && argv[index + 1]) out.epochs = Math.max(100, Math.min(10000, Number(argv[++index]) || out.epochs));
    else if (arg === "--learning-rate" && argv[index + 1]) out.learningRate = clamp(Number(argv[++index]) || out.learningRate, 0.0001, 0.5);
    else if (arg === "--l2" && argv[index + 1]) out.l2 = clamp(Number(argv[++index]) || out.l2, 0, 0.2);
    else if (arg === "--help" || arg === "-h") return { help: true };
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    "train-lightzero-world-model-artifact.mjs",
    "",
    "Options:",
    "  --out <path>            Artifact JSON output path",
    "  --limit <n>             Max synthetic study_recovery runs to inspect",
    "  --epochs <n>            Gradient descent epochs per head",
    "  --learning-rate <n>     Step size for standardized linear regression",
    "  --l2 <n>                L2 regularization strength",
  ].join("\n"));
  process.exit(0);
}

const outPath = path.resolve(process.cwd(), args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

try {
  const runs = await prisma.reasoningRun.findMany({
    where: { mode: "study_recovery", origin: "synthetic_seed" },
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: { id: true, metadata: true, createdAt: true },
  });

  const examples = runs.flatMap(normalizeRunToExamples).filter(Boolean);
  if (examples.length < 100) {
    console.error(`Need at least 100 candidate examples to fit a LightZero artifact; found ${examples.length}.`);
    process.exit(1);
  }

  const featureStats = buildFeatureStats(examples);
  const fittedHeads = {
    projectedRecoveryProbability: fitHead(examples, featureStats, (example) => example.targets.projectedRecoveryProbability, { ...args, clampMin: 0, clampMax: 1 }),
    projectedConfidenceDelta: fitHead(examples, featureStats, (example) => example.targets.projectedConfidenceDelta, { ...args, clampMin: -0.2, clampMax: 0.3 }),
    projectedStabilityGain: fitHead(examples, featureStats, (example) => example.targets.projectedStabilityGain, { ...args, clampMin: 0, clampMax: 1 }),
    projectedLowConfidenceRisk: fitHead(examples, featureStats, (example) => example.targets.projectedLowConfidenceRisk, { ...args, clampMin: 0, clampMax: 1 }),
  };

  const artifact = {
    policyVersion: "lightzero_world_model_v1",
    selectedPolicyLabel: "lightzero-linear-synthetic-seed-v1",
    scorerKind: "lightzero_linear_world_model_v1",
    featureSchema: "tutoring_world_model_features_v1",
    sourceEvaluation: {
      script: "scripts/train-lightzero-world-model-artifact.mjs",
      checkpoint: `synthetic_seed:${runs.length}_runs:${examples.length}_candidates`,
      notes: [
        `epochs=${args.epochs}`,
        `learning_rate=${args.learningRate}`,
        `l2=${args.l2}`,
      ].join(", "),
    },
    heads: fittedHeads,
  };

  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`Runs: ${runs.length}`);
  console.log(`Candidate examples: ${examples.length}`);
  console.log(`Artifact: ${path.relative(process.cwd(), outPath)}`);
  for (const [name, head] of Object.entries(fittedHeads)) {
    console.log(`${name}: mae=${round4(head.trainingMae)}`);
  }
} finally {
  await prisma.$disconnect();
}

function normalizeRunToExamples(run) {
  const metadata = toRecord(run.metadata);
  const candidateStrategies = toArray(metadata.candidateStrategies).map(toRecord);
  const candidateOutcomes = toArray(metadata.oracleStrategyOutcomes).map(toRecord);
  const worldModel = toRecord(metadata.worldModel);
  const currentState = toRecord(worldModel.currentState);
  const verification = toRecord(metadata.verification);
  const weakTopicMatches = toStringArray(metadata.weakTopicMatches);
  const misconceptionSignals = toStringArray(metadata.misconceptionSignals);

  if (!candidateStrategies.length || !candidateOutcomes.length) return [];

  return candidateStrategies.map((strategy) => {
    const outcome = candidateOutcomes.find((candidateOutcome) => toString(candidateOutcome.strategyId) === toString(strategy.id));
    if (!outcome) return null;

    const priorConfidence = clamp(toNumber(metadata.priorConfidence), 0, 1);
    const postReviewConfidence = clamp(toNumber(outcome.postReviewConfidence), 0, 1);
    const retentionStrength = clamp(toNumber(currentState.retentionStrength), 0, 1);
    const lowConfidenceRisk = clamp(toNumber(currentState.lowConfidenceRisk), 0, 1);
    const recovered = outcome.recovered === true;
    const stabilized = outcome.stabilized === true;

    return {
      features: {
        strategyConfidence: clamp(toNumber(strategy.confidence), 0, 1),
        priorLocalSuccessRate: clamp(toNumber(strategy.priorLocalSuccessRate), 0, 1),
        misconceptionAlignment: clamp(toNumber(strategy.misconceptionAlignment), 0, 1),
        noveltyScore: clamp(toNumber(strategy.noveltyScore), 0, 1),
        lowCognitiveLoad: clamp(1 - toNumber(strategy.cognitiveLoad), 0, 1),
        hintGranularity: clamp(toNumber(strategy.hintGranularity), 0, 1),
        overallConfidence: clamp(toNumber(currentState.overallConfidence) || priorConfidence, 0, 1),
        retentionStrength,
        lowConfidenceRisk,
        verificationConfidence: clamp(toNumber(verification.confidence) || priorConfidence, 0, 1),
        weakTopicCount: clamp(weakTopicMatches.length / 4, 0, 1),
        misconceptionCount: clamp(misconceptionSignals.length / 3, 0, 1),
      },
      strategyMode: toStrategyMode(strategy.strategyMode),
      estimatedSteps: toNumber(strategy.estimatedSteps),
      targets: {
        projectedRecoveryProbability: recovered ? 0.95 : 0.05,
        projectedConfidenceDelta: clamp(toNumber(outcome.confidenceDelta), -0.2, 0.3),
        projectedStabilityGain: stabilized ? 0.95 : recovered ? 0.45 : 0.1,
        projectedLowConfidenceRisk: clamp((1 - postReviewConfidence) * 0.7 + (1 - retentionStrength) * 0.3, 0, 1),
      },
    };
  }).filter(Boolean);
}

function buildFeatureStats(examples) {
  return Object.fromEntries(FEATURE_NAMES.map((featureName) => {
    const values = examples.map((example) => example.features[featureName]);
    const mean = average(values);
    const variance = average(values.map((value) => (value - mean) ** 2));
    return [featureName, { mean, std: Math.sqrt(Math.max(variance, 1e-8)) || 1 }];
  }));
}

function fitHead(examples, featureStats, targetSelector, options) {
  const weights = Object.fromEntries(FEATURE_NAMES.map((featureName) => [featureName, 0]));
  const strategyModeBias = { exploration: 0, repair: 0, reinforcement: 0 };
  let intercept = average(examples.map((example) => targetSelector(example)));
  let shortStepBias = 0;
  let mediumStepBias = 0;
  let longStepBias = 0;

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    for (const example of examples) {
      const standardized = standardizeFeatures(example.features, featureStats);
      const target = targetSelector(example);
      const prediction = predictExample({ intercept, weights, strategyModeBias, shortStepBias, mediumStepBias, longStepBias }, standardized, example.strategyMode, example.estimatedSteps);
      const error = prediction - target;

      intercept -= options.learningRate * error * 0.02;
      for (const featureName of FEATURE_NAMES) {
        weights[featureName] -= options.learningRate * (error * standardized[featureName] + options.l2 * weights[featureName]) * 0.02;
      }
      strategyModeBias[example.strategyMode] -= options.learningRate * (error + options.l2 * strategyModeBias[example.strategyMode]) * 0.02;

      if (example.estimatedSteps <= 2.2) shortStepBias -= options.learningRate * (error + options.l2 * shortStepBias) * 0.02;
      else if (example.estimatedSteps <= 3) mediumStepBias -= options.learningRate * (error + options.l2 * mediumStepBias) * 0.02;
      else longStepBias -= options.learningRate * (error + options.l2 * longStepBias) * 0.02;
    }
  }

  const trainingMae = average(examples.map((example) => {
    const standardized = standardizeFeatures(example.features, featureStats);
    const prediction = clamp(
      predictExample({ intercept, weights, strategyModeBias, shortStepBias, mediumStepBias, longStepBias }, standardized, example.strategyMode, example.estimatedSteps),
      options.clampMin,
      options.clampMax,
    );
    return Math.abs(prediction - targetSelector(example));
  }));

  const rawWeights = Object.fromEntries(FEATURE_NAMES.map((featureName) => [
    featureName,
    weights[featureName] / featureStats[featureName].std,
  ]));
  const rawIntercept = intercept - FEATURE_NAMES.reduce(
    (sum, featureName) => sum + rawWeights[featureName] * featureStats[featureName].mean,
    0,
  );

  return {
    intercept: round6(rawIntercept),
    weights: Object.fromEntries(FEATURE_NAMES.map((featureName) => [featureName, round6(rawWeights[featureName])])),
    strategyModeBias: {
      exploration: round6(strategyModeBias.exploration),
      repair: round6(strategyModeBias.repair),
      reinforcement: round6(strategyModeBias.reinforcement),
    },
    shortStepBias: round6(shortStepBias),
    mediumStepBias: round6(mediumStepBias),
    longStepBias: round6(longStepBias),
    trainingMae: round6(trainingMae),
  };
}

function predictExample(head, standardizedFeatures, strategyMode, estimatedSteps) {
  let score = head.intercept;
  for (const featureName of FEATURE_NAMES) score += standardizedFeatures[featureName] * head.weights[featureName];
  score += head.strategyModeBias[strategyMode] || 0;
  score += estimatedSteps <= 2.2
    ? head.shortStepBias
    : estimatedSteps <= 3
      ? head.mediumStepBias
      : head.longStepBias;
  return score;
}

function standardizeFeatures(features, featureStats) {
  return Object.fromEntries(FEATURE_NAMES.map((featureName) => [
    featureName,
    (features[featureName] - featureStats[featureName].mean) / featureStats[featureName].std,
  ]));
}

function toStrategyMode(value) {
  return value === "exploration" || value === "reinforcement" ? value : "repair";
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toString(value) {
  return typeof value === "string" ? value : "";
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}