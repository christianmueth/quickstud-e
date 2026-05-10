/*
Usage:
  node scripts/train-recovery-baseline.mjs
  node scripts/train-recovery-baseline.mjs --target stabilized --epochs 600 --lr 0.08

What it does:
  - Loads the exported tutoring recovery JSONL dataset.
  - Trains a tiny logistic-regression baseline on pre-outcome state/action features only.
  - Compares learned predictions against majority and empirical heuristic priors.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const out = {
    data: "tmp/tutoring-recovery-value-dataset.jsonl",
    target: "recovered",
    epochs: 500,
    lr: 0.1,
    l2: 0.0005,
    testRatio: 0.25,
    seed: 13,
    topWeights: 12,
    treeDepth: 3,
    treeMinSamples: 10,
    forestTrees: 25,
    boostRounds: 20,
    boostLearningRate: 0.15,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data" && argv[index + 1]) out.data = argv[++index];
    else if (arg === "--target" && argv[index + 1]) out.target = argv[++index];
    else if (arg === "--epochs" && argv[index + 1]) out.epochs = Math.max(1, Number(argv[++index]) || out.epochs);
    else if (arg === "--lr" && argv[index + 1]) out.lr = Number(argv[++index]) || out.lr;
    else if (arg === "--l2" && argv[index + 1]) out.l2 = Number(argv[++index]) || out.l2;
    else if (arg === "--test-ratio" && argv[index + 1]) out.testRatio = clamp(Number(argv[++index]) || out.testRatio, 0.1, 0.5);
    else if (arg === "--seed" && argv[index + 1]) out.seed = Number(argv[++index]) || out.seed;
    else if (arg === "--top-weights" && argv[index + 1]) out.topWeights = Math.max(1, Number(argv[++index]) || out.topWeights);
    else if (arg === "--tree-depth" && argv[index + 1]) out.treeDepth = Math.max(1, Math.min(6, Number(argv[++index]) || out.treeDepth));
    else if (arg === "--tree-min-samples" && argv[index + 1]) out.treeMinSamples = Math.max(2, Number(argv[++index]) || out.treeMinSamples);
    else if (arg === "--forest-trees" && argv[index + 1]) out.forestTrees = Math.max(5, Math.min(200, Number(argv[++index]) || out.forestTrees));
    else if (arg === "--boost-rounds" && argv[index + 1]) out.boostRounds = Math.max(5, Math.min(100, Number(argv[++index]) || out.boostRounds));
    else if (arg === "--boost-learning-rate" && argv[index + 1]) out.boostLearningRate = clamp(Number(argv[++index]) || out.boostLearningRate, 0.01, 0.5);
    else if (arg === "--help" || arg === "-h") return { help: true };
  }

  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    "train-recovery-baseline.mjs",
    "",
    "Options:",
    "  --data <path>         Recovery dataset JSONL path (default: tmp/tutoring-recovery-value-dataset.jsonl)",
    "  --target <name>       Target: recovered | stabilized | confidence_delta (default: recovered)",
    "  --epochs <n>          Training epochs for SGD logistic regression (default: 500)",
    "  --lr <n>              Learning rate (default: 0.1)",
    "  --l2 <n>              L2 regularization strength (default: 0.0005)",
    "  --test-ratio <n>      Test split ratio between 0.1 and 0.5 (default: 0.25)",
    "  --seed <n>            Deterministic shuffle seed (default: 13)",
    "  --top-weights <n>     Number of top positive/negative learned features to print (default: 12)",
    "  --tree-depth <n>      Max depth for the shallow decision tree baseline (default: 3)",
    "  --tree-min-samples <n> Minimum samples required to split a tree node (default: 10)",
    "  --forest-trees <n>    Number of trees in the random forest baseline (default: 25)",
    "  --boost-rounds <n>    Number of boosting rounds for gradient boosting (default: 20)",
    "  --boost-learning-rate <n> Learning rate for gradient boosting (default: 0.15)",
    "",
    "Example:",
    "  node scripts/train-recovery-baseline.mjs --target recovered --epochs 600 --lr 0.08",
  ].join("\n"));
  process.exit(0);
}

if (!["recovered", "stabilized", "confidence_delta"].includes(args.target)) {
  console.error(`Unsupported target: ${args.target}. Use recovered, stabilized, or confidence_delta.`);
  process.exit(1);
}

const dataPath = path.resolve(process.cwd(), args.data);
if (!fs.existsSync(dataPath)) {
  console.error(`Dataset file not found: ${path.relative(process.cwd(), dataPath)}`);
  process.exit(1);
}

const examples = readDataset(dataPath);
if (examples.length < 20) {
  console.error(`Need at least 20 examples to train a baseline; found ${examples.length}.`);
  process.exit(1);
}

const shuffled = shuffle(examples, createRng(args.seed));
const testSize = Math.max(1, Math.floor(shuffled.length * args.testRatio));
const train = shuffled.slice(0, shuffled.length - testSize);
const test = shuffled.slice(shuffled.length - testSize);
const vocabulary = buildVocabulary(train);
const trainSet = vectorizeDataset(train, vocabulary, args.target);
const testSet = vectorizeDataset(test, vocabulary, args.target);

const model = isRegressionTarget(args.target)
  ? trainLinearRegression(trainSet, {
      epochs: args.epochs,
      learningRate: Math.min(args.lr, 0.02),
      l2: args.l2,
      seed: args.seed,
    })
  : trainLogisticRegression(trainSet, {
      epochs: args.epochs,
      learningRate: args.lr,
      l2: args.l2,
      seed: args.seed,
    });
const treeModel = trainDecisionTree(trainSet, {
  maxDepth: args.treeDepth,
  minSamples: args.treeMinSamples,
});
const forestModel = trainRandomForest(trainSet, {
  treeCount: args.forestTrees,
  maxDepth: args.treeDepth,
  minSamples: args.treeMinSamples,
  seed: args.seed,
});
const boostModel = isRegressionTarget(args.target)
  ? trainGradientBoostedTrees(trainSet, {
      rounds: args.boostRounds,
      learningRate: args.boostLearningRate,
      maxDepth: Math.max(1, args.treeDepth - 1),
      minSamples: args.treeMinSamples,
      seed: args.seed,
    })
  : null;

const empiricalPrior = buildEmpiricalPrior(train, args.target);
const overallPositiveRate = average(trainSet.labels);
const logisticMetrics = isRegressionTarget(args.target)
  ? evaluateRegressionModel(testSet, (vector) => predictLinearValue(model, vector))
  : evaluateModel(testSet, (vector) => predictProbability(model, vector));
const treeMetrics = isRegressionTarget(args.target)
  ? evaluateRegressionModel(testSet, (vector) => predictTreeProbability(treeModel, vector))
  : evaluateModel(testSet, (vector) => predictTreeProbability(treeModel, vector));
const forestMetrics = isRegressionTarget(args.target)
  ? evaluateRegressionModel(testSet, (vector) => predictForestValue(forestModel, vector))
  : evaluateModel(testSet, (vector) => predictForestValue(forestModel, vector));
const boostMetrics = boostModel
  ? evaluateRegressionModel(testSet, (vector) => predictBoostedValue(boostModel, vector))
  : null;
const majorityMetrics = isRegressionTarget(args.target)
  ? evaluateRegressionConstant(testSet, overallPositiveRate)
  : evaluateConstantBaseline(testSet, overallPositiveRate >= 0.5 ? 1 : 0, overallPositiveRate);
const heuristicMetrics = isRegressionTarget(args.target)
  ? evaluateRegressionExamples(test, args.target, (example) => empiricalPriorRegression(example, empiricalPrior, overallPositiveRate))
  : evaluateExamples(test, args.target, (example) => empiricalPriorProbability(example, empiricalPrior, overallPositiveRate));

console.log(`Dataset: ${path.relative(process.cwd(), dataPath)}`);
console.log(`Target: ${args.target}`);
console.log(`Train/Test: ${train.length}/${test.length}`);
console.log(`${isRegressionTarget(args.target) ? "Target mean" : "Positive rate"} (train): ${round3(overallPositiveRate)}`);
  console.log("Features: pre-outcome state/action only; excludes post-review confidence, reward, trajectory score, and other outcome-derived fields.");
console.log("");
console.log("Metrics (test split):");
printMetrics("logistic", logisticMetrics);
printMetrics("tree", treeMetrics);
printMetrics("forest", forestMetrics);
if (boostMetrics) printMetrics("boost", boostMetrics);
printMetrics("heuristic_prior", heuristicMetrics);
printMetrics("majority", majorityMetrics);
console.log("");
if (isRegressionTarget(args.target)) {
  console.log("Lift vs heuristic prior:");
  console.log(`  rmseGain: ${signedDelta(heuristicMetrics.rmse - logisticMetrics.rmse)}`);
  console.log(`  maeGain: ${signedDelta(heuristicMetrics.mae - logisticMetrics.mae)}`);
  console.log(`  r2Delta: ${signedDelta(logisticMetrics.r2 - heuristicMetrics.r2)}`);
  console.log("Tree lift vs heuristic prior:");
  console.log(`  rmseGain: ${signedDelta(heuristicMetrics.rmse - treeMetrics.rmse)}`);
  console.log(`  maeGain: ${signedDelta(heuristicMetrics.mae - treeMetrics.mae)}`);
  console.log(`  r2Delta: ${signedDelta(treeMetrics.r2 - heuristicMetrics.r2)}`);
  console.log("Forest lift vs heuristic prior:");
  console.log(`  rmseGain: ${signedDelta(heuristicMetrics.rmse - forestMetrics.rmse)}`);
  console.log(`  maeGain: ${signedDelta(heuristicMetrics.mae - forestMetrics.mae)}`);
  console.log(`  r2Delta: ${signedDelta(forestMetrics.r2 - heuristicMetrics.r2)}`);
  if (boostMetrics) {
    console.log("Boost lift vs heuristic prior:");
    console.log(`  rmseGain: ${signedDelta(heuristicMetrics.rmse - boostMetrics.rmse)}`);
    console.log(`  maeGain: ${signedDelta(heuristicMetrics.mae - boostMetrics.mae)}`);
    console.log(`  r2Delta: ${signedDelta(boostMetrics.r2 - heuristicMetrics.r2)}`);
  }
} else {
  console.log("Lift vs heuristic prior:");
  console.log(`  accuracy: ${signedDelta(logisticMetrics.accuracy - heuristicMetrics.accuracy)}`);
  console.log(`  f1: ${signedDelta(logisticMetrics.f1 - heuristicMetrics.f1)}`);
  console.log(`  logLoss: ${signedDelta(heuristicMetrics.logLoss - logisticMetrics.logLoss)}`);
  console.log(`  brierGain: ${signedDelta(heuristicMetrics.brier - logisticMetrics.brier)}`);
  console.log("Tree lift vs heuristic prior:");
  console.log(`  accuracy: ${signedDelta(treeMetrics.accuracy - heuristicMetrics.accuracy)}`);
  console.log(`  f1: ${signedDelta(treeMetrics.f1 - heuristicMetrics.f1)}`);
  console.log(`  logLoss: ${signedDelta(heuristicMetrics.logLoss - treeMetrics.logLoss)}`);
  console.log(`  brierGain: ${signedDelta(heuristicMetrics.brier - treeMetrics.brier)}`);
  console.log("Forest lift vs heuristic prior:");
  console.log(`  accuracy: ${signedDelta(forestMetrics.accuracy - heuristicMetrics.accuracy)}`);
  console.log(`  f1: ${signedDelta(forestMetrics.f1 - heuristicMetrics.f1)}`);
  console.log(`  logLoss: ${signedDelta(heuristicMetrics.logLoss - forestMetrics.logLoss)}`);
  console.log(`  brierGain: ${signedDelta(heuristicMetrics.brier - forestMetrics.brier)}`);
}
console.log("");
console.log("Top positive learned features:");
for (const row of topWeights(model, vocabulary, args.topWeights, "positive")) {
    console.log(`  ${row.feature}: ${row.weight}`);
  }
console.log("Top negative learned features:");
for (const row of topWeights(model, vocabulary, args.topWeights, "negative")) {
    console.log(`  ${row.feature}: ${row.weight}`);
  }
console.log("Top tree splits:");
for (const split of describeTree(treeModel, vocabulary, args.topWeights)) {
  console.log(`  ${split}`);
}

function readDataset(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

function vectorizeDataset(examples, vocabulary, targetName) {
  return {
    vectors: examples.map((example) => vectorizeExample(example, vocabulary)),
    labels: examples.map((example) => getTargetValue(example, targetName)),
  };
}

function vectorizeExample(example, vocabulary) {
  const vector = new Map();
  for (const [name, value] of numericFeatures(example)) {
    if (value !== 0) vector.set(name, value);
  }
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
  const action = example.action || {};
  const retentionProfile = studentState.retention_profile || {};
  const confidenceProfile = studentState.confidence_profile || {};
  const strategyHistory = longitudinalState.recent_strategy_counts || {};
  return [
    ["num:prior_confidence", toNumber(state.prior_confidence)],
    ["num:verification_confidence", toNumber(state.verification_confidence)],
    ["num:strategy_confidence", toNumber(action.strategy_confidence)],
    ["num:strategy_score", toNumber(action.strategy_score)],
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
  ];
}

function categoricalFeatures(example) {
  const state = example.state || {};
  const studentState = state.student_state || {};
  const action = example.action || {};
  const features = [];
  for (const misconception of arrayOfStrings(state.misconception_signals)) features.push(`misconception=${misconception}`);
  for (const misconception of arrayOfStrings(studentState.misconception_patterns)) features.push(`pattern=${misconception}`);
  for (const topic of arrayOfStrings(state.weak_topic_matches)) features.push(`weak_topic=${topic}`);
  for (const concept of arrayOfStrings(studentState.weak_concepts)) features.push(`weak_concept=${concept}`);
  if (action.strategy_type) features.push(`strategy=${action.strategy_type}`);
  if (studentState.preferred_explanation_style) features.push(`style=${studentState.preferred_explanation_style}`);
  const pacing = studentState.pacing_profile?.preferredSpeed;
  if (typeof pacing === "string" && pacing.trim()) features.push(`pacing=${pacing}`);
  const volatilityBand = studentState.pacing_profile?.confidenceVolatilityBand;
  if (typeof volatilityBand === "string" && volatilityBand.trim()) features.push(`volatility=${volatilityBand}`);
  const frustrationBand = studentState.pacing_profile?.frustrationBand;
  if (typeof frustrationBand === "string" && frustrationBand.trim()) features.push(`frustration=${frustrationBand}`);
  return features;
}

function getTarget(example, targetName) {
  return targetName === "stabilized" ? example?.target?.stabilized === true : example?.target?.recovered === true;
}

function getTargetValue(example, targetName) {
  if (targetName === "confidence_delta") return toNumber(example?.target?.confidence_delta);
  return getTarget(example, targetName) ? 1 : 0;
}

function buildEmpiricalPrior(examples, targetName) {
  const byPair = new Map();
  const byStrategy = new Map();
  const byMisconception = new Map();

  for (const example of examples) {
    const label = getTargetValue(example, targetName);
    const strategy = example?.action?.strategy_type || "unknown";
    const misconception = arrayOfStrings(example?.state?.misconception_signals)[0] || "unknown";
    pushRate(byPair, `${strategy}::${misconception}`, label);
    pushRate(byStrategy, strategy, label);
    pushRate(byMisconception, misconception, label);
  }

  return {
    byPair: finalizeRates(byPair),
    byStrategy: finalizeRates(byStrategy),
    byMisconception: finalizeRates(byMisconception),
  };
}

function empiricalPriorProbability(example, priors, fallback) {
  const strategy = example?.action?.strategy_type || "unknown";
  const misconception = arrayOfStrings(example?.state?.misconception_signals)[0] || "unknown";
  const pairKey = `${strategy}::${misconception}`;
  if (priors.byPair.has(pairKey)) return priors.byPair.get(pairKey);
  if (priors.byStrategy.has(strategy) && priors.byMisconception.has(misconception)) {
    return round3((priors.byStrategy.get(strategy) + priors.byMisconception.get(misconception)) / 2);
  }
  if (priors.byStrategy.has(strategy)) return priors.byStrategy.get(strategy);
  if (priors.byMisconception.has(misconception)) return priors.byMisconception.get(misconception);
  return fallback;
}

function empiricalPriorRegression(example, priors, fallback) {
  return empiricalPriorProbability(example, priors, fallback);
}

function pushRate(map, key, label) {
  const current = map.get(key) || { sum: 0, count: 0 };
  current.sum += label;
  current.count += 1;
  map.set(key, current);
}

function finalizeRates(map) {
  for (const [key, value] of map.entries()) map.set(key, value.count ? value.sum / value.count : 0);
  return map;
}

function trainLogisticRegression(dataset, options) {
  const weights = new Map();
  let bias = 0;
  const rng = createRng(options.seed);

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const order = shuffleIndices(dataset.vectors.length, rng);
    for (const index of order) {
      const vector = dataset.vectors[index];
      const label = dataset.labels[index];
      const prediction = sigmoid(scoreVector(weights, bias, vector));
      const error = prediction - label;
      bias -= options.learningRate * error;
      for (const [feature, value] of vector.entries()) {
        const current = weights.get(feature) || 0;
        const gradient = error * value + options.l2 * current;
        weights.set(feature, current - options.learningRate * gradient);
      }
    }
  }

  return { weights, bias };
}

function trainLinearRegression(dataset, options) {
  const weights = new Map();
  let bias = average(dataset.labels);
  const rng = createRng(options.seed);

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const order = shuffleIndices(dataset.vectors.length, rng);
    for (const index of order) {
      const vector = dataset.vectors[index];
      const label = dataset.labels[index];
      const prediction = predictLinearValue({ weights, bias }, vector);
      const error = clamp(prediction - label, -1, 1);
      bias -= options.learningRate * error * 0.2;
      for (const [feature, value] of vector.entries()) {
        const current = weights.get(feature) || 0;
        const gradient = error * value + options.l2 * current;
        weights.set(feature, current - options.learningRate * gradient);
      }
    }
  }

  return { weights, bias };
}

function trainDecisionTree(dataset, options) {
  const featureNames = collectFeatureNames(dataset.vectors);
  const samples = dataset.vectors.map((vector, index) => ({ vector, label: dataset.labels[index] }));
  return buildTreeNode(samples, featureNames, 0, options, average(dataset.labels));
}

function buildTreeNode(samples, featureNames, depth, options, defaultValue = 0) {
  const probability = samples.length ? average(samples.map((sample) => sample.label)) : defaultValue;
  if (
    depth >= options.maxDepth ||
    samples.length < options.minSamples ||
    probability === 0 ||
    probability === 1
  ) {
    return { leaf: true, probability: round3(probability), samples: samples.length };
  }

  const split = bestSplit(samples, featureNames, options.minSamples);
  if (!split) return { leaf: true, probability: round3(probability), samples: samples.length };

  return {
    leaf: false,
    feature: split.feature,
    threshold: split.threshold,
    probability: round3(probability),
    samples: samples.length,
    left: buildTreeNode(split.left, featureNames, depth + 1, options, probability),
    right: buildTreeNode(split.right, featureNames, depth + 1, options, probability),
  };
}

function trainRandomForest(dataset, options) {
  const featureNames = collectFeatureNames(dataset.vectors);
  const rng = createRng(options.seed);
  const defaultValue = average(dataset.labels);
  const trees = [];
  for (let treeIndex = 0; treeIndex < options.treeCount; treeIndex += 1) {
    const sampledFeatures = sampleFeatures(featureNames, Math.max(3, Math.ceil(Math.sqrt(featureNames.length))), rng);
    const samples = Array.from({ length: dataset.vectors.length }, () => {
      const sampleIndex = Math.floor(rng() * dataset.vectors.length);
      return { vector: dataset.vectors[sampleIndex], label: dataset.labels[sampleIndex] };
    });
    trees.push(buildTreeNode(samples, sampledFeatures, 0, options, defaultValue));
  }
  return { trees, defaultValue };
}

function trainGradientBoostedTrees(dataset, options) {
  const model = {
    baseValue: average(dataset.labels),
    learningRate: options.learningRate,
    trees: [],
  };
  let predictions = dataset.labels.map(() => model.baseValue);
  for (let round = 0; round < options.rounds; round += 1) {
    const residualSet = {
      vectors: dataset.vectors,
      labels: dataset.labels.map((label, index) => clamp(label - predictions[index], -0.5, 0.5)),
    };
    const tree = trainDecisionTree(residualSet, {
      maxDepth: options.maxDepth,
      minSamples: options.minSamples,
    });
    model.trees.push(tree);
    predictions = predictions.map((prediction, index) => prediction + options.learningRate * predictTreeProbability(tree, dataset.vectors[index]));
  }
  return model;
}

function bestSplit(samples, featureNames, minSamples) {
  let best = null;
  const parentImpurity = gini(samples);
  for (const feature of featureNames) {
    const values = [...new Set(samples.map((sample) => sample.vector.get(feature) || 0).sort((a, b) => a - b))];
    if (values.length <= 1) continue;
    const thresholds = candidateThresholds(values);
    for (const threshold of thresholds) {
      const left = [];
      const right = [];
      for (const sample of samples) {
        if ((sample.vector.get(feature) || 0) <= threshold) left.push(sample);
        else right.push(sample);
      }
      if (left.length < minSamples || right.length < minSamples) continue;
      const weightedImpurity = (left.length / samples.length) * gini(left) + (right.length / samples.length) * gini(right);
      const gain = parentImpurity - weightedImpurity;
      if (!best || gain > best.gain) best = { feature, threshold, gain, left, right };
    }
  }
  return best;
}

function candidateThresholds(values) {
  if (values.length <= 12) {
    return values.slice(0, -1).map((value, index) => (value + values[index + 1]) / 2);
  }
  const thresholds = [];
  for (let bucket = 1; bucket <= 10; bucket += 1) {
    const index = Math.floor((bucket / 11) * (values.length - 1));
    const nextIndex = Math.min(values.length - 1, index + 1);
    if (values[index] !== values[nextIndex]) thresholds.push((values[index] + values[nextIndex]) / 2);
  }
  return [...new Set(thresholds)];
}

function gini(samples) {
  const positiveRate = average(samples.map((sample) => sample.label));
  return 1 - positiveRate ** 2 - (1 - positiveRate) ** 2;
}

function collectFeatureNames(vectors) {
  const names = new Set();
  for (const vector of vectors) {
    for (const feature of vector.keys()) names.add(feature);
  }
  return [...names];
}

function evaluateModel(dataset, predictor) {
  const probabilities = dataset.vectors.map((vector) => predictor(vector));
  return classificationMetrics(dataset.labels, probabilities);
}

function evaluateConstantBaseline(dataset, constantClass, probability) {
  const probabilities = dataset.labels.map(() => probability);
  const metrics = classificationMetrics(dataset.labels, probabilities);
  const accuracy = dataset.labels.filter((label) => label === constantClass).length / dataset.labels.length;
  return { ...metrics, accuracy: round3(accuracy) };
}

function evaluateExamples(examples, targetName, predictor) {
  const labels = examples.map((example) => (getTarget(example, targetName) ? 1 : 0));
  const probabilities = examples.map((example) => predictor(example));
  return classificationMetrics(labels, probabilities);
}

function evaluateRegressionModel(dataset, predictor) {
  const predictions = dataset.vectors.map((vector) => predictor(vector));
  return regressionMetrics(dataset.labels, predictions);
}

function evaluateRegressionConstant(dataset, value) {
  return regressionMetrics(dataset.labels, dataset.labels.map(() => value));
}

function evaluateRegressionExamples(examples, targetName, predictor) {
  const labels = examples.map((example) => getTargetValue(example, targetName));
  const predictions = examples.map((example) => predictor(example));
  return regressionMetrics(labels, predictions);
}

function classificationMetrics(labels, probabilities) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let logLoss = 0;
  let brier = 0;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const probability = clamp(probabilities[index], 1e-6, 1 - 1e-6);
    const predicted = probability >= 0.5 ? 1 : 0;

    if (label === 1 && predicted === 1) tp += 1;
    else if (label === 0 && predicted === 0) tn += 1;
    else if (label === 0 && predicted === 1) fp += 1;
    else fn += 1;

    logLoss += -(label * Math.log(probability) + (1 - label) * Math.log(1 - probability));
    brier += (probability - label) ** 2;
  }

  const accuracy = (tp + tn) / labels.length;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    accuracy: round3(accuracy),
    precision: round3(precision),
    recall: round3(recall),
    f1: round3(f1),
    logLoss: round3(logLoss / labels.length),
    brier: round3(brier / labels.length),
  };
}

function regressionMetrics(labels, predictions) {
  const labelMean = average(labels);
  let squaredError = 0;
  let absoluteError = 0;
  let totalVariance = 0;
  for (let index = 0; index < labels.length; index += 1) {
    const prediction = predictions[index];
    const label = labels[index];
    squaredError += (prediction - label) ** 2;
    absoluteError += Math.abs(prediction - label);
    totalVariance += (label - labelMean) ** 2;
  }
  const mse = squaredError / labels.length;
  return {
    rmse: round3(Math.sqrt(mse)),
    mae: round3(absoluteError / labels.length),
    r2: round3(totalVariance > 0 ? 1 - squaredError / totalVariance : 0),
  };
}

function predictProbability(model, vector) {
  return sigmoid(scoreVector(model.weights, model.bias, vector));
}

function predictLinearValue(model, vector) {
  return clamp(scoreVector(model.weights, model.bias, vector), -0.6, 0.8);
}

function predictTreeProbability(node, vector) {
  if (node.leaf) return node.probability;
  return (vector.get(node.feature) || 0) <= node.threshold
    ? predictTreeProbability(node.left, vector)
    : predictTreeProbability(node.right, vector);
}

function predictForestValue(model, vector) {
  if (!model.trees.length) return model.defaultValue;
  return average(model.trees.map((tree) => predictTreeProbability(tree, vector)));
}

function predictBoostedValue(model, vector) {
  let prediction = model.baseValue;
  for (const tree of model.trees) prediction += model.learningRate * predictTreeProbability(tree, vector);
  return prediction;
}

function scoreVector(weights, bias, vector) {
  let score = bias;
  for (const [feature, value] of vector.entries()) score += (weights.get(feature) || 0) * value;
  return score;
}

function sigmoid(value) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

function topWeights(model, vocabulary, countValue, direction) {
  const decoded = [];
  const categoricalLookup = new Map([...vocabulary.entries()].map(([feature, index]) => [`cat:${index}`, feature]));
  for (const [feature, weight] of model.weights.entries()) {
    decoded.push({ feature: categoricalLookup.get(feature) || feature.replace(/^num:/, ""), weight: round3(weight) });
  }
  decoded.sort((left, right) => direction === "positive" ? right.weight - left.weight : left.weight - right.weight);
  return decoded.slice(0, countValue);
}

function describeTree(node, vocabulary, limit) {
  const categoricalLookup = new Map([...vocabulary.entries()].map(([feature, index]) => [`cat:${index}`, feature]));
  const lines = [];
  walkTree(node, 0, []);
  return lines.slice(0, limit);

  function walkTree(current, depth, path) {
    if (!current || lines.length >= limit) return;
    if (current.leaf) {
      lines.push(`${"  ".repeat(depth)}leaf p=${current.probability} n=${current.samples}${path.length ? ` if ${path.join(" and ")}` : ""}`);
      return;
    }
    const feature = categoricalLookup.get(current.feature) || current.feature.replace(/^num:/, "");
    lines.push(`${"  ".repeat(depth)}${feature} <= ${round3(current.threshold)} (n=${current.samples}, p=${current.probability})`);
    walkTree(current.left, depth + 1, [...path, `${feature} <= ${round3(current.threshold)}`]);
    walkTree(current.right, depth + 1, [...path, `${feature} > ${round3(current.threshold)}`]);
  }
}

function printMetrics(label, metrics) {
  if ("rmse" in metrics) {
    console.log(`  ${label}: rmse=${metrics.rmse} mae=${metrics.mae} r2=${metrics.r2}`);
    return;
  }
  console.log(`  ${label}: accuracy=${metrics.accuracy} precision=${metrics.precision} recall=${metrics.recall} f1=${metrics.f1} logLoss=${metrics.logLoss} brier=${metrics.brier}`);
}

function signedDelta(value) {
  const rounded = round3(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function shuffle(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function shuffleIndices(length, rng) {
  const indices = Array.from({ length }, (_, index) => index);
  return shuffle(indices, rng);
}

function sampleFeatures(values, count, rng) {
  return shuffle(values, rng).slice(0, Math.min(count, values.length));
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
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanNestedRecord(record, key) {
  const values = Object.values(record || {})
    .map((value) => (value && typeof value === "object" ? toNumber(value[key]) : 0))
    .filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function isRegressionTarget(targetName) {
  return targetName === "confidence_delta";
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
