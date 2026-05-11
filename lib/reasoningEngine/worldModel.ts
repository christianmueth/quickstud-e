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
  version: "world_model_shadow_v1";
  currentState: LearnerWorldState;
  selectedTransition: WorldModelTransitionEstimate;
  candidateTransitions: WorldModelTransitionEstimate[];
};

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
  const candidateTransitions = input.strategies.map((strategy) =>
    estimateTransition({
      strategy,
      currentState,
      weakTopicMatches: input.weakTopicMatches,
      misconceptionSignals: input.misconceptionSignals,
      verification: input.verification,
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
    version: "world_model_shadow_v1",
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
}): WorldModelTransitionEstimate {
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
    }),
  };
}

function buildTransitionExplanation({
  strategy,
  projectedRecoveryProbability,
  projectedStabilityGain,
  weakTopicMatches,
  misconceptionSignals,
}: {
  strategy: TutoringStrategy;
  projectedRecoveryProbability: number;
  projectedStabilityGain: number;
  weakTopicMatches: string[];
  misconceptionSignals: MisconceptionCategory[];
}) {
  const target = weakTopicMatches[0] || "the active concept";
  const misconception = misconceptionSignals[0]
    ? humanizeMisconceptionCategory(misconceptionSignals[0]).toLowerCase()
    : "the current hesitation pattern";

  if (projectedRecoveryProbability >= 0.68) {
    return `${strategy.label} is projected to recover ${target} well because it matches ${misconception} without raising cognitive load too sharply.`;
  }
  if (projectedStabilityGain >= 0.52) {
    return `${strategy.label} is projected to stabilize ${target}, but the learner may still need another revisit before the misconception pattern fully clears.`;
  }
  return `${strategy.label} may keep progress moving, but the world model still sees elevated low-confidence risk around ${target}.`;
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