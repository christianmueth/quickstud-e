import type { TutoringStrategy } from "@/lib/reasoningEngine/engine";

export type MuonHelperLoopConfig = {
  enabled: boolean;
  shadowEnabled: boolean;
  blendWeight: number;
  overrideThreshold: number;
  recentRunLimit: number;
  minOutcomeCount: number;
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: "muon_helper_loop_v1";
};

export type MuonHelperLoopOutcome = {
  strategyId: string | null;
  strategyType: TutoringStrategy["strategyType"] | null;
  strategyMode: TutoringStrategy["strategyMode"] | null;
  weakTopicMatches: string[];
  misconceptionSignals: string[];
  reward: number;
  confidence: number;
  trajectoryScore: number;
  createdAt: string;
};

export type MuonHelperLoopCandidateScore = {
  strategyId: string;
  baseScore: number;
  helperScore: number;
  finalScore: number;
  support: number;
  strategyReward: number;
  topicReward: number;
  misconceptionReward: number;
  helperSelected: boolean;
};

export type MuonHelperLoopTelemetry = {
  mode: "disabled" | "shadow" | "active";
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: string;
  blendWeight: number;
  overrideThreshold: number;
  recentRunLimit: number;
  minOutcomeCount: number;
  sampleCount: number;
  heuristicSelectedStrategyId: string;
  baseSelectedStrategyId: string;
  helperSelectedStrategyId: string;
  effectiveSelectedStrategyId: string;
  disagreement: boolean;
  abstained: boolean;
  overrideApplied: boolean;
  candidateScores: MuonHelperLoopCandidateScore[];
};

type ApplyMuonHelperLoopInput = {
  config: MuonHelperLoopConfig;
  heuristicSelectedStrategyId: string;
  baseSelectedStrategyId: string;
  weakTopicMatches: string[];
  misconceptionSignals: string[];
  outcomes: MuonHelperLoopOutcome[];
  candidates: Array<{
    strategy: TutoringStrategy;
    baseScore: number;
  }>;
};

export function getMuonHelperLoopConfig(): MuonHelperLoopConfig {
  const enabled = process.env.MUON_HELPER_LOOP_ENABLED === "1";
  const shadowEnabled = enabled || process.env.MUON_HELPER_LOOP_SHADOW !== "0";

  return {
    enabled,
    shadowEnabled,
    blendWeight: clamp(Number(process.env.MUON_HELPER_LOOP_BLEND_WEIGHT || 0.22), 0, 0.5),
    overrideThreshold: clamp(Number(process.env.MUON_HELPER_LOOP_OVERRIDE_THRESHOLD || 0.02), 0, 0.2),
    recentRunLimit: Math.max(8, Math.min(80, Number(process.env.MUON_HELPER_LOOP_RECENT_RUN_LIMIT || 24) || 24)),
    minOutcomeCount: Math.max(4, Math.min(40, Number(process.env.MUON_HELPER_LOOP_MIN_OUTCOME_COUNT || 6) || 6)),
    policyVersion: process.env.MUON_HELPER_LOOP_POLICY_VERSION || "muon_helper_loop_v1",
    selectedPolicyLabel: process.env.MUON_HELPER_LOOP_POLICY_LABEL || "recent_recovery_blend_v1",
    scorerKind: "muon_helper_loop_v1",
  };
}

export function applyMuonHelperLoop(input: ApplyMuonHelperLoopInput): {
  selectedStrategyId: string;
  telemetry: MuonHelperLoopTelemetry | null;
  candidateScores: MuonHelperLoopCandidateScore[];
} {
  const { config } = input;
  if (!config.shadowEnabled || input.outcomes.length < config.minOutcomeCount) {
    return {
      selectedStrategyId: input.baseSelectedStrategyId,
      telemetry: null,
      candidateScores: input.candidates.map((candidate) => ({
        strategyId: candidate.strategy.id,
        baseScore: round3(candidate.baseScore),
        helperScore: round3(candidate.baseScore),
        finalScore: round3(candidate.baseScore),
        support: 0,
        strategyReward: 0,
        topicReward: 0,
        misconceptionReward: 0,
        helperSelected: candidate.strategy.id === input.baseSelectedStrategyId,
      })),
    };
  }

  const weightedOutcomes = input.outcomes.slice(0, config.recentRunLimit).map((outcome, index) => ({
    ...outcome,
    weight: 1 / (1 + index * 0.18),
  }));

  const candidateScores = input.candidates.map(({ strategy, baseScore }) => {
    const strategyMatches = weightedOutcomes.filter((outcome) => outcome.strategyId === strategy.id);
    const topicMatches = weightedOutcomes.filter((outcome) => overlaps(outcome.weakTopicMatches, input.weakTopicMatches));
    const misconceptionMatches = weightedOutcomes.filter((outcome) => overlaps(outcome.misconceptionSignals, input.misconceptionSignals));

    const strategyReward = averageWeighted(strategyMatches.map((outcome) => ({ value: outcome.reward, weight: outcome.weight })));
    const topicReward = averageWeighted(topicMatches.map((outcome) => ({ value: outcome.reward, weight: outcome.weight })));
    const misconceptionReward = averageWeighted(misconceptionMatches.map((outcome) => ({ value: outcome.reward, weight: outcome.weight })));
    const priorReward = clampUnit(
      strategy.priorLocalSuccessRate * 0.34 +
      strategy.misconceptionAlignment * 0.24 +
      (1 - strategy.cognitiveLoad) * 0.14 +
      strategy.confidence * 0.12 +
      strategy.hintGranularity * 0.08 +
      strategy.noveltyScore * 0.08
    );
    const modeBias =
      strategy.strategyMode === "reinforcement"
        ? 0.04
        : strategy.strategyMode === "repair"
          ? 0.02
          : 0.01;
    const helperScore = round3(
      clampUnit(
        priorReward * 0.32 +
        strategyReward * 0.36 +
        topicReward * 0.16 +
        misconceptionReward * 0.12 +
        modeBias
      )
    );
    const finalScore = round3(baseScore * (1 - config.blendWeight) + helperScore * config.blendWeight);
    const support = strategyMatches.length + topicMatches.length + misconceptionMatches.length;

    return {
      strategyId: strategy.id,
      baseScore: round3(baseScore),
      helperScore,
      finalScore,
      support,
      strategyReward: round3(strategyReward),
      topicReward: round3(topicReward),
      misconceptionReward: round3(misconceptionReward),
      helperSelected: false,
    };
  }).sort((left, right) => right.finalScore - left.finalScore || right.helperScore - left.helperScore);

  const helperSelected = candidateScores[0] || candidateScores.find((candidate) => candidate.strategyId === input.baseSelectedStrategyId) || candidateScores[0];
  const baseSelected = candidateScores.find((candidate) => candidate.strategyId === input.baseSelectedStrategyId) || helperSelected;
  const disagreement = helperSelected.strategyId !== input.baseSelectedStrategyId;
  const predictedUplift = round3(helperSelected.finalScore - baseSelected.finalScore);
  const abstained = disagreement && predictedUplift < config.overrideThreshold;
  const overrideApplied = config.enabled && disagreement && !abstained;
  const effectiveSelectedStrategyId = overrideApplied ? helperSelected.strategyId : input.baseSelectedStrategyId;

  const scoredCandidates = candidateScores.map((candidate) => ({
    ...candidate,
    helperSelected: candidate.strategyId === helperSelected.strategyId,
  }));

  return {
    selectedStrategyId: effectiveSelectedStrategyId,
    telemetry: {
      mode: config.enabled ? "active" : "shadow",
      policyVersion: config.policyVersion,
      selectedPolicyLabel: config.selectedPolicyLabel,
      scorerKind: config.scorerKind,
      blendWeight: round3(config.blendWeight),
      overrideThreshold: round3(config.overrideThreshold),
      recentRunLimit: config.recentRunLimit,
      minOutcomeCount: config.minOutcomeCount,
      sampleCount: weightedOutcomes.length,
      heuristicSelectedStrategyId: input.heuristicSelectedStrategyId,
      baseSelectedStrategyId: input.baseSelectedStrategyId,
      helperSelectedStrategyId: helperSelected.strategyId,
      effectiveSelectedStrategyId,
      disagreement,
      abstained,
      overrideApplied,
      candidateScores: scoredCandidates,
    },
    candidateScores: scoredCandidates,
  };
}

function overlaps(left: string[], right: string[]) {
  if (!left.length || !right.length) return false;
  const rightSet = new Set(right.map(normalizeToken));
  return left.some((value) => rightSet.has(normalizeToken(value)));
}

function normalizeToken(value: string) {
  return String(value || "").trim().toLowerCase();
}

function averageWeighted(entries: Array<{ value: number; weight: number }>) {
  const valid = entries.filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
  if (!valid.length) return 0;

  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 0;

  return valid.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round3(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}