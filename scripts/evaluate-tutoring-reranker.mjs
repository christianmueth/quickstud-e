/*
Usage:
  node scripts/evaluate-tutoring-reranker.mjs
  node scripts/evaluate-tutoring-reranker.mjs --limit 800 --tree-depth 3 --boost-rounds 24

What it does:
  - Loads synthetic `study_recovery` runs that contain candidate-level oracle outcomes.
  - Trains offline value regressors on candidate confidence_delta.
  - Compares frozen heuristic policy selection against tree and boosted rerankers.
  - Aggregates conservative deployment diagnostics across multiple train/test seeds.
*/

import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    limit: 1000,
    seed: 13,
    seedCount: 5,
    testRatio: 0.25,
    treeDepth: 3,
    treeMinSamples: 10,
    boostRounds: 24,
    boostLearningRate: 0.12,
    topK: 2,
    blendWeights: [0.85, 0.75, 0.7, 0.65, 0.6, 0.55],
    abstainThresholds: [0.015, 0.03],
    disagreementBudgets: [0.02, 0.05, 0.08],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit" && argv[index + 1]) out.limit = Math.max(50, Math.min(5000, Number(argv[++index]) || out.limit));
    else if (arg === "--seed" && argv[index + 1]) out.seed = Number(argv[++index]) || out.seed;
    else if (arg === "--seed-count" && argv[index + 1]) out.seedCount = Math.max(1, Math.min(20, Number(argv[++index]) || out.seedCount));
    else if (arg === "--test-ratio" && argv[index + 1]) out.testRatio = clamp(Number(argv[++index]) || out.testRatio, 0.1, 0.5);
    else if (arg === "--tree-depth" && argv[index + 1]) out.treeDepth = Math.max(1, Math.min(6, Number(argv[++index]) || out.treeDepth));
    else if (arg === "--tree-min-samples" && argv[index + 1]) out.treeMinSamples = Math.max(2, Number(argv[++index]) || out.treeMinSamples);
    else if (arg === "--boost-rounds" && argv[index + 1]) out.boostRounds = Math.max(5, Math.min(100, Number(argv[++index]) || out.boostRounds));
    else if (arg === "--boost-learning-rate" && argv[index + 1]) out.boostLearningRate = clamp(Number(argv[++index]) || out.boostLearningRate, 0.01, 0.5);
    else if (arg === "--top-k" && argv[index + 1]) out.topK = Math.max(1, Math.min(5, Number(argv[++index]) || out.topK));
    else if (arg === "--blend-weights" && argv[index + 1]) out.blendWeights = parseNumberList(argv[++index], out.blendWeights).map((value) => clamp(value, 0, 1));
    else if (arg === "--abstain-thresholds" && argv[index + 1]) {
      out.abstainThresholds = parseNumberList(argv[++index], out.abstainThresholds);
    }
    else if (arg === "--disagreement-budgets" && argv[index + 1]) {
      out.disagreementBudgets = parseNumberList(argv[++index], out.disagreementBudgets).map((value) => clamp(value, 0, 1));
    }
    else if (arg === "--help" || arg === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    "evaluate-tutoring-reranker.mjs",
    "",
    "Options:",
    "  --limit <n>               Max synthetic study_recovery runs to inspect (default: 1000)",
    "  --seed <n>                Deterministic split seed (default: 13)",
    "  --seed-count <n>          Number of consecutive seeds to aggregate (default: 5)",
    "  --test-ratio <n>          Test split ratio between 0.1 and 0.5 (default: 0.25)",
    "  --tree-depth <n>          Tree depth for offline reranking baselines (default: 3)",
    "  --tree-min-samples <n>    Minimum samples per tree split (default: 10)",
    "  --boost-rounds <n>        Boosting rounds for value reranker (default: 24)",
    "  --boost-learning-rate <n> Boosting learning rate (default: 0.12)",
    "  --top-k <n>               Ranking depth for top-k lift/coverage metrics (default: 2)",
    "  --blend-weights <a,b>     Heuristic weights to sweep for additive boosted blends (default: 0.85,0.75,0.7,0.65,0.6,0.55)",
    "  --abstain-thresholds <a,b> Minimum predicted uplift needed to override heuristic (default: 0.015,0.03)",
    "  --disagreement-budgets <a,b> Max disagreement rates for budgeted policy selection (default: 0.02,0.05,0.08)",
  ].join("\n"));
  process.exit(0);
}

try {
  const runs = await prisma.reasoningRun.findMany({
    where: { mode: "study_recovery", origin: "synthetic_seed" },
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: { id: true, metadata: true, createdAt: true },
  });

  const scenarios = runs.map((run) => normalizeScenario(run)).filter(Boolean);
  if (scenarios.length < 20) {
    console.error(`Need at least 20 synthetic scenarios with candidate outcomes; found ${scenarios.length}.`);
    process.exit(1);
  }
  console.log(`Synthetic scenarios: ${scenarios.length}`);
  console.log(`Seeds: ${args.seed}..${args.seed + args.seedCount - 1} (${args.seedCount} runs)`);
  console.log(`Frozen heuristic policy: ${scenarios[0]?.heuristicPolicyVersion || "synthetic_v1"}`);
  console.log("");
  const evaluationRuns = [];
  for (let seedOffset = 0; seedOffset < args.seedCount; seedOffset += 1) {
    evaluationRuns.push(runSeedEvaluation(scenarios, { ...args, seed: args.seed + seedOffset }));
  }

  const policySummary = summarizePolicyRuns(evaluationRuns);
  const heuristicSummary = policySummary.get("heuristic");

  console.log("Offline reranking metrics (mean across seeds):");
  for (const [label, summary] of policySummary.entries()) printPolicySummary(label, summary, heuristicSummary, args.topK);

  console.log("");
  console.log("Best policies under disagreement budgets:");
  for (const budget of args.disagreementBudgets) {
    const candidate = chooseBestBudgetPolicy(policySummary, heuristicSummary, budget);
    if (!candidate) {
      console.log(`  budget<=${round3(budget)}: no learned policy satisfied constraints`);
      continue;
    }
    console.log(`  budget<=${round3(budget)}: ${candidate.label} lift=${signedDelta(candidate.deltaLift)} regret_reduction=${signedDelta(candidate.regretReduction)} disagreement=${candidate.summary.disagreementRate.mean} harmful_rate=${candidate.summary.harmfulFlipRate.mean}`);
  }

  console.log("");
  console.log("Per-seed conservative blend snapshots:");
  for (const run of evaluationRuns) {
    const metrics = run.metrics.get("boost_blend_0.7_abstain_0.015") || run.metrics.get("boost_blend_0.7");
    if (!metrics) continue;
    console.log(`  seed=${run.seed} avg_delta=${metrics.averageSelectedDelta} regret=${metrics.averageRegret} disagreement=${metrics.disagreementRate} abstain=${metrics.abstentionRate} helpful=${metrics.helpfulFlips} harmful=${metrics.harmfulFlips}`);
  }
} finally {
  await prisma.$disconnect();
}

function runSeedEvaluation(scenarios, options) {
  const shuffled = shuffle(scenarios, createRng(options.seed));
  const testSize = Math.max(1, Math.floor(shuffled.length * options.testRatio));
  const trainRuns = shuffled.slice(0, shuffled.length - testSize);
  const testRuns = shuffled.slice(shuffled.length - testSize);

  const trainExamples = trainRuns.flatMap((scenario) => scenario.candidates.map((candidate) => candidate.example));
  const vocabulary = buildVocabulary(trainExamples);
  const trainSet = vectorizeDataset(trainExamples, vocabulary);

  const treeModel = trainDecisionTree(trainSet, {
    maxDepth: options.treeDepth,
    minSamples: options.treeMinSamples,
  });
  const boostModel = trainGradientBoostedTrees(trainSet, {
    rounds: options.boostRounds,
    learningRate: options.boostLearningRate,
    maxDepth: Math.max(1, options.treeDepth - 1),
    minSamples: options.treeMinSamples,
    seed: options.seed,
  });

  const metrics = new Map();
  metrics.set("heuristic", evaluateRankedPolicy(testRuns, {
    topK: options.topK,
    scorer: (_example, candidate) => candidate.heuristicScore,
    chooser: (ranked, scenario) => ranked.find((item) => item.candidate.id === scenario.heuristicCandidateId) || ranked[0],
  }));
  metrics.set("tree_reranker", evaluateRankedPolicy(testRuns, {
    topK: options.topK,
    scorer: (example) => predictTreeProbability(treeModel, vectorizeExample(example, vocabulary)),
  }));
  metrics.set("boost_reranker", evaluateRankedPolicy(testRuns, {
    topK: options.topK,
    scorer: (example) => predictBoostedValue(boostModel, vectorizeExample(example, vocabulary)),
  }));

  for (const heuristicWeight of options.blendWeights) {
    const label = `boost_blend_${round3(heuristicWeight)}`;
    metrics.set(label, evaluateRankedPolicy(testRuns, {
      topK: options.topK,
      scorer: (example, candidate) => candidate.heuristicScore * heuristicWeight + predictBoostedValue(boostModel, vectorizeExample(example, vocabulary)) * (1 - heuristicWeight),
    }));
    for (const threshold of options.abstainThresholds) {
      metrics.set(`${label}_abstain_${round3(threshold)}`, evaluateRankedPolicy(testRuns, {
        topK: options.topK,
        abstainThreshold: threshold,
        scorer: (example, candidate) => candidate.heuristicScore * heuristicWeight + predictBoostedValue(boostModel, vectorizeExample(example, vocabulary)) * (1 - heuristicWeight),
      }));
    }
  }

  return {
    seed: options.seed,
    trainCount: trainRuns.length,
    testCount: testRuns.length,
    metrics,
  };
}

function summarizePolicyRuns(evaluationRuns) {
  const summaries = new Map();
  for (const run of evaluationRuns) {
    for (const [label, metrics] of run.metrics.entries()) {
      if (!summaries.has(label)) summaries.set(label, []);
      summaries.get(label).push(metrics);
    }
  }

  return new Map([...summaries.entries()].map(([label, metricsList]) => [label, summarizeMetrics(metricsList)]));
}

function summarizeMetrics(metricsList) {
  const numericKeys = [
    "runCount",
    "disagreementRate",
    "abstentionRate",
    "helpfulFlips",
    "harmfulFlips",
    "helpfulFlipRate",
    "harmfulFlipRate",
    "averageSelectedDelta",
    "averageOracleDelta",
    "averageRegret",
    "averageDisagreementActualLift",
    "averageDisagreementRegret",
    "averageTopKDelta",
    "oracleCoverageAtK",
    "upliftCalibrationMae",
  ];
  const summary = {};
  for (const key of numericKeys) {
    const values = metricsList.map((metrics) => toNumber(metrics[key]));
    summary[key] = {
      mean: round3(average(values)),
      min: round3(Math.min(...values)),
      max: round3(Math.max(...values)),
    };
  }
  return summary;
}

function chooseBestBudgetPolicy(policySummary, heuristicSummary, disagreementBudget) {
  const candidates = [];
  for (const [label, summary] of policySummary.entries()) {
    if (label === "heuristic" || label === "tree_reranker" || label === "boost_reranker") continue;
    if (summary.disagreementRate.mean > disagreementBudget) continue;
    const deltaLift = summary.averageSelectedDelta.mean - heuristicSummary.averageSelectedDelta.mean;
    const regretReduction = heuristicSummary.averageRegret.mean - summary.averageRegret.mean;
    candidates.push({ label, summary, deltaLift: round3(deltaLift), regretReduction: round3(regretReduction) });
  }

  return candidates
    .sort((left, right) => {
      if (right.deltaLift !== left.deltaLift) return right.deltaLift - left.deltaLift;
      if (right.regretReduction !== left.regretReduction) return right.regretReduction - left.regretReduction;
      if (left.summary.harmfulFlipRate.mean !== right.summary.harmfulFlipRate.mean) return left.summary.harmfulFlipRate.mean - right.summary.harmfulFlipRate.mean;
      return left.summary.disagreementRate.mean - right.summary.disagreementRate.mean;
    })[0] || null;
}

function normalizeScenario(run) {
  const metadata = toRecord(run.metadata);
  const candidateStrategies = toArray(metadata.candidateStrategies).map(toRecord);
  const oracleOutcomes = toArray(metadata.oracleStrategyOutcomes).map(toRecord);
  const heuristicPolicy = toRecord(metadata.heuristicPolicy);
  const worldModel = toRecord(metadata.worldModel);
  const selectedTransition = toRecord(worldModel.selectedTransition);
  if (!candidateStrategies.length || !oracleOutcomes.length) return null;

  const state = {
    misconception_signals: toStringArray(metadata.misconceptionSignals),
    weak_topic_matches: toStringArray(metadata.weakTopicMatches),
    prior_confidence: toNumber(metadata.priorConfidence),
    verification_confidence: toNumber(toRecord(metadata.verification).confidence),
    student_state: {
      weak_concepts: toStringArray(toRecord(metadata.studentState).weakConcepts),
      misconception_patterns: toStringArray(toRecord(metadata.studentState).misconceptionPatterns),
      confidence_profile: toRecord(toRecord(metadata.studentState).confidenceProfile),
      retention_profile: toRecord(toRecord(metadata.studentState).retentionProfile),
      pacing_profile: toRecord(toRecord(metadata.studentState).pacingProfile),
      preferred_explanation_style: toNullableString(toRecord(metadata.studentState).preferredExplanationStyle),
      recent_failures: toStringArray(toRecord(metadata.studentState).recentFailures),
      recent_successes: toStringArray(toRecord(metadata.studentState).recentSuccesses),
    },
    longitudinal_state: {
      confidence_volatility: toNumber(toRecord(metadata.longitudinalState).confidenceVolatility),
      frustration_level: toNumber(toRecord(metadata.longitudinalState).frustrationLevel),
      misconception_persistence: toNumber(toRecord(metadata.longitudinalState).misconceptionPersistence),
      prior_recovery_rate: toNumber(toRecord(metadata.longitudinalState).priorRecoveryRate),
      recent_strategy_success_rate: toNumber(toRecord(metadata.longitudinalState).recentStrategySuccessRate),
      recent_strategy_counts: toRecord(toRecord(metadata.longitudinalState).recentStrategyCounts),
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
  };

  const candidates = candidateStrategies.map((candidate) => {
    const outcome = oracleOutcomes.find((item) => toString(item.strategyId) === toString(candidate.id));
    if (!outcome) return null;
    return {
      id: toString(candidate.id),
      example: {
        state,
        action: {
          strategy_label: toNullableString(candidate.label),
          strategy_type: toNullableString(candidate.strategyType),
          strategy_confidence: toNumber(candidate.confidence),
          strategy_score: toNumber(candidate.score),
          novelty_score: toNumber(candidate.noveltyScore),
          misconception_alignment: toNumber(candidate.misconceptionAlignment),
          cognitive_load: toNumber(candidate.cognitiveLoad),
          hint_granularity: toNumber(candidate.hintGranularity),
          prior_local_success_rate: toNumber(candidate.priorLocalSuccessRate),
          estimated_steps: toNumber(candidate.estimatedSteps),
          strategy_mode: toNullableString(candidate.strategyMode),
        },
        target: {
          confidence_delta: toNumber(outcome.confidenceDelta),
        },
      },
      oracleDelta: toNumber(outcome.confidenceDelta),
      heuristicScore: toNumber(outcome.heuristicScore),
      recovered: outcome.recovered === true,
      stabilized: outcome.stabilized === true,
    };
  }).filter(Boolean);

  if (!candidates.length) return null;
  const oracleBest = [...candidates].sort((left, right) => right.oracleDelta - left.oracleDelta)[0];
  return {
    id: run.id,
    createdAt: run.createdAt,
    heuristicCandidateId: toString(heuristicPolicy.selectedStrategyId) || candidates.sort((left, right) => right.heuristicScore - left.heuristicScore)[0].id,
    heuristicPolicyVersion: toString(heuristicPolicy.policyVersion) || "synthetic_v1",
    candidates,
    oracleBestCandidateId: oracleBest.id,
    oracleBestDelta: oracleBest.oracleDelta,
  };
}

function buildVocabulary(examples) {
  const vocab = new Map();
  for (const example of examples) {
    for (const feature of categoricalFeatures(example)) {
      if (!vocab.has(feature)) vocab.set(feature, vocab.size);
    }
  }
  return vocab;
}

function vectorizeDataset(examples, vocabulary) {
  return {
    vectors: examples.map((example) => vectorizeExample(example, vocabulary)),
    labels: examples.map((example) => toNumber(example.target?.confidence_delta)),
  };
}

function vectorizeExample(example, vocabulary) {
  const vector = new Map();
  for (const [name, value] of numericFeatures(example)) if (value !== 0) vector.set(name, value);
  for (const feature of categoricalFeatures(example)) {
    const index = vocabulary.get(feature);
    if (index !== undefined) vector.set(`cat:${index}`, 1);
  }
  return vector;
}

function numericFeatures(example) {
  const state = example.state || {};
  const studentState = state.student_state || {};
  const longitudinalState = state.longitudinal_state || {};
  const worldModel = state.world_model || {};
  const action = example.action || {};
  const retentionProfile = studentState.retention_profile || {};
  const confidenceProfile = studentState.confidence_profile || {};
  const strategyHistory = longitudinalState.recent_strategy_counts || {};
  return [
    ["num:prior_confidence", toNumber(state.prior_confidence)],
    ["num:verification_confidence", toNumber(state.verification_confidence)],
    ["num:strategy_confidence", toNumber(action.strategy_confidence)],
    ["num:strategy_score", toNumber(action.strategy_score)],
    ["num:novelty_score", toNumber(action.novelty_score)],
    ["num:misconception_alignment", toNumber(action.misconception_alignment)],
    ["num:cognitive_load", toNumber(action.cognitive_load)],
    ["num:hint_granularity", toNumber(action.hint_granularity)],
    ["num:prior_local_success_rate", toNumber(action.prior_local_success_rate)],
    ["num:estimated_steps", toNumber(action.estimated_steps)],
    ["num:weak_topic_count", count(state.weak_topic_matches)],
    ["num:misconception_count", count(state.misconception_signals)],
    ["num:weak_concepts_count", count(studentState.weak_concepts)],
    ["num:recent_failures_count", count(studentState.recent_failures)],
    ["num:retention_mean", meanRecord(retentionProfile)],
    ["num:confidence_profile_mean", meanRecord(confidenceProfile)],
    ["num:confidence_volatility", toNumber(longitudinalState.confidence_volatility)],
    ["num:frustration_level", toNumber(longitudinalState.frustration_level)],
    ["num:misconception_persistence", toNumber(longitudinalState.misconception_persistence)],
    ["num:prior_recovery_rate", toNumber(longitudinalState.prior_recovery_rate)],
    ["num:recent_strategy_success_rate", toNumber(longitudinalState.recent_strategy_success_rate)],
    ["num:strategy_attempts_mean", meanNestedRecord(strategyHistory, "attempts")],
    ["num:strategy_history_success_mean", meanNestedRecord(strategyHistory, "successRate")],
    ["num:wm_projected_confidence_delta", toNumber(worldModel.projected_confidence_delta)],
    ["num:wm_projected_recovery_probability", toNumber(worldModel.projected_recovery_probability)],
    ["num:wm_projected_stability_gain", toNumber(worldModel.projected_stability_gain)],
    ["num:wm_projected_low_confidence_risk", toNumber(worldModel.projected_low_confidence_risk)],
  ];
}

function categoricalFeatures(example) {
  const state = example.state || {};
  const studentState = state.student_state || {};
  const worldModel = state.world_model || {};
  const action = example.action || {};
  const features = [];
  for (const misconception of toStringArray(state.misconception_signals)) features.push(`misconception=${misconception}`);
  for (const misconception of toStringArray(studentState.misconception_patterns)) features.push(`pattern=${misconception}`);
  for (const topic of toStringArray(state.weak_topic_matches)) features.push(`weak_topic=${topic}`);
  for (const concept of toStringArray(studentState.weak_concepts)) features.push(`weak_concept=${concept}`);
  for (const topic of toStringArray(worldModel.projected_next_weak_topics)) features.push(`wm_next_weak=${topic}`);
  for (const misconception of toStringArray(worldModel.projected_next_misconceptions)) features.push(`wm_next_misconception=${misconception}`);
  if (action.strategy_type) features.push(`strategy=${action.strategy_type}`);
  if (action.strategy_mode) features.push(`strategy_mode=${action.strategy_mode}`);
  if (studentState.preferred_explanation_style) features.push(`style=${studentState.preferred_explanation_style}`);
  if (worldModel.version) features.push(`world_model=${worldModel.version}`);
  const pacing = studentState.pacing_profile?.preferredSpeed;
  if (typeof pacing === "string" && pacing.trim()) features.push(`pacing=${pacing}`);
  const volatilityBand = studentState.pacing_profile?.confidenceVolatilityBand;
  if (typeof volatilityBand === "string" && volatilityBand.trim()) features.push(`volatility=${volatilityBand}`);
  const frustrationBand = studentState.pacing_profile?.frustrationBand;
  if (typeof frustrationBand === "string" && frustrationBand.trim()) features.push(`frustration=${frustrationBand}`);
  return features;
}

function evaluateRankedPolicy(scenarios, options) {
  let helpfulFlips = 0;
  let harmfulFlips = 0;
  let disagreements = 0;
  let abstentions = 0;
  let selectedDeltaSum = 0;
  let oracleDeltaSum = 0;
  let regretSum = 0;
  let disagreementActualLiftSum = 0;
  let disagreementRegretSum = 0;
  let topKDeltaSum = 0;
  let oracleCoverageAtK = 0;
  let upliftCalibrationErrorSum = 0;
  for (const scenario of scenarios) {
    const ranked = rankCandidates(scenario, options.scorer);
    const heuristic = ranked.find((item) => item.candidate.id === scenario.heuristicCandidateId) || ranked[0];
    let chosen = options.chooser ? options.chooser(ranked, scenario) : ranked[0];
    if (options.abstainThreshold && chosen.candidate.id !== heuristic.candidate.id) {
      const predictedUplift = chosen.score - heuristic.score;
      if (predictedUplift < options.abstainThreshold) {
        chosen = heuristic;
        abstentions += 1;
      }
    }
    const chosenCandidate = chosen.candidate;
    const heuristicCandidate = heuristic.candidate;
    const topK = ranked.slice(0, Math.max(1, options.topK || 1));
    const bestTopKDelta = Math.max(...topK.map((item) => item.candidate.oracleDelta));
    topKDeltaSum += bestTopKDelta;
    if (topK.some((item) => item.candidate.id === scenario.oracleBestCandidateId)) oracleCoverageAtK += 1;
    if (chosenCandidate.id !== heuristicCandidate.id) {
      disagreements += 1;
      const actualLift = chosenCandidate.oracleDelta - heuristicCandidate.oracleDelta;
      disagreementActualLiftSum += actualLift;
      disagreementRegretSum += scenario.oracleBestDelta - chosenCandidate.oracleDelta;
      upliftCalibrationErrorSum += Math.abs((chosen.score - heuristic.score) - actualLift);
      if (chosenCandidate.oracleDelta > heuristicCandidate.oracleDelta) helpfulFlips += 1;
      else if (chosenCandidate.oracleDelta < heuristicCandidate.oracleDelta) harmfulFlips += 1;
    }
    selectedDeltaSum += chosenCandidate.oracleDelta;
    oracleDeltaSum += scenario.oracleBestDelta;
    regretSum += scenario.oracleBestDelta - chosenCandidate.oracleDelta;
  }
  return {
    runCount: scenarios.length,
    disagreementRate: round3(disagreements / scenarios.length),
    abstentionRate: round3(abstentions / scenarios.length),
    helpfulFlips,
    harmfulFlips,
    helpfulFlipRate: disagreements ? round3(helpfulFlips / disagreements) : 0,
    harmfulFlipRate: disagreements ? round3(harmfulFlips / disagreements) : 0,
    averageSelectedDelta: round3(selectedDeltaSum / scenarios.length),
    averageOracleDelta: round3(oracleDeltaSum / scenarios.length),
    averageRegret: round3(regretSum / scenarios.length),
    averageDisagreementActualLift: disagreements ? round3(disagreementActualLiftSum / disagreements) : 0,
    averageDisagreementRegret: disagreements ? round3(disagreementRegretSum / disagreements) : 0,
    averageTopKDelta: round3(topKDeltaSum / scenarios.length),
    oracleCoverageAtK: round3(oracleCoverageAtK / scenarios.length),
    upliftCalibrationMae: disagreements ? round3(upliftCalibrationErrorSum / disagreements) : 0,
  };
}

function rankCandidates(scenario, scorer) {
  return [...scenario.candidates]
    .map((candidate) => ({ candidate, score: scorer(candidate.example, candidate, scenario) }))
    .sort((left, right) => right.score - left.score);
}

function trainDecisionTree(dataset, options) {
  const featureNames = collectFeatureNames(dataset.vectors);
  const samples = dataset.vectors.map((vector, index) => ({ vector, label: dataset.labels[index] }));
  return buildTreeNode(samples, featureNames, 0, options, average(dataset.labels));
}

function buildTreeNode(samples, featureNames, depth, options, defaultValue = 0) {
  const value = samples.length ? average(samples.map((sample) => sample.label)) : defaultValue;
  if (depth >= options.maxDepth || samples.length < options.minSamples) {
    return { leaf: true, probability: round3(value), samples: samples.length };
  }
  const split = bestSplit(samples, featureNames, options.minSamples);
  if (!split) return { leaf: true, probability: round3(value), samples: samples.length };
  return {
    leaf: false,
    feature: split.feature,
    threshold: split.threshold,
    probability: round3(value),
    samples: samples.length,
    left: buildTreeNode(split.left, featureNames, depth + 1, options, value),
    right: buildTreeNode(split.right, featureNames, depth + 1, options, value),
  };
}

function bestSplit(samples, featureNames, minSamples) {
  let best = null;
  const parentVariance = variance(samples.map((sample) => sample.label));
  for (const feature of featureNames) {
    const values = [...new Set(samples.map((sample) => sample.vector.get(feature) || 0).sort((a, b) => a - b))];
    if (values.length <= 1) continue;
    for (const threshold of candidateThresholds(values)) {
      const left = [];
      const right = [];
      for (const sample of samples) {
        if ((sample.vector.get(feature) || 0) <= threshold) left.push(sample);
        else right.push(sample);
      }
      if (left.length < minSamples || right.length < minSamples) continue;
      const weightedVariance = (left.length / samples.length) * variance(left.map((sample) => sample.label)) + (right.length / samples.length) * variance(right.map((sample) => sample.label));
      const gain = parentVariance - weightedVariance;
      if (!best || gain > best.gain) best = { feature, threshold, gain, left, right };
    }
  }
  return best;
}

function trainGradientBoostedTrees(dataset, options) {
  const model = { baseValue: average(dataset.labels), learningRate: options.learningRate, trees: [] };
  let predictions = dataset.labels.map(() => model.baseValue);
  for (let round = 0; round < options.rounds; round += 1) {
    const residualSet = {
      vectors: dataset.vectors,
      labels: dataset.labels.map((label, index) => clamp(label - predictions[index], -0.5, 0.5)),
    };
    const tree = trainDecisionTree(residualSet, { maxDepth: options.maxDepth, minSamples: options.minSamples });
    model.trees.push(tree);
    predictions = predictions.map((prediction, index) => prediction + options.learningRate * predictTreeProbability(tree, dataset.vectors[index]));
  }
  return model;
}

function predictTreeProbability(node, vector) {
  if (node.leaf) return node.probability;
  return (vector.get(node.feature) || 0) <= node.threshold
    ? predictTreeProbability(node.left, vector)
    : predictTreeProbability(node.right, vector);
}

function predictBoostedValue(model, vector) {
  let prediction = model.baseValue;
  for (const tree of model.trees) prediction += model.learningRate * predictTreeProbability(tree, vector);
  return prediction;
}

function printPolicySummary(label, summary, heuristicSummary, topK) {
  const deltaLift = heuristicSummary ? summary.averageSelectedDelta.mean - heuristicSummary.averageSelectedDelta.mean : 0;
  const regretReduction = heuristicSummary ? heuristicSummary.averageRegret.mean - summary.averageRegret.mean : 0;
  const topKLift = heuristicSummary ? summary.averageTopKDelta.mean - heuristicSummary.averageTopKDelta.mean : 0;
  console.log(`  ${label}: avg_delta=${summary.averageSelectedDelta.mean} regret=${summary.averageRegret.mean} disagreement=${summary.disagreementRate.mean} abstain=${summary.abstentionRate.mean} helpful=${summary.helpfulFlips.mean} harmful=${summary.harmfulFlips.mean}`);
  console.log(`    lift=${signedDelta(deltaLift)} regret_reduction=${signedDelta(regretReduction)} helpful_rate=${summary.helpfulFlipRate.mean} harmful_rate=${summary.harmfulFlipRate.mean} disagreement_lift=${signedDelta(summary.averageDisagreementActualLift.mean)} calibration_mae=${summary.upliftCalibrationMae.mean} top${topK}_lift=${signedDelta(topKLift)} top${topK}_oracle_coverage=${summary.oracleCoverageAtK.mean}`);
}

function collectFeatureNames(vectors) {
  const names = new Set();
  for (const vector of vectors) for (const feature of vector.keys()) names.add(feature);
  return [...names];
}

function candidateThresholds(values) {
  if (values.length <= 12) return values.slice(0, -1).map((value, index) => (value + values[index + 1]) / 2);
  const thresholds = [];
  for (let bucket = 1; bucket <= 10; bucket += 1) {
    const index = Math.floor((bucket / 11) * (values.length - 1));
    const nextIndex = Math.min(values.length - 1, index + 1);
    if (values[index] !== values[nextIndex]) thresholds.push((values[index] + values[nextIndex]) / 2);
  }
  return [...new Set(thresholds)];
}

function variance(values) {
  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function shuffle(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function createRng(seed) {
  let state = Math.floor(seed) || 1;
  return function next() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function meanRecord(record) {
  const values = Object.values(record || {}).map(toNumber).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function meanNestedRecord(record, key) {
  const values = Object.values(record || {}).map((value) => (value && typeof value === "object" ? toNumber(value[key]) : 0)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toString(value) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function signedDelta(value) {
  const rounded = round3(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function parseNumberList(value, fallback) {
  const values = String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite)
    .map((item) => round3(Math.max(0, item)));
  return values.length ? [...new Set(values)] : fallback;
}