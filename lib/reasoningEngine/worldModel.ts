import fs from "node:fs";
import path from "node:path";
import {
  humanizeMisconceptionCategory,
  type MisconceptionCategory,
  type ReasoningResponse,
  type StudentKnowledgeState,
} from "@/lib/reasoningEngine/contracts";
import type { TutoringStrategy } from "@/lib/reasoningEngine/engine";

export type LearnerWorldState = {
  weakTopics: string[];
  activeMisconceptions: MisconceptionCategory[];
  overallConfidence: number;
  retentionStrength: number;
  lowConfidenceRisk: number;
};

export type WorldModelTransitionEstimate = {
  strategyId: string;
  projectedConfidenceDelta: number;
  projectedRecoveryProbability: number;
  projectedStabilityGain: number;
  projectedLowConfidenceRisk: number;
  projectedNextWeakTopics: string[];
  projectedNextMisconceptions: MisconceptionCategory[];
  explanation: string;
};

export type TutoringWorldModelEstimate = {
  version: string;
  source: "bounded_heuristic" | "lightzero_artifact";
  selectedPolicyLabel: string | null;
  currentState: LearnerWorldState;
  selectedTransition: WorldModelTransitionEstimate;
  candidateTransitions: WorldModelTransitionEstimate[];
};

type LightZeroWorldModelFeatureName =
  | "strategyConfidence"
  | "priorLocalSuccessRate"
  | "misconceptionAlignment"
  | "noveltyScore"
  | "lowCognitiveLoad"
  | "hintGranularity"
  | "overallConfidence"
  | "retentionStrength"
  | "lowConfidenceRisk"
  | "verificationConfidence"
  | "weakTopicCount"
  | "misconceptionCount";

type LightZeroLinearHead = {
  intercept: number;
  weights: Partial<Record<LightZeroWorldModelFeatureName, number>>;
  strategyModeBias?: Partial<Record<TutoringStrategy["strategyMode"], number>>;
  shortStepBias?: number;
  mediumStepBias?: number;
  longStepBias?: number;
};

export type LightZeroWorldModelArtifact = {
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: "lightzero_linear_world_model_v1";
  featureSchema: "tutoring_world_model_features_v1";
  sourceEvaluation?: {
    script?: string;
    checkpoint?: string;
    notes?: string;
  };
  heads: {
    projectedRecoveryProbability: LightZeroLinearHead;
    projectedConfidenceDelta: LightZeroLinearHead;
    projectedStabilityGain: LightZeroLinearHead;
    projectedLowConfidenceRisk: LightZeroLinearHead;
  };
};

let cachedArtifactPath: string | null | undefined;
let cachedArtifact: LightZeroWorldModelArtifact | null = null;
let cachedArtifactLoadError = false;

type BuildTutoringWorldModelInput = {
  prompt: string;
  studentAnswer: string;
  verification: ReasoningResponse;
  studentState?: StudentKnowledgeState;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
  strategies: TutoringStrategy[];
  selectedStrategyId: string;
};

export function buildTutoringWorldModel(input: BuildTutoringWorldModelInput): TutoringWorldModelEstimate {
  const currentState = buildCurrentState(input);
  const lightZeroArtifact = getLightZeroWorldModelArtifact();
  const candidateTransitions = input.strategies.map((strategy) =>
    estimateTransition({
      strategy,
      currentState,
      weakTopicMatches: input.weakTopicMatches,
      misconceptionSignals: input.misconceptionSignals,
      verification: input.verification,
      lightZeroArtifact,
    })
  );

  const selectedTransition = candidateTransitions.find((transition) => transition.strategyId === input.selectedStrategyId)
    || candidateTransitions[0]
    || {
      strategyId: input.selectedStrategyId,
      projectedConfidenceDelta: 0,
      projectedRecoveryProbability: 0,
      projectedStabilityGain: 0,
      projectedLowConfidenceRisk: currentState.lowConfidenceRisk,
      projectedNextWeakTopics: currentState.weakTopics,
      projectedNextMisconceptions: currentState.activeMisconceptions,
      explanation: "No candidate transition estimate was available.",
    };

  return {
    version: lightZeroArtifact?.policyVersion || "world_model_shadow_v1",
    source: lightZeroArtifact ? "lightzero_artifact" : "bounded_heuristic",
    selectedPolicyLabel: lightZeroArtifact?.selectedPolicyLabel || null,
    currentState,
    selectedTransition,
    candidateTransitions,
  };
}

function buildCurrentState(input: BuildTutoringWorldModelInput): LearnerWorldState {
  const overallConfidence = clampUnit(
    average([
      input.verification.confidence,
      average(Object.values(input.studentState?.confidenceByTopic || {})),
      average(Object.values(input.studentState?.retentionByTopic || {})),
    ])
  );

  const retentionStrength = clampUnit(average(Object.values(input.studentState?.retentionByTopic || {})));
  const lowConfidenceRisk = clampUnit((1 - overallConfidence) * 0.7 + (1 - retentionStrength) * 0.3);

  return {
    weakTopics: uniqueLimited([
      ...input.weakTopicMatches,
      ...(input.studentState?.weakTopics || []),
    ], 4),
    activeMisconceptions: uniqueLimited([
      ...input.misconceptionSignals,
      ...(input.studentState?.priorMistakes || []),
    ], 3),
    overallConfidence,
    retentionStrength,
    lowConfidenceRisk,
  };
}

function estimateTransition({
  strategy,
  currentState,
  weakTopicMatches,
  misconceptionSignals,
  verification,
}: {
  strategy: TutoringStrategy;
  currentState: LearnerWorldState;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
  verification: ReasoningResponse;
  lightZeroArtifact: LightZeroWorldModelArtifact | null;
}): WorldModelTransitionEstimate {
  if (lightZeroArtifact) {
    return estimateTransitionWithLightZeroArtifact({
      strategy,
      currentState,
      weakTopicMatches,
      misconceptionSignals,
      verification,
      lightZeroArtifact,
    });
  }

  const recoveryBase =
    strategy.priorLocalSuccessRate * 0.35 +
    strategy.misconceptionAlignment * 0.25 +
    (1 - strategy.cognitiveLoad) * 0.2 +
    strategy.confidence * 0.2;

  const strategyModeBoost =
    strategy.strategyMode === "repair"
      ? 0.08
      : strategy.strategyMode === "reinforcement"
        ? 0.05
        : 0.03;

  const projectedRecoveryProbability = clampUnit(recoveryBase + strategyModeBoost - currentState.lowConfidenceRisk * 0.15);
  const projectedConfidenceDelta = round3(
    clampSigned(
      projectedRecoveryProbability * 0.22 + strategy.hintGranularity * 0.05 - (1 - verification.confidence) * 0.04,
      -0.2,
      0.3
    )
  );
  const projectedStabilityGain = round3(
    clampUnit(projectedRecoveryProbability * 0.6 + strategy.priorLocalSuccessRate * 0.25 + strategy.hintGranularity * 0.15)
  );
  const projectedLowConfidenceRisk = round3(
    clampUnit(currentState.lowConfidenceRisk - projectedConfidenceDelta * 0.6 - projectedStabilityGain * 0.18)
  );

  const projectedNextWeakTopics = projectedStabilityGain >= 0.58
    ? currentState.weakTopics.filter((topic) => !weakTopicMatches.includes(topic)).slice(0, 4)
    : currentState.weakTopics;

  const projectedNextMisconceptions = projectedRecoveryProbability >= 0.62
    ? currentState.activeMisconceptions.filter((item) => !misconceptionSignals.includes(item)).slice(0, 3)
    : currentState.activeMisconceptions;

  return {
    strategyId: strategy.id,
    projectedConfidenceDelta,
    projectedRecoveryProbability: round3(projectedRecoveryProbability),
    projectedStabilityGain,
    projectedLowConfidenceRisk,
    projectedNextWeakTopics,
    projectedNextMisconceptions,
    explanation: buildTransitionExplanation({
      strategy,
      projectedRecoveryProbability,
      projectedStabilityGain,
      weakTopicMatches,
      misconceptionSignals,
      sourceLabel: null,
    }),
  };
}

function estimateTransitionWithLightZeroArtifact({
  strategy,
  currentState,
  weakTopicMatches,
  misconceptionSignals,
  verification,
  lightZeroArtifact,
}: {
  strategy: TutoringStrategy;
  currentState: LearnerWorldState;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
  verification: ReasoningResponse;
  lightZeroArtifact: LightZeroWorldModelArtifact;
}): WorldModelTransitionEstimate {
  const features = buildLightZeroFeatureVector({
    strategy,
    currentState,
    verification,
    weakTopicMatches,
    misconceptionSignals,
  });

  const projectedRecoveryProbability = round3(
    clampUnit(predictLightZeroHead(lightZeroArtifact.heads.projectedRecoveryProbability, features, strategy))
  );
  const projectedConfidenceDelta = round3(
    clampSigned(predictLightZeroHead(lightZeroArtifact.heads.projectedConfidenceDelta, features, strategy), -0.2, 0.3)
  );
  const projectedStabilityGain = round3(
    clampUnit(predictLightZeroHead(lightZeroArtifact.heads.projectedStabilityGain, features, strategy))
  );
  const projectedLowConfidenceRisk = round3(
    clampUnit(predictLightZeroHead(lightZeroArtifact.heads.projectedLowConfidenceRisk, features, strategy))
  );

  const projectedNextWeakTopics = projectedStabilityGain >= 0.58
    ? currentState.weakTopics.filter((topic) => !weakTopicMatches.includes(topic)).slice(0, 4)
    : currentState.weakTopics;

  const projectedNextMisconceptions = projectedRecoveryProbability >= 0.62
    ? currentState.activeMisconceptions.filter((item) => !misconceptionSignals.includes(item)).slice(0, 3)
    : currentState.activeMisconceptions;

  return {
    strategyId: strategy.id,
    projectedConfidenceDelta,
    projectedRecoveryProbability,
    projectedStabilityGain,
    projectedLowConfidenceRisk,
    projectedNextWeakTopics,
    projectedNextMisconceptions,
    explanation: buildTransitionExplanation({
      strategy,
      projectedRecoveryProbability,
      projectedStabilityGain,
      weakTopicMatches,
      misconceptionSignals,
      sourceLabel: lightZeroArtifact.selectedPolicyLabel,
    }),
  };
}

function buildTransitionExplanation({
  strategy,
  projectedRecoveryProbability,
  projectedStabilityGain,
  weakTopicMatches,
  misconceptionSignals,
  sourceLabel,
}: {
  strategy: TutoringStrategy;
  projectedRecoveryProbability: number;
  projectedStabilityGain: number;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
  sourceLabel: string | null;
}) {
  const target = weakTopicMatches[0] || "the active concept";
  const misconception = misconceptionSignals[0]
    ? humanizeMisconceptionCategory(misconceptionSignals[0]).toLowerCase()
    : "the current hesitation pattern";
  const prefix = sourceLabel ? `${sourceLabel} projects that ` : "";

  if (projectedRecoveryProbability >= 0.68) {
    return `${prefix}${strategy.label} should recover ${target} well because it matches ${misconception} without raising cognitive load too sharply.`;
  }
  if (projectedStabilityGain >= 0.52) {
    return `${prefix}${strategy.label} should stabilize ${target}, but the learner may still need another revisit before the misconception pattern fully clears.`;
  }
  return `${prefix}${strategy.label} may keep progress moving, but the world model still sees elevated low-confidence risk around ${target}.`;
}

function buildLightZeroFeatureVector({
  strategy,
  currentState,
  verification,
  weakTopicMatches,
  misconceptionSignals,
}: {
  strategy: TutoringStrategy;
  currentState: LearnerWorldState;
  verification: ReasoningResponse;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
}) {
  return {
    strategyConfidence: strategy.confidence,
    priorLocalSuccessRate: strategy.priorLocalSuccessRate,
    misconceptionAlignment: strategy.misconceptionAlignment,
    noveltyScore: strategy.noveltyScore,
    lowCognitiveLoad: 1 - strategy.cognitiveLoad,
    hintGranularity: strategy.hintGranularity,
    overallConfidence: currentState.overallConfidence,
    retentionStrength: currentState.retentionStrength,
    lowConfidenceRisk: currentState.lowConfidenceRisk,
    verificationConfidence: verification.confidence,
    weakTopicCount: clampUnit(weakTopicMatches.length / 4),
    misconceptionCount: clampUnit(misconceptionSignals.length / 3),
  } satisfies Record<LightZeroWorldModelFeatureName, number>;
}

function predictLightZeroHead(
  head: LightZeroLinearHead,
  features: Record<LightZeroWorldModelFeatureName, number>,
  strategy: TutoringStrategy
) {
  let score = head.intercept;
  for (const featureName of Object.keys(features) as LightZeroWorldModelFeatureName[]) {
    score += features[featureName] * (head.weights[featureName] || 0);
  }

  score += head.strategyModeBias?.[strategy.strategyMode] || 0;
  score += strategy.estimatedSteps <= 2.2
    ? head.shortStepBias || 0
    : strategy.estimatedSteps <= 3
      ? head.mediumStepBias || 0
      : head.longStepBias || 0;

  return score;
}

function getLightZeroWorldModelArtifact(): LightZeroWorldModelArtifact | null {
  const configuredPath = process.env.TUTORING_LIGHTZERO_ARTIFACT_PATH?.trim();
  if (!configuredPath) {
    cachedArtifactPath = configuredPath;
    cachedArtifact = null;
    cachedArtifactLoadError = false;
    return null;
  }

  if (cachedArtifactPath === configuredPath) return cachedArtifact;

  cachedArtifactPath = configuredPath;
  cachedArtifact = null;
  cachedArtifactLoadError = false;

  try {
    const absolutePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
    const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
    if (!isLightZeroWorldModelArtifact(parsed)) {
      throw new Error("Artifact JSON did not match the LightZero world-model schema.");
    }
    cachedArtifact = parsed;
  }
  catch (error) {
    if (!cachedArtifactLoadError) {
      cachedArtifactLoadError = true;
      console.error("Failed to load LightZero world-model artifact; falling back to bounded heuristic world model.", error);
    }
  }

  return cachedArtifact;
}

function isLightZeroWorldModelArtifact(value: unknown): value is LightZeroWorldModelArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.policyVersion !== "string") return false;
  if (typeof artifact.selectedPolicyLabel !== "string") return false;
  if (artifact.scorerKind !== "lightzero_linear_world_model_v1") return false;
  if (artifact.featureSchema !== "tutoring_world_model_features_v1") return false;
  if (!artifact.heads || typeof artifact.heads !== "object") return false;

  const heads = artifact.heads as Record<string, unknown>;
  return [
    "projectedRecoveryProbability",
    "projectedConfidenceDelta",
    "projectedStabilityGain",
    "projectedLowConfidenceRisk",
  ].every((headName) => isLightZeroLinearHead(heads[headName]));
}

function isLightZeroLinearHead(value: unknown): value is LightZeroLinearHead {
  if (!value || typeof value !== "object") return false;
  const head = value as Record<string, unknown>;
  if (typeof head.intercept !== "number") return false;
  if (!head.weights || typeof head.weights !== "object") return false;
  return true;
}

function uniqueLimited<T>(items: T[], limit: number) {
  return Array.from(new Set(items)).slice(0, limit);
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampSigned(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function round3(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}