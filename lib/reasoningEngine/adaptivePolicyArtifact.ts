import type { TutoringStrategy } from "@/lib/reasoningEngine/engine";

export type AdaptivePolicyArtifact = {
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: "linear_candidate_value_v1";
  sourceEvaluation: {
    script: string;
    seeds: string;
    averageDeltaLift: number;
    regretReduction: number;
    disagreementRate: number;
    harmfulFlipRate: number;
  };
  operatingPoint: {
    blendWeight: number;
    abstainThreshold: number;
    disagreementBudget: number;
  };
  scorer: {
    intercept: number;
    weights: {
      misconceptionAlignment: number;
      priorLocalSuccessRate: number;
      noveltyScore: number;
      lowCognitiveLoad: number;
      hintGranularity: number;
    };
    strategyModeBias: Record<TutoringStrategy["strategyMode"], number>;
    shortStepBias: number;
    mediumStepBias: number;
    longStepBias: number;
  };
};

export const DEFAULT_TUTORING_POLICY_ARTIFACT: AdaptivePolicyArtifact = {
  policyVersion: "offline_selected_v1",
  selectedPolicyLabel: "boost_blend_0.55_abstain_0.015",
  scorerKind: "linear_candidate_value_v1",
  sourceEvaluation: {
    script: "scripts/evaluate-tutoring-reranker.mjs",
    seeds: "13..17",
    averageDeltaLift: 0.002,
    regretReduction: 0.003,
    disagreementRate: 0.014,
    harmfulFlipRate: 0,
  },
  operatingPoint: {
    blendWeight: 0.55,
    abstainThreshold: 0.015,
    disagreementBudget: 0.02,
  },
  scorer: {
    intercept: 0,
    weights: {
      misconceptionAlignment: 0.26,
      priorLocalSuccessRate: 0.22,
      noveltyScore: 0.14,
      lowCognitiveLoad: 0.16,
      hintGranularity: 0.1,
    },
    strategyModeBias: {
      exploration: 0.05,
      repair: 0.1,
      reinforcement: 0.08,
    },
    shortStepBias: 0.12,
    mediumStepBias: 0.08,
    longStepBias: 0.04,
  },
};

export function scoreTutoringStrategyWithArtifact(
  strategy: TutoringStrategy,
  artifact: AdaptivePolicyArtifact = DEFAULT_TUTORING_POLICY_ARTIFACT
): number {
  const stepBias = strategy.estimatedSteps <= 2.2
    ? artifact.scorer.shortStepBias
    : strategy.estimatedSteps <= 3
      ? artifact.scorer.mediumStepBias
      : artifact.scorer.longStepBias;

  return round3(
    clamp(
      artifact.scorer.intercept +
        strategy.misconceptionAlignment * artifact.scorer.weights.misconceptionAlignment +
        strategy.priorLocalSuccessRate * artifact.scorer.weights.priorLocalSuccessRate +
        strategy.noveltyScore * artifact.scorer.weights.noveltyScore +
        (1 - strategy.cognitiveLoad) * artifact.scorer.weights.lowCognitiveLoad +
        strategy.hintGranularity * artifact.scorer.weights.hintGranularity +
        artifact.scorer.strategyModeBias[strategy.strategyMode] +
        stepBias,
      0,
      1
    )
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}