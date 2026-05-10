type ReasoningRunRow = {
  id: string;
  mode: string;
  title: string | null;
  origin: string | null;
  confidence: number | null;
  trajectoryScore: number | null;
  searchDepth: number;
  beamWidth: number | null;
  candidatesGenerated: number | null;
  candidatesSelected: number | null;
  prunedCount: number | null;
  verificationApplied: boolean;
  metadata?: unknown;
  createdAt: Date;
  deckId: string | null;
  candidates?: ReasoningCandidateRow[];
};

type ReasoningCandidateRow = {
  id: string;
  rank: number;
  question: string;
  answer: string;
  score: number;
  verificationConfidence: number | null;
  selected: boolean;
  pruned: boolean;
  trajectoryDepth: number;
  sourceAttempt: number | null;
  difficulty: string | null;
  createdAt: Date;
};

export type ReasoningRunAnalytics = {
  totalRuns: number;
  averageConfidence: number;
  averageTrajectoryScore: number;
  averageSearchDepth: number;
  averagePrunedCount: number;
  lowConfidenceRuns: number;
  verificationRuns: number;
  byMode: Array<{ mode: string; count: number }>;
  byMisconception: Array<{ category: string; count: number }>;
  dominantMisconception: string | null;
  strategyWinsByMisconception: Array<{
    category: string;
    runCount: number;
    topStrategy: string | null;
    topStrategyType: string | null;
    winCount: number;
    strategies: Array<{ strategy: string; strategyType: string | null; count: number }>;
  }>;
  confidenceByMisconception: Array<{
    category: string;
    runCount: number;
    averageConfidence: number;
    lowConfidenceRuns: number;
  }>;
  adaptivePolicy: {
    loggedRuns: number;
    shadowRuns: number;
    activeRuns: number;
    disagreementRate: number;
    abstentionRate: number;
    overrideRate: number;
    topStrategyShifts: Array<{
      fromStrategyId: string;
      toStrategyId: string;
      count: number;
    }>;
  };
};

export function summarizeReasoningRuns(runs: ReasoningRunRow[]): ReasoningRunAnalytics {
  const modeCounts = new Map<string, number>();
  const misconceptionCounts = new Map<string, number>();
  const confidenceBuckets = new Map<string, number[]>();
  const lowConfidenceCounts = new Map<string, number>();
  const strategyWins = new Map<string, Map<string, { strategy: string; strategyType: string | null; count: number }>>();
  const adaptiveShiftCounts = new Map<string, { fromStrategyId: string; toStrategyId: string; count: number }>();
  let adaptiveLoggedRuns = 0;
  let adaptiveShadowRuns = 0;
  let adaptiveActiveRuns = 0;
  let adaptiveDisagreements = 0;
  let adaptiveAbstentions = 0;
  let adaptiveOverrides = 0;

  for (const run of runs) {
    modeCounts.set(run.mode, (modeCounts.get(run.mode) || 0) + 1);
    const metadata = normalizeRunMetadata(run.metadata);
    const categories = metadata.misconceptionSignals;
    const selectedCandidate = getSelectedCandidate(run);
    const adaptivePolicy = metadata.adaptivePolicy;

    if (adaptivePolicy) {
      adaptiveLoggedRuns += 1;
      if (adaptivePolicy.mode === "shadow") adaptiveShadowRuns += 1;
      if (adaptivePolicy.mode === "active") adaptiveActiveRuns += 1;
      if (adaptivePolicy.disagreement) adaptiveDisagreements += 1;
      if (adaptivePolicy.abstained) adaptiveAbstentions += 1;
      if (adaptivePolicy.overrideApplied) adaptiveOverrides += 1;
      if (adaptivePolicy.disagreement) {
        const key = `${adaptivePolicy.heuristicSelectedStrategyId}=>${adaptivePolicy.adaptiveSelectedStrategyId}`;
        const current = adaptiveShiftCounts.get(key);
        adaptiveShiftCounts.set(key, {
          fromStrategyId: adaptivePolicy.heuristicSelectedStrategyId,
          toStrategyId: adaptivePolicy.adaptiveSelectedStrategyId,
          count: (current?.count || 0) + 1,
        });
      }
    }

    for (const category of categories) {
      misconceptionCounts.set(category, (misconceptionCounts.get(category) || 0) + 1);
      if (typeof run.confidence === "number" && Number.isFinite(run.confidence)) {
        const bucket = confidenceBuckets.get(category) || [];
        bucket.push(run.confidence);
        confidenceBuckets.set(category, bucket);
        if (run.confidence < 0.45) {
          lowConfidenceCounts.set(category, (lowConfidenceCounts.get(category) || 0) + 1);
        }
      }

      if (run.mode === "tutor_guidance" && selectedCandidate) {
        const bucket = strategyWins.get(category) || new Map<string, { strategy: string; strategyType: string | null; count: number }>();
        const key = `${selectedCandidate.question}::${selectedCandidate.difficulty || ""}`;
        const current = bucket.get(key);
        bucket.set(key, {
          strategy: selectedCandidate.question,
          strategyType: selectedCandidate.difficulty,
          count: (current?.count || 0) + 1,
        });
        strategyWins.set(category, bucket);
      }
    }
  }

  const byMisconception = [...misconceptionCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));

  const strategyWinsByMisconception = byMisconception.map(({ category, count }) => {
    const strategies = [...(strategyWins.get(category)?.values() || [])]
      .sort((left, right) => right.count - left.count || left.strategy.localeCompare(right.strategy));
    return {
      category,
      runCount: count,
      topStrategy: strategies[0]?.strategy || null,
      topStrategyType: strategies[0]?.strategyType || null,
      winCount: strategies[0]?.count || 0,
      strategies: strategies.slice(0, 3),
    };
  });

  const confidenceByMisconception = byMisconception.map(({ category, count }) => ({
    category,
    runCount: count,
    averageConfidence: average(confidenceBuckets.get(category) || []),
    lowConfidenceRuns: lowConfidenceCounts.get(category) || 0,
  }));

  return {
    totalRuns: runs.length,
    averageConfidence: average(runs.map((run) => run.confidence)),
    averageTrajectoryScore: average(runs.map((run) => run.trajectoryScore)),
    averageSearchDepth: average(runs.map((run) => run.searchDepth)),
    averagePrunedCount: average(runs.map((run) => run.prunedCount)),
    lowConfidenceRuns: runs.filter((run) => (run.confidence ?? 0) < 0.45).length,
    verificationRuns: runs.filter((run) => run.verificationApplied).length,
    byMode: [...modeCounts.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)),
    byMisconception,
    dominantMisconception: byMisconception[0]?.category || null,
    strategyWinsByMisconception,
    confidenceByMisconception,
    adaptivePolicy: {
      loggedRuns: adaptiveLoggedRuns,
      shadowRuns: adaptiveShadowRuns,
      activeRuns: adaptiveActiveRuns,
      disagreementRate: adaptiveLoggedRuns ? round3(adaptiveDisagreements / adaptiveLoggedRuns) : 0,
      abstentionRate: adaptiveLoggedRuns ? round3(adaptiveAbstentions / adaptiveLoggedRuns) : 0,
      overrideRate: adaptiveLoggedRuns ? round3(adaptiveOverrides / adaptiveLoggedRuns) : 0,
      topStrategyShifts: [...adaptiveShiftCounts.values()]
        .sort((left, right) => right.count - left.count || left.fromStrategyId.localeCompare(right.fromStrategyId))
        .slice(0, 5),
    },
  };
}

export function normalizeReasoningRunRow(run: ReasoningRunRow) {
  return {
    id: run.id,
    mode: run.mode,
    title: run.title,
    origin: run.origin,
    confidence: round3(run.confidence ?? 0),
    trajectoryScore: round3(run.trajectoryScore ?? 0),
    searchDepth: run.searchDepth,
    beamWidth: run.beamWidth,
    candidatesGenerated: run.candidatesGenerated,
    candidatesSelected: run.candidatesSelected,
    prunedCount: run.prunedCount,
    verificationApplied: run.verificationApplied,
    metadata: normalizeRunMetadata(run.metadata),
    createdAt: run.createdAt.toISOString(),
    deckId: run.deckId,
  };
}

export function normalizeReasoningCandidateRow(candidate: ReasoningCandidateRow) {
  return {
    id: candidate.id,
    rank: candidate.rank,
    question: candidate.question,
    answer: candidate.answer,
    score: round3(candidate.score),
    verificationConfidence: round3(candidate.verificationConfidence ?? 0),
    selected: candidate.selected,
    pruned: candidate.pruned,
    trajectoryDepth: candidate.trajectoryDepth,
    sourceAttempt: candidate.sourceAttempt,
    difficulty: candidate.difficulty,
    createdAt: candidate.createdAt.toISOString(),
  };
}

export function summarizeReplayCandidates(candidates: ReasoningCandidateRow[]) {
  return {
    totalCandidates: candidates.length,
    selectedCount: candidates.filter((candidate) => candidate.selected).length,
    prunedCount: candidates.filter((candidate) => candidate.pruned).length,
    averageScore: average(candidates.map((candidate) => candidate.score)),
    averageVerificationConfidence: average(candidates.map((candidate) => candidate.verificationConfidence)),
    highestScore: round3(Math.max(0, ...candidates.map((candidate) => candidate.score))),
  };
}

export function getRunMisconceptionSignals(run: Pick<ReasoningRunRow, "metadata">): string[] {
  return normalizeRunMetadata(run.metadata).misconceptionSignals;
}

function getSelectedCandidate(run: Pick<ReasoningRunRow, "mode" | "candidates">): ReasoningCandidateRow | null {
  if (run.mode !== "tutor_guidance" || !run.candidates?.length) return null;
  return run.candidates.find((candidate) => candidate.selected) || null;
}

function average(values: Array<number | null | undefined>): number {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return 0;
  return round3(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeRunMetadata(value: unknown) {
  const record = toRecord(value);
  return {
    weakTopicMatches: toStringArray(record.weakTopicMatches),
    misconceptionSignals: toStringArray(record.misconceptionSignals),
    verification: normalizeVerification(record.verification),
    adaptivePolicy: normalizeAdaptivePolicy(record.adaptivePolicy),
  };
}

function normalizeAdaptivePolicy(value: unknown) {
  const record = toRecord(value);
  const mode = toString(record.mode);
  if (!mode) return null;
  return {
    mode,
    policyVersion: toString(record.policyVersion),
    selectedPolicyLabel: toString(record.selectedPolicyLabel),
    scorerKind: toString(record.scorerKind),
    blendWeight: round3(toNumber(record.blendWeight)),
    abstainThreshold: round3(toNumber(record.abstainThreshold)),
    heuristicSelectedStrategyId: toString(record.heuristicSelectedStrategyId),
    adaptiveSelectedStrategyId: toString(record.adaptiveSelectedStrategyId),
    effectiveSelectedStrategyId: toString(record.effectiveSelectedStrategyId),
    disagreement: toBoolean(record.disagreement),
    abstained: toBoolean(record.abstained),
    overrideApplied: toBoolean(record.overrideApplied),
    candidateScores: toArray(record.candidateScores).map((candidate) => {
      const item = toRecord(candidate);
      return {
        strategyId: toString(item.strategyId),
        heuristicScore: round3(toNumber(item.heuristicScore)),
        artifactValueScore: round3(toNumber(item.artifactValueScore)),
        blendedScore: round3(toNumber(item.blendedScore)),
        heuristicSelected: toBoolean(item.heuristicSelected),
        adaptiveSelected: toBoolean(item.adaptiveSelected),
      };
    }),
  };
}

function normalizeVerification(value: unknown) {
  const record = toRecord(value);
  return {
    final_answer: toString(record.final_answer),
    reasoning: toString(record.reasoning),
    confidence: round3(toNumber(record.confidence)),
    trajectory_score: round3(toNumber(record.trajectory_score)),
    search_depth: Math.floor(toNumber(record.search_depth)),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}