/*
Usage:
  node scripts/seed-synthetic-recovery-data.mjs
  node scripts/seed-synthetic-recovery-data.mjs --count 120 --seed 42 --reset

What it does:
  - Inserts synthetic `study_recovery` reasoning runs.
  - Produces a mix of recovered/failed outcomes, misconception labels, confidence deltas, and tutoring strategies.
  - Can optionally delete existing synthetic runs first via `--reset`.
*/

import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MISCONCEPTION_CATEGORIES = [
  "ARITHMETIC_ERROR",
  "CONCEPTUAL_CONFUSION",
  "SIGN_ERROR",
  "UNIT_ERROR",
  "SKIPPED_STEP",
  "FALSE_ASSUMPTION",
  "OVERGENERALIZATION",
  "MEMORIZATION_FAILURE",
];

const STRATEGY_TEMPLATES = [
  {
    strategyType: "targeted_hint",
    label: "Targeted Hint",
    hint: "Surface the next missing inference without revealing the full answer.",
    rationale: "Useful when the student has partial structure but is stuck on one local gap.",
  },
  {
    strategyType: "worked_example",
    label: "Worked Example",
    hint: "Show one similar solved example and map it back to the current problem.",
    rationale: "Useful when the student needs a complete reference trajectory.",
  },
  {
    strategyType: "concept_reframe",
    label: "Concept Reframe",
    hint: "Re-explain the core idea from a different angle before retrying the problem.",
    rationale: "Useful for conceptual confusion or false assumptions.",
  },
  {
    strategyType: "error_localization",
    label: "Error Localization",
    hint: "Point to the exact step where the answer stopped matching the underlying rule.",
    rationale: "Useful for arithmetic, sign, and unit mistakes.",
  },
  {
    strategyType: "retrieval_prompt",
    label: "Retrieval Prompt",
    hint: "Ask the learner to restate the key rule from memory before solving.",
    rationale: "Useful for memorization failures and shallow recall issues.",
  },
];

const TOPIC_TEMPLATES = [
  "fractions",
  "algebra",
  "photosynthesis",
  "stoichiometry",
  "kinematics",
  "cellular respiration",
  "probability",
  "electric circuits",
];

function parseArgs(argv) {
  const out = { count: 120, seed: 7, reset: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--count" && argv[index + 1]) out.count = Math.max(1, Math.min(5000, Number(argv[++index]) || out.count));
    else if (arg === "--seed" && argv[index + 1]) out.seed = Number(argv[++index]) || out.seed;
    else if (arg === "--reset") out.reset = true;
    else if (arg === "--help" || arg === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log([
    "seed-synthetic-recovery-data.mjs",
    "",
    "Options:",
    "  --count <n>   Number of synthetic study_recovery runs to insert (default: 120)",
    "  --seed <n>    Deterministic RNG seed (default: 7)",
    "  --reset       Delete previously generated synthetic study_recovery runs first",
    "",
    "Example:",
    "  node scripts/seed-synthetic-recovery-data.mjs --count 200 --seed 13 --reset",
  ].join("\n"));
  process.exit(0);
}

try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const deck = await prisma.deck.findFirst({ select: { id: true, title: true } });
  const rng = createRng(args.seed);

  if (args.reset) {
    const deleted = await prisma.reasoningRun.deleteMany({
      where: { mode: "study_recovery", origin: "synthetic_seed" },
    });
    console.log(`Deleted ${deleted.count} prior synthetic study_recovery runs`);
  }

  const rows = Array.from({ length: args.count }, (_, index) => buildSyntheticRun({
    index,
    rng,
    userId: user?.id,
    deckId: deck?.id,
    deckTitle: deck?.title || "Synthetic Deck",
  }));

  const inserted = await prisma.reasoningRun.createMany({ data: rows });
  const recoveredCount = rows.filter((row) => row.metadata?.recovered === true).length;
  const stabilizedCount = rows.filter((row) => row.metadata?.stabilized === true).length;
  const avgConfidenceDelta = round3(rows.reduce((sum, row) => sum + toNumber(row.metadata?.confidenceDelta), 0) / rows.length);

  console.log(`Inserted ${inserted.count} synthetic study_recovery runs`);
  console.log(`Attached user: ${user?.id || "none"}`);
  console.log(`Attached deck: ${deck?.id || "none"}`);
  console.log(`Recovered: ${recoveredCount}/${rows.length}`);
  console.log(`Stabilized: ${stabilizedCount}/${rows.length}`);
  console.log(`Average confidence delta: ${avgConfidenceDelta}`);
} finally {
  await prisma.$disconnect();
}

function buildSyntheticRun({ index, rng, userId, deckId, deckTitle }) {
  const topic = pick(TOPIC_TEMPLATES, rng);
  const primaryMisconception = weightedPick(MISCONCEPTION_CATEGORIES, rng, [0.13, 0.17, 0.14, 0.11, 0.14, 0.11, 0.08, 0.12]);
  const secondaryMisconception = rng() < 0.32 ? pick(MISCONCEPTION_CATEGORIES.filter((value) => value !== primaryMisconception), rng) : null;
  const misconceptionSignals = [primaryMisconception, secondaryMisconception].filter(Boolean);
  const profile = buildStudentProfile({ topic, primaryMisconception, misconceptionSignals, rng });
  const priorConfidence = profile.priorConfidence;
  const weakTopicMatches = buildWeakTopicMatches(topic, profile, rng);
  const createdAt = new Date(Date.now() - (index * 37 + Math.floor(rng() * 31)) * 60_000);
  const confidenceProfile = buildConfidenceProfile(topic, priorConfidence, profile, weakTopicMatches, rng);
  const retentionProfile = buildRetentionProfile(topic, profile, weakTopicMatches, rng);
  const candidateStrategies = buildCandidateStrategiesForScenario(primaryMisconception, profile, rng);
  const candidateOutcomes = candidateStrategies.map((candidate) => {
    const candidateOutcome = decideOutcome({ primaryMisconception, misconceptionSignals, strategy: candidate, profile, rng });
    const candidatePostReviewConfidence = computePostReviewConfidence(priorConfidence, candidateOutcome, rng);
    return {
      strategyId: candidate.id,
      strategyType: candidate.strategyType,
      label: candidate.label,
      heuristicScore: candidate.score,
      heuristicConfidence: candidate.confidence,
      recovered: candidateOutcome.recovered,
      stabilized: candidateOutcome.stabilized,
      postReviewConfidence: candidatePostReviewConfidence,
      confidenceDelta: round3(candidatePostReviewConfidence - priorConfidence),
    };
  });
  const worldModelCandidateTransitions = candidateStrategies.map((candidate) => {
    const candidateOutcome = candidateOutcomes.find((item) => item.strategyId === candidate.id);
    const projectedConfidenceDelta = round3(toNumber(candidateOutcome?.confidenceDelta));
    const projectedRecoveryProbability = round3(clamp(
      candidateOutcome?.recovered
        ? 0.58 + rng() * 0.28
        : 0.18 + rng() * 0.3,
      0,
      1,
    ));
    const projectedStabilityGain = round3(clamp(
      candidateOutcome?.stabilized
        ? 0.56 + rng() * 0.28
        : candidateOutcome?.recovered
          ? 0.34 + rng() * 0.22
          : 0.12 + rng() * 0.22,
      0,
      1,
    ));
    const projectedLowConfidenceRisk = round3(clamp(
      (1 - priorConfidence) * 0.55 + (1 - profile.retentionStrength) * 0.2 + (1 - projectedRecoveryProbability) * 0.25,
      0,
      1,
    ));
    return {
      strategyId: candidate.id,
      projectedConfidenceDelta,
      projectedRecoveryProbability,
      projectedStabilityGain,
      projectedLowConfidenceRisk,
      projectedNextWeakTopics: projectedStabilityGain >= 0.58 ? weakTopicMatches.slice(1) : weakTopicMatches,
      projectedNextMisconceptions: projectedRecoveryProbability >= 0.62 ? misconceptionSignals.slice(1) : misconceptionSignals,
      explanation: buildSyntheticWorldModelExplanation({
        candidate,
        topic,
        primaryMisconception,
        projectedRecoveryProbability,
        projectedStabilityGain,
      }),
    };
  });
  const heuristicWinner = candidateStrategies
    .map((candidate) => ({ candidate, outcome: candidateOutcomes.find((item) => item.strategyId === candidate.id) }))
    .sort((left, right) => right.candidate.score - left.candidate.score || right.candidate.confidence - left.candidate.confidence)[0];
  const strategy = heuristicWinner.candidate;
  const selectedOutcome = heuristicWinner.outcome;
  const outcome = {
    recovered: selectedOutcome?.recovered === true,
    stabilized: selectedOutcome?.stabilized === true,
  };
  const rating = outcome.recovered ? (outcome.stabilized ? "easy" : "good") : "again";
  const postReviewConfidence = toNumber(selectedOutcome?.postReviewConfidence);
  const confidenceDelta = toNumber(selectedOutcome?.confidenceDelta);
  const recentFailures = buildRecentFailures(topic, misconceptionSignals, profile.failureStreak, rng);
  const recentSuccesses = buildRecentSuccesses(topic, outcome.recovered, profile.mastery, rng);
  const strategyHistory = buildStrategyHistory(strategy.strategyType, profile, rng);
  const oracleBestOutcome = [...candidateOutcomes].sort((left, right) => right.confidenceDelta - left.confidenceDelta || Number(right.stabilized) - Number(left.stabilized))[0] || null;
  const selectedWorldModelTransition = worldModelCandidateTransitions.find((item) => item.strategyId === strategy.id) || worldModelCandidateTransitions[0] || null;

  return {
    userId,
    deckId,
    mode: "study_recovery",
    origin: "synthetic_seed",
    title: `Synthetic recovery outcome for ${deckTitle}`,
    prompt: `Student is solving a ${topic} problem and needs recovery support after a ${humanize(primaryMisconception)}.`.slice(0, 4000),
    finalAnswer: outcome.recovered
      ? "Student recovered after coaching and completed the card."
      : "Student remained unstable after coaching and marked the card again.",
    reasoning: outcome.recovered
      ? `${strategy.label} improved performance enough to continue the study flow.`
      : `${strategy.label} did not resolve the misconception strongly enough to stabilize recall.`,
    confidence: postReviewConfidence,
    trajectoryScore: outcome.stabilized ? round3(0.72 + rng() * 0.2) : outcome.recovered ? round3(0.45 + rng() * 0.2) : round3(0.12 + rng() * 0.18),
    searchDepth: 1,
    candidatesSelected: 1,
    verificationApplied: true,
    metadata: {
      synthetic: true,
      cardId: `synthetic-card-${index + 1}`,
      rating,
      recovered: outcome.recovered,
      stabilized: outcome.stabilized,
      priorConfidence,
      postReviewConfidence,
      confidenceDelta,
      misconceptionSignals,
      weakTopicMatches,
      studentState: {
        weakConcepts: buildWeakConcepts(weakTopicMatches, primaryMisconception, rng),
        misconceptionPatterns: misconceptionSignals,
        confidenceProfile,
        retentionProfile,
        pacingProfile: {
          preferredSpeed: profile.pacingPreference,
          fatigueBand: fatigueBand(profile.fatigueLevel),
          confidenceVolatilityBand: volatilityBand(profile.confidenceVolatility),
          frustrationBand: frustrationBand(profile.frustrationLevel),
        },
        preferredExplanationStyle: profile.preferredExplanationStyle,
        recentFailures,
        recentSuccesses,
      },
      studentAnswer: syntheticStudentAnswer(topic, primaryMisconception, outcome.recovered, profile),
      expectedAnswer: `Correct ${topic} explanation with the missing step explicitly shown.`,
      verification: {
        confidence: priorConfidence,
        final_answer: outcome.recovered ? "Partially correct after tutoring" : "Still incorrect after tutoring",
        reasoning: `The initial response exhibited ${humanize(primaryMisconception)} before intervention.`,
      },
      selectedStrategy: {
        id: `synthetic-${strategy.strategyType}`,
        label: strategy.label,
        hint: strategy.hint,
        rationale: strategy.rationale,
        score: strategy.score,
        confidence: strategy.confidence,
        strategyType: strategy.strategyType,
      },
      candidateStrategies: candidateStrategies.map((candidate) => ({
        id: `synthetic-${candidate.strategyType}`,
        label: candidate.label,
        hint: candidate.hint,
        rationale: candidate.rationale,
        score: candidate.score,
        confidence: candidate.confidence,
        strategyType: candidate.strategyType,
        noveltyScore: candidate.noveltyScore,
        misconceptionAlignment: candidate.misconceptionAlignment,
        cognitiveLoad: candidate.cognitiveLoad,
        hintGranularity: candidate.hintGranularity,
        priorLocalSuccessRate: candidate.priorLocalSuccessRate,
        estimatedSteps: candidate.estimatedSteps,
        strategyMode: candidate.strategyMode,
        selected: candidate.id === strategy.id,
      })),
      oracleStrategyOutcomes: candidateOutcomes,
      worldModel: {
        version: "world_model_shadow_v1",
        currentState: {
          weakTopics: weakTopicMatches,
          activeMisconceptions: misconceptionSignals,
          overallConfidence: priorConfidence,
          retentionStrength: profile.retentionStrength,
          lowConfidenceRisk: round3(clamp((1 - priorConfidence) * 0.7 + (1 - profile.retentionStrength) * 0.3, 0, 1)),
        },
        selectedTransition: selectedWorldModelTransition,
        candidateTransitions: worldModelCandidateTransitions,
      },
      heuristicPolicy: {
        policyVersion: "synthetic_v1",
        selectedStrategyId: strategy.id,
        selectedStrategyType: strategy.strategyType,
        selectedScore: strategy.score,
      },
      oracleBestStrategy: oracleBestOutcome,
      longitudinalState: {
        confidenceVolatility: profile.confidenceVolatility,
        frustrationLevel: profile.frustrationLevel,
        misconceptionPersistence: profile.misconceptionPersistence,
        priorRecoveryRate: profile.priorRecoveryRate,
        recentStrategySuccessRate: profile.recentStrategySuccessRate,
        recentStrategyCounts: strategyHistory,
      },
    },
    createdAt,
  };
}

function decideOutcome({ primaryMisconception, misconceptionSignals, strategy, profile, rng }) {
  const strategyFit = scoreStrategyFit(primaryMisconception, strategy.strategyType, profile);
  const misconceptionDifficulty = {
    ARITHMETIC_ERROR: 0.06,
    CONCEPTUAL_CONFUSION: -0.12,
    SIGN_ERROR: 0.03,
    UNIT_ERROR: -0.01,
    SKIPPED_STEP: -0.02,
    FALSE_ASSUMPTION: -0.15,
    OVERGENERALIZATION: -0.1,
    MEMORIZATION_FAILURE: -0.04,
  }[primaryMisconception] || 0;

  const recoveryScore =
    -0.09 +
    (profile.priorConfidence - 0.4) * 1.3 +
    (profile.retentionStrength - 0.45) * 0.95 +
    (profile.transferSkill - 0.5) * 0.7 +
    (profile.mastery - 0.45) * 0.85 +
    (0.52 - profile.topicDifficulty) * 0.9 +
    (0.5 - profile.fatigueLevel) * 0.7 +
    (0.45 - profile.failureStreak / 5) * 1.2 +
    (profile.priorRecoveryRate - 0.42) * 0.9 +
    (profile.recentStrategySuccessRate - 0.45) * 0.85 +
    (0.45 - profile.confidenceVolatility) * 0.95 +
    (0.48 - profile.frustrationLevel) * 1.05 +
    (0.4 - profile.misconceptionPersistence) * 0.9 +
    (strategy.misconceptionAlignment - 0.5) * 0.8 +
    (strategy.priorLocalSuccessRate - 0.45) * 0.7 +
    (0.56 - strategy.cognitiveLoad) * 0.65 +
    (strategy.hintGranularity - 0.5) * (profile.priorConfidence < 0.26 ? 0.55 : 0.24) +
    (strategy.strategyMode === "reinforcement" ? 0.08 : strategy.strategyMode === "repair" ? 0.03 : -0.02) +
    (strategy.strategyMode === "exploration" && profile.misconceptionPersistence > 0.62 ? 0.07 : 0) +
    (strategy.estimatedSteps > 3 && profile.fatigueLevel > 0.58 ? -0.12 : 0) +
    strategyFit * 1.05 +
    misconceptionDifficulty -
    Math.max(0, misconceptionSignals.length - 1) * 0.2 +
    (profile.failureStreak >= 3 && profile.confidenceVolatility > 0.58 ? -0.28 : 0) +
    (profile.recentStrategySuccessRate < 0.3 && strategyFit < 0.05 ? -0.18 : 0) +
    (profile.priorRecoveryRate > 0.62 && profile.frustrationLevel < 0.35 ? 0.12 : 0) +
    (profile.preferredExplanationStyle === preferredExplanationStyle(primaryMisconception) ? 0.08 : -0.04) +
    jitter(rng, 0.32);

  const stabilizedScore =
    recoveryScore -
    0.1 +
    (profile.retentionStrength - 0.5) * 1.05 +
    (profile.mastery - 0.5) * 0.75 +
    (profile.failureStreak >= 3 ? -0.25 : 0.08) +
    (0.42 - profile.confidenceVolatility) * 0.75 +
    (0.4 - profile.frustrationLevel) * 0.6 +
    (profile.priorRecoveryRate > 0.58 ? 0.08 : -0.04) +
    (strategy.priorLocalSuccessRate - 0.5) * 0.4 +
    (0.55 - strategy.cognitiveLoad) * 0.35 +
    (strategy.hintGranularity - 0.48) * 0.18 +
    (strategyFit > 0.15 ? 0.16 : -0.08) +
    jitter(rng, 0.2);

  const recovered = rng() < sigmoid(recoveryScore);
  const stabilized = recovered && rng() < sigmoid(stabilizedScore);
  return { recovered, stabilized };
}

function computePostReviewConfidence(priorConfidence, outcome, rng) {
  if (!outcome.recovered) return round3(clamp(priorConfidence - (0.07 + rng() * 0.18), 0.05, 0.46));
  if (outcome.stabilized) return round3(clamp(priorConfidence + 0.22 + rng() * 0.2, 0.58, 0.96));
  return round3(clamp(priorConfidence + 0.05 + rng() * 0.18, 0.32, 0.86));
}

function buildSyntheticWorldModelExplanation({ candidate, topic, primaryMisconception, projectedRecoveryProbability, projectedStabilityGain }) {
  const misconception = humanize(primaryMisconception).toLowerCase();
  if (projectedRecoveryProbability >= 0.68) {
    return `${candidate.label} is projected to recover ${topic} well because it matches ${misconception} without overloading the learner.`;
  }
  if (projectedStabilityGain >= 0.52) {
    return `${candidate.label} is projected to stabilize ${topic}, but another revisit may still be needed before ${misconception} fully clears.`;
  }
  return `${candidate.label} may keep progress moving, but low-confidence risk remains elevated around ${topic}.`;
}

function buildCandidateStrategiesForScenario(misconception, profile, rng) {
  const preferredTypes = {
    ARITHMETIC_ERROR: ["error_localization", "targeted_hint"],
    CONCEPTUAL_CONFUSION: ["concept_reframe", "worked_example"],
    SIGN_ERROR: ["error_localization", "targeted_hint"],
    UNIT_ERROR: ["error_localization", "worked_example"],
    SKIPPED_STEP: ["targeted_hint", "worked_example"],
    FALSE_ASSUMPTION: ["concept_reframe", "worked_example"],
    OVERGENERALIZATION: ["concept_reframe", "targeted_hint"],
    MEMORIZATION_FAILURE: ["retrieval_prompt", "worked_example"],
  }[misconception] || ["targeted_hint"];

  return STRATEGY_TEMPLATES.map((template) => {
    const fit = scoreStrategyFit(misconception, template.strategyType, profile);
    const preferredBonus = preferredTypes.includes(template.strategyType) ? 0.05 : -0.01;
    const priorLocalSuccessRate = strategySpecificSuccess(misconception, template.strategyType, profile, rng);
    const noveltyScore = round3(clamp(0.72 - priorLocalSuccessRate + jitter(rng, 0.08), 0.05, 0.95));
    const hintGranularity = round3(strategyHintGranularity(template.strategyType));
    const cognitiveLoad = round3(clamp(
      strategyCognitiveLoad(template.strategyType) +
        profile.fatigueLevel * 0.16 +
        Math.max(0, 0.35 - profile.priorConfidence) * 0.2 -
        hintGranularity * 0.14 +
        jitter(rng, 0.08),
      0.08,
      0.95,
    ));
    const estimatedSteps = strategyEstimatedSteps(template.strategyType, misconception);
    const misconceptionAlignment = round3(clamp(0.5 + fit + preferredBonus * 0.6 + jitter(rng, 0.04), 0.05, 0.95));
    const strategyMode = inferStrategyMode({ priorLocalSuccessRate, noveltyScore, profile, strategyType: template.strategyType });
    return {
      ...template,
      id: `synthetic-${template.strategyType}`,
      score: round3(clamp(0.48 + preferredBonus + fit * 0.28 + jitter(rng, 0.12), 0.18, 0.94)),
      confidence: round3(clamp(0.42 + preferredBonus * 0.6 + fit * 0.22 + profile.priorConfidence * 0.18 + jitter(rng, 0.08), 0.14, 0.95)),
      noveltyScore,
      misconceptionAlignment,
      cognitiveLoad,
      hintGranularity,
      priorLocalSuccessRate,
      estimatedSteps,
      strategyMode,
    };
  });
}

function strategySpecificSuccess(misconception, strategyType, profile, rng) {
  const fit = scoreStrategyFit(misconception, strategyType, profile);
  return round3(clamp(
    profile.recentStrategySuccessRate +
      fit * 0.35 +
      (profile.priorRecoveryRate - 0.5) * 0.18 -
      profile.misconceptionPersistence * 0.08 +
      jitter(rng, 0.09),
    0.04,
    0.96,
  ));
}

function strategyHintGranularity(strategyType) {
  return {
    targeted_hint: 0.86,
    error_localization: 0.8,
    worked_example: 0.58,
    concept_reframe: 0.42,
    retrieval_prompt: 0.48,
  }[strategyType] || 0.5;
}

function strategyCognitiveLoad(strategyType) {
  return {
    targeted_hint: 0.34,
    error_localization: 0.38,
    worked_example: 0.56,
    concept_reframe: 0.52,
    retrieval_prompt: 0.28,
  }[strategyType] || 0.45;
}

function strategyEstimatedSteps(strategyType, misconception) {
  const base = {
    targeted_hint: 2,
    error_localization: 2,
    worked_example: 4,
    concept_reframe: 3,
    retrieval_prompt: 1,
  }[strategyType] || 2;
  return base + (misconception === "CONCEPTUAL_CONFUSION" || misconception === "FALSE_ASSUMPTION" ? 1 : 0);
}

function inferStrategyMode({ priorLocalSuccessRate, noveltyScore, profile, strategyType }) {
  if (priorLocalSuccessRate > 0.62 && noveltyScore < 0.4) return "reinforcement";
  if (noveltyScore > 0.62 || (strategyType === "concept_reframe" && profile.misconceptionPersistence > 0.65)) return "exploration";
  return "repair";
}

function syntheticStudentAnswer(topic, misconception, recovered, profile) {
  if (recovered) {
    return `I corrected the ${humanize(misconception).toLowerCase()} and can now explain the ${topic} step more clearly after slowing down and checking the missing inference.`;
  }
  return `I am still mixing up the ${topic} rule because of a ${humanize(misconception).toLowerCase()}, especially after ${profile.failureStreak} recent misses on similar cards.`;
}

function buildStudentProfile({ topic, primaryMisconception, misconceptionSignals, rng }) {
  const topicDifficulty = round3(0.28 + rng() * 0.52);
  const retentionStrength = round3(clamp(0.2 + rng() * 0.62 - topicDifficulty * 0.18, 0.08, 0.92));
  const transferSkill = round3(clamp(0.24 + rng() * 0.58, 0.08, 0.94));
  const fatigueLevel = round3(clamp(rng() ** 1.4, 0, 0.96));
  const failureStreak = weightedPick([0, 1, 2, 3, 4], rng, [0.14, 0.25, 0.25, 0.22, 0.14]);
  const confidenceVolatility = round3(clamp(0.12 + rng() * 0.7 + failureStreak * 0.05 - retentionStrength * 0.12, 0.04, 0.96));
  const frustrationLevel = round3(clamp(0.1 + rng() * 0.58 + failureStreak * 0.08 + fatigueLevel * 0.12, 0.04, 0.96));
  const misconceptionPersistence = round3(clamp(0.12 + rng() * 0.54 + Math.max(0, misconceptionSignals.length - 1) * 0.12 + failureStreak * 0.05, 0.05, 0.94));
  const priorRecoveryRate = round3(clamp(0.16 + rng() * 0.58 + retentionStrength * 0.12 - frustrationLevel * 0.14, 0.04, 0.92));
  const recentStrategySuccessRate = round3(clamp(0.14 + rng() * 0.56 + transferSkill * 0.1 - misconceptionPersistence * 0.12, 0.04, 0.9));
  const priorConfidence = round3(clamp(
    0.18 +
    retentionStrength * 0.38 +
    transferSkill * 0.24 -
    topicDifficulty * 0.19 -
    failureStreak * 0.05 -
    confidenceVolatility * 0.06 -
    frustrationLevel * 0.08 -
    Math.max(0, misconceptionSignals.length - 1) * 0.04 +
    jitter(rng, 0.08),
    0.08,
    0.86,
  ));
  const mastery = round3(clamp(
    priorConfidence * 0.55 + retentionStrength * 0.3 + transferSkill * 0.2 - fatigueLevel * 0.12 + jitter(rng, 0.05),
    0.06,
    0.93,
  ));

  return {
    topic,
    topicDifficulty,
    retentionStrength,
    transferSkill,
    fatigueLevel,
    confidenceVolatility,
    frustrationLevel,
    misconceptionPersistence,
    priorRecoveryRate,
    recentStrategySuccessRate,
    failureStreak,
    priorConfidence,
    mastery,
    pacingPreference: fatigueLevel > 0.6 || topicDifficulty > 0.62 ? "slow" : rng() < 0.5 ? "moderate" : "reflective",
    preferredExplanationStyle: preferredExplanationStyle(primaryMisconception, mastery, retentionStrength),
  };
}

function buildWeakTopicMatches(topic, profile, rng) {
  const related = TOPIC_TEMPLATES.filter((value) => value !== topic);
  const matches = [topic];
  if (profile.failureStreak >= 2 || profile.topicDifficulty > 0.58 || rng() < 0.42) matches.push(`${topic}-review`);
  if (profile.transferSkill < 0.42 || rng() < 0.24) matches.push(pick(related, rng));
  return unique(matches);
}

function buildWeakConcepts(weakTopicMatches, misconception, rng) {
  const concepts = [...weakTopicMatches];
  if (rng() < 0.48) concepts.push(`${humanize(misconception)}-repair`);
  return unique(concepts);
}

function buildRecentFailures(topic, misconceptionSignals, failureStreak, rng) {
  const total = Math.max(1, failureStreak + 1 + Math.floor(rng() * 2));
  return Array.from({ length: total }, (_, index) => `${topic}:${misconceptionSignals[index % misconceptionSignals.length] || misconceptionSignals[0]}`);
}

function buildRecentSuccesses(topic, recovered, mastery, rng) {
  if (!recovered && mastery < 0.48) return [];
  const total = recovered ? 1 + Math.floor(rng() * 2) : rng() < 0.35 ? 1 : 0;
  return Array.from({ length: total }, (_, index) => `${topic}:guided_recovery_${index + 1}`);
}

function buildStrategyHistory(currentStrategyType, profile, rng) {
  const history = {};
  for (const strategy of STRATEGY_TEMPLATES) {
    const attempts = Math.max(0, Math.round(rng() * 3 + (strategy.strategyType === currentStrategyType ? 1 : 0)));
    if (!attempts) continue;
    const successRate = round3(clamp(
      profile.recentStrategySuccessRate +
      (strategy.strategyType === currentStrategyType ? 0.08 : -0.04) +
      jitter(rng, 0.12),
      0.02,
      0.96,
    ));
    history[strategy.strategyType] = { attempts, successRate };
  }
  return history;
}

function buildConfidenceProfile(topic, priorConfidence, profile, weakTopicMatches, rng) {
  const profileMap = { [topic]: priorConfidence };
  for (const weakTopic of weakTopicMatches.slice(1)) {
    profileMap[weakTopic] = round3(clamp(priorConfidence - 0.05 - rng() * 0.16, 0.05, 0.82));
  }
  if (rng() < 0.45) {
    const strongerTopic = pick(TOPIC_TEMPLATES.filter((value) => !weakTopicMatches.includes(value)), rng);
    profileMap[strongerTopic] = round3(clamp(profile.mastery + 0.08 + rng() * 0.14, 0.18, 0.94));
  }
  return profileMap;
}

function buildRetentionProfile(topic, profile, weakTopicMatches, rng) {
  const profileMap = { [topic]: profile.retentionStrength };
  for (const weakTopic of weakTopicMatches.slice(1)) {
    profileMap[weakTopic] = round3(clamp(profile.retentionStrength - 0.06 - rng() * 0.18, 0.08, 0.86));
  }
  if (rng() < 0.38) {
    const stableTopic = pick(TOPIC_TEMPLATES.filter((value) => !weakTopicMatches.includes(value)), rng);
    profileMap[stableTopic] = round3(clamp(profile.retentionStrength + 0.08 + rng() * 0.18, 0.18, 0.95));
  }
  return profileMap;
}

function scoreStrategyFit(misconception, strategyType, profile) {
  const misconceptionFit = {
    targeted_hint: { SKIPPED_STEP: 0.26, SIGN_ERROR: 0.14, OVERGENERALIZATION: 0.1 },
    worked_example: { CONCEPTUAL_CONFUSION: 0.16, UNIT_ERROR: 0.12, SKIPPED_STEP: 0.08 },
    concept_reframe: { CONCEPTUAL_CONFUSION: 0.26, FALSE_ASSUMPTION: 0.24, OVERGENERALIZATION: 0.12 },
    error_localization: { ARITHMETIC_ERROR: 0.25, SIGN_ERROR: 0.24, UNIT_ERROR: 0.18 },
    retrieval_prompt: { MEMORIZATION_FAILURE: 0.28, CONCEPTUAL_CONFUSION: 0.05 },
  }[strategyType] || {};

  return clamp(
    (misconceptionFit[misconception] || -0.04) +
      (profile.priorConfidence < 0.24 && strategyType === "worked_example" ? 0.12 : 0) +
      (profile.transferSkill > 0.62 && strategyType === "targeted_hint" ? 0.08 : 0) +
      (profile.retentionStrength < 0.34 && strategyType === "retrieval_prompt" ? 0.06 : 0) +
      (profile.failureStreak >= 3 && strategyType === "concept_reframe" ? 0.08 : 0) +
      (profile.fatigueLevel > 0.66 && strategyType === "error_localization" ? -0.1 : 0),
    -0.28,
    0.36,
  );
}

function preferredExplanationStyle(misconception, mastery = 0.5, retentionStrength = 0.5) {
  if (mastery < 0.3) return "worked_example_first";
  if (retentionStrength < 0.28) return "recall_prompt";
  switch (misconception) {
    case "CONCEPTUAL_CONFUSION":
    case "FALSE_ASSUMPTION":
      return "analogy_first";
    case "MEMORIZATION_FAILURE":
      return "recall_prompt";
    default:
      return "step_by_step";
  }
}

function pick(values, rng) {
  return values[Math.floor(rng() * values.length)] || values[0];
}

function weightedPick(values, rng, weights) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = rng() * total;
  for (let index = 0; index < values.length; index += 1) {
    cursor -= weights[index] || 0;
    if (cursor <= 0) return values[index];
  }
  return values[values.length - 1];
}

function unique(values) {
  return [...new Set(values)];
}

function fatigueBand(value) {
  if (value >= 0.7) return "high";
  if (value >= 0.38) return "medium";
  return "low";
}

function volatilityBand(value) {
  if (value >= 0.68) return "high";
  if (value >= 0.34) return "medium";
  return "low";
}

function frustrationBand(value) {
  if (value >= 0.68) return "high";
  if (value >= 0.36) return "medium";
  return "low";
}

function humanize(value) {
  return String(value || "").toLowerCase().replace(/_/g, " ");
}

function jitter(rng, scale) {
  return (rng() - 0.5) * 2 * scale;
}

function sigmoid(value) {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

function createRng(seed) {
  let state = Math.floor(seed) || 1;
  return function next() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}