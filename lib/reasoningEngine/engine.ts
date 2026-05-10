import {
  createReasoningResponse,
  humanizeMisconceptionCategory,
  type MisconceptionCategory,
  type ReasoningResponse,
  type StudentKnowledgeState,
} from "@/lib/reasoningEngine/contracts";

export type Flashcard = {
  question: string;
  answer: string;
};

export type FlashcardDifficulty = "easy" | "medium" | "hard";

export type FlashcardCandidate = Flashcard & {
  candidateScore: number;
  verificationConfidence: number;
  difficulty: FlashcardDifficulty;
  sourceAttempt: number;
};

export type GenerateFlashcardsInput = {
  source: string;
  count: number;
  title?: string;
  studentState?: StudentKnowledgeState;
};

export type GenerateFlashcardsResult = {
  cards: Flashcard[];
  response: ReasoningResponse;
  metadata: {
    beamWidth: number;
    searchDepth: number;
    candidatesGenerated: number;
    candidatesSelected: number;
    prunedCount: number;
    verificationApplied: boolean;
    averageCandidateScore: number;
    averageVerificationConfidence: number;
    rankedCandidates: FlashcardCandidate[];
    selectedCandidates: FlashcardCandidate[];
  };
};

export type VerifyInput = {
  prompt: string;
  answer: string;
  expectedAnswer?: string;
};

export type CompareExplanationsInput = {
  prompt: string;
  explanationA: string;
  explanationB: string;
};

export type PlanStudyPathInput = {
  topic: string;
  studentState?: StudentKnowledgeState;
};

export type TutoringGuidanceInput = {
  prompt: string;
  studentAnswer: string;
  expectedAnswer?: string;
  verification: ReasoningResponse;
  studentState?: StudentKnowledgeState;
};

export type TutoringStrategy = {
  id: string;
  label: string;
  hint: string;
  rationale: string;
  score: number;
  confidence: number;
  selected: boolean;
  strategyType: "conceptual" | "diagnostic" | "scaffolded";
  noveltyScore: number;
  misconceptionAlignment: number;
  cognitiveLoad: number;
  hintGranularity: number;
  priorLocalSuccessRate: number;
  estimatedSteps: number;
  strategyMode: "exploration" | "repair" | "reinforcement";
};

export type TutoringGuidanceResult = {
  response: ReasoningResponse;
  metadata: {
    selectedStrategy: TutoringStrategy;
    candidateStrategies: TutoringStrategy[];
    weakTopicMatches: string[];
    misconceptionSignals: MisconceptionCategory[];
  };
};

export interface ReasoningEngine {
  solve(input: { prompt: string; studentState?: StudentKnowledgeState }): Promise<ReasoningResponse>;
  verify(input: VerifyInput): Promise<ReasoningResponse>;
  generateFlashcards(
    input: GenerateFlashcardsInput,
    generator: (input: GenerateFlashcardsInput & { attempt: number }) => Promise<Flashcard[] | null>
  ): Promise<GenerateFlashcardsResult | null>;
  generateTutoringGuidance(input: TutoringGuidanceInput): Promise<TutoringGuidanceResult>;
  estimateDifficulty(input: { question: string; answer: string }): Promise<ReasoningResponse>;
  compareExplanations(input: CompareExplanationsInput): Promise<ReasoningResponse>;
  planStudyPath(input: PlanStudyPathInput): Promise<ReasoningResponse>;
}

type ReasoningEngineOptions = {
  beamWidth?: number;
  maxAttempts?: number;
};

class QuickStudReasoningEngine implements ReasoningEngine {
  private readonly beamWidth: number;
  private readonly maxAttempts: number;

  constructor(options?: ReasoningEngineOptions) {
    this.beamWidth = Math.max(1, Math.min(8, Math.floor(options?.beamWidth ?? 3)));
    this.maxAttempts = Math.max(this.beamWidth, Math.min(8, Math.floor(options?.maxAttempts ?? this.beamWidth)));
  }

  async solve(input: { prompt: string; studentState?: StudentKnowledgeState }): Promise<ReasoningResponse> {
    return createReasoningResponse({
      final_answer: input.prompt.trim(),
      reasoning: "Solve mode is reserved for a future search-backed route. Use domain-specific engine methods for production flows.",
      confidence: 0.2,
      trajectory_score: 0.2,
      search_depth: 0,
    });
  }

  async verify(input: VerifyInput): Promise<ReasoningResponse> {
    const answer = normalizeText(input.answer);
    const expected = normalizeText(input.expectedAnswer || "");
    const overlap = expected ? tokenOverlap(answer, expected) : 0;
    const confidence = expected ? clampUnit(0.35 + overlap * 0.65) : clampUnit(0.25 + lexicalCompleteness(answer) * 0.5);
    const verdict = expected
      ? overlap >= 0.65
        ? "Answer is broadly consistent with the expected answer."
        : "Answer likely needs revision against the expected answer."
      : "Verification ran without an expected answer; confidence is based on answer completeness only.";

    return createReasoningResponse({
      final_answer: verdict,
      reasoning: verdict,
      confidence,
      trajectory_score: confidence,
      search_depth: 1,
    });
  }

  async generateFlashcards(
    input: GenerateFlashcardsInput,
    generator: (input: GenerateFlashcardsInput & { attempt: number }) => Promise<Flashcard[] | null>
  ): Promise<GenerateFlashcardsResult | null> {
    const attempts = Math.max(1, this.maxAttempts);
    const candidateCards: FlashcardCandidate[] = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const generated = await generator({ ...input, attempt });
      if (!generated?.length) continue;

      for (const card of generated) {
        const difficulty = inferDifficulty(card);
        const verificationConfidence = this.scoreVerificationConfidence(card, input.source);
        const candidateScore = this.scoreFlashcardCandidate(card, input, verificationConfidence, difficulty);
        candidateCards.push({
          question: card.question,
          answer: card.answer,
          difficulty,
          verificationConfidence,
          candidateScore,
          sourceAttempt: attempt,
        });
      }
    }

    if (!candidateCards.length) return null;

    const deduped = new Map<string, FlashcardCandidate>();
    for (const card of candidateCards) {
      const key = normalizeText(card.question);
      const existing = deduped.get(key);
      if (!existing || card.candidateScore > existing.candidateScore) {
        deduped.set(key, card);
      }
    }

    const ranked = [...deduped.values()].sort((left, right) => {
      if (right.candidateScore !== left.candidateScore) return right.candidateScore - left.candidateScore;
      if (right.verificationConfidence !== left.verificationConfidence) {
        return right.verificationConfidence - left.verificationConfidence;
      }
      return left.question.localeCompare(right.question);
    });

    const selected = ranked.slice(0, Math.min(input.count, ranked.length));
    const averageCandidateScore = average(selected.map((card) => card.candidateScore));
    const averageVerificationConfidence = average(selected.map((card) => card.verificationConfidence));
    const searchDepth = Math.max(1, Math.min(attempts, selected.reduce((max, card) => Math.max(max, card.sourceAttempt), 1)));
    const prunedCount = Math.max(0, ranked.length - selected.length);

    return {
      cards: selected.map((card) => ({ question: card.question, answer: card.answer })),
      response: createReasoningResponse({
        final_answer: `Selected ${selected.length} flashcards for ${input.title || "untitled deck"}.`,
        reasoning: `Generated ${candidateCards.length} card candidates across ${attempts} attempts, reranked ${ranked.length} unique candidates, and selected the top ${selected.length} outputs.`,
        confidence: clampUnit(averageVerificationConfidence),
        trajectory_score: round3(averageCandidateScore),
        search_depth: searchDepth,
      }),
      metadata: {
        beamWidth: this.beamWidth,
        searchDepth,
        candidatesGenerated: candidateCards.length,
        candidatesSelected: selected.length,
        prunedCount,
        verificationApplied: true,
        averageCandidateScore: round3(averageCandidateScore),
        averageVerificationConfidence: round3(averageVerificationConfidence),
        rankedCandidates: ranked,
        selectedCandidates: selected,
      },
    };
  }

  async generateTutoringGuidance(input: TutoringGuidanceInput): Promise<TutoringGuidanceResult> {
    const weakTopicMatches = (input.studentState?.weakTopics || []).filter((topic) =>
      normalizeText(`${input.prompt} ${input.studentAnswer}`).includes(normalizeText(topic))
    );
    const misconceptionSignals = (input.studentState?.priorMistakes || []).slice(0, 3);
    const studentAnswer = cleanText(input.studentAnswer);
    const prompt = cleanText(input.prompt);
    const confidencePenalty = 1 - clampUnit(input.verification.confidence);

    const strategies: TutoringStrategy[] = [
      {
        id: "diagnostic-check",
        label: "Check the missing step",
        hint: `Revisit the step that connects ${extractLeadingConcept(prompt)} to your conclusion. What fact or rule should appear there?`,
        rationale: "Diagnostic prompting helps expose the exact step where the reasoning chain broke.",
        score: 0,
        confidence: 0,
        selected: false,
        strategyType: "diagnostic" as const,
      },
      {
        id: "conceptual-reframe",
        label: "Reconnect the core concept",
        hint: buildConceptualHint(prompt, weakTopicMatches, misconceptionSignals),
        rationale: "Conceptual reframing is useful when the student is drifting away from the core topic.",
        score: 0,
        confidence: 0,
        selected: false,
        strategyType: "conceptual" as const,
      },
      {
        id: "scaffolded-next-step",
        label: "Take the next small step",
        hint: `Do not solve the whole problem yet. Write one short sentence that starts with: \"First, I know that...\" and anchor it to ${extractLeadingConcept(prompt)}.`,
        rationale: "Scaffolded prompting is effective when confidence is low and the student needs a stable next action.",
        score: 0,
        confidence: 0,
        selected: false,
        strategyType: "scaffolded" as const,
      },
    ].map((strategy) => {
      const topicAlignment = weakTopicMatches.length ? tokenOverlap(strategy.hint, weakTopicMatches.join(" ")) : 0;
      const answerAlignment = tokenOverlap(strategy.hint, studentAnswer);
      const misconceptionAlignment = misconceptionSignals.length ? scoreMisconceptionAlignment(strategy.strategyType, misconceptionSignals) : 0;
      const noveltyScore = scoreTutoringNovelty(strategy.strategyType, answerAlignment, input.studentState);
      const cognitiveLoad = estimateTutoringCognitiveLoad(strategy.strategyType, prompt, studentAnswer, confidencePenalty);
      const hintGranularity = estimateHintGranularity(strategy.strategyType);
      const priorLocalSuccessRate = estimatePriorLocalSuccessRate(strategy.strategyType, input.studentState);
      const estimatedSteps = estimateStrategySteps(strategy.strategyType, prompt, confidencePenalty);
      const strategyMode = inferStrategyMode(strategy.strategyType, confidencePenalty);
      const scaffoldBoost = strategy.strategyType === "scaffolded" ? 0.2 : 0;
      const diagnosticBoost = strategy.strategyType === "diagnostic" ? 0.12 : 0;
      const score = round3(
        clampUnit(
          topicAlignment * 0.24 +
            misconceptionAlignment * 0.2 +
            confidencePenalty * 0.18 +
            noveltyScore * 0.08 +
            priorLocalSuccessRate * 0.12 +
            (1 - cognitiveLoad) * 0.08 +
            hintGranularity * 0.03 +
            (1 - answerAlignment) * 0.07 +
            scaffoldBoost +
            diagnosticBoost
        )
      );
      const confidence = round3(clampUnit(0.4 + score * 0.45));
      return {
        ...strategy,
        score,
        confidence,
        noveltyScore,
        misconceptionAlignment: round3(misconceptionAlignment),
        cognitiveLoad,
        hintGranularity,
        priorLocalSuccessRate,
        estimatedSteps,
        strategyMode,
      };
    });

    const ranked = [...strategies].sort((left, right) => right.score - left.score || right.confidence - left.confidence);
    const selected = { ...ranked[0], selected: true };
    const candidateStrategies = ranked.map((strategy) => ({
      ...strategy,
      selected: strategy.id === selected.id,
    }));

    return {
      response: createReasoningResponse({
        final_answer: selected.hint,
        reasoning: `Selected the ${selected.label.toLowerCase()} strategy after comparing ${candidateStrategies.length} tutoring trajectories against the student's verification result and current state.`,
        confidence: selected.confidence,
        trajectory_score: selected.score,
        search_depth: 1,
      }),
      metadata: {
        selectedStrategy: selected,
        candidateStrategies,
        weakTopicMatches,
        misconceptionSignals,
      },
    };
  }

  async estimateDifficulty(input: { question: string; answer: string }): Promise<ReasoningResponse> {
    const difficulty = inferDifficulty({ question: input.question, answer: input.answer });
    const score = difficulty === "hard" ? 0.85 : difficulty === "medium" ? 0.6 : 0.35;
    return createReasoningResponse({
      final_answer: difficulty,
      reasoning: `Difficulty estimated from question specificity and answer density as ${difficulty}.`,
      confidence: 0.55,
      trajectory_score: score,
      search_depth: 1,
    });
  }

  async compareExplanations(input: CompareExplanationsInput): Promise<ReasoningResponse> {
    const scoreA = tokenOverlap(input.prompt, input.explanationA) + lexicalCompleteness(input.explanationA);
    const scoreB = tokenOverlap(input.prompt, input.explanationB) + lexicalCompleteness(input.explanationB);
    const winner = scoreA >= scoreB ? "A" : "B";
    const winnerScore = Math.max(scoreA, scoreB) / 2;
    return createReasoningResponse({
      final_answer: `Explanation ${winner} is currently favored.`,
      reasoning: `Comparison used prompt overlap and explanation completeness. Score A=${round3(scoreA)}, Score B=${round3(scoreB)}.`,
      confidence: clampUnit(0.45 + Math.abs(scoreA - scoreB) / 2),
      trajectory_score: round3(winnerScore),
      search_depth: 1,
    });
  }

  async planStudyPath(input: PlanStudyPathInput): Promise<ReasoningResponse> {
    const weakTopics = input.studentState?.weakTopics?.slice(0, 3) || [];
    const focus = weakTopics.length ? `${input.topic} with emphasis on ${weakTopics.join(", ")}` : input.topic;
    return createReasoningResponse({
      final_answer: `Study path should start with ${focus}.`,
      reasoning: "Study-path planning is scaffolded around the current student-state summary and topic priority.",
      confidence: weakTopics.length ? 0.6 : 0.35,
      trajectory_score: weakTopics.length ? 0.6 : 0.35,
      search_depth: weakTopics.length ? 1 : 0,
    });
  }

  private scoreFlashcardCandidate(
    card: Flashcard,
    input: GenerateFlashcardsInput,
    verificationConfidence: number,
    difficulty: FlashcardDifficulty
  ): number {
    const question = cleanText(card.question);
    const answer = cleanText(card.answer);
    const questionLength = boundedScore(question.length, 30, 120);
    const answerLength = boundedScore(answer.length, 40, 200);
    const sourceCoverage = tokenOverlap(`${question} ${answer}`, input.source);
    const weakTopicBonus = this.scoreWeakTopicAlignment(card, input.studentState);
    const difficultyBonus = difficulty === "medium" ? 0.08 : difficulty === "hard" ? 0.04 : 0.02;

    return round3(
      clampUnit(
        verificationConfidence * 0.4 +
          questionLength * 0.15 +
          answerLength * 0.15 +
          sourceCoverage * 0.2 +
          weakTopicBonus * 0.1 +
          difficultyBonus
      )
    );
  }

  private scoreVerificationConfidence(card: Flashcard, source: string): number {
    const question = cleanText(card.question);
    const answer = cleanText(card.answer);
    const overlap = tokenOverlap(`${question} ${answer}`, source);
    const completeness = lexicalCompleteness(answer);
    const questionShape = question.endsWith("?") ? 1 : 0.6;
    return round3(clampUnit(overlap * 0.45 + completeness * 0.35 + questionShape * 0.2));
  }

  private scoreWeakTopicAlignment(card: Flashcard, studentState?: StudentKnowledgeState): number {
    const weakTopics = studentState?.weakTopics || [];
    if (!weakTopics.length) return 0;
    const haystack = normalizeText(`${card.question} ${card.answer}`);
    const hits = weakTopics.filter((topic) => haystack.includes(normalizeText(topic))).length;
    return clampUnit(hits / weakTopics.length);
  }
}

export function createReasoningEngine(options?: ReasoningEngineOptions): ReasoningEngine {
  return new QuickStudReasoningEngine(options);
}

function inferDifficulty(card: Flashcard): FlashcardDifficulty {
  const size = cleanText(card.question).length + cleanText(card.answer).length;
  if (size >= 210) return "hard";
  if (size >= 120) return "medium";
  return "easy";
}

function lexicalCompleteness(text: string): number {
  const cleaned = cleanText(text);
  if (!cleaned) return 0;
  const tokens = tokenize(cleaned);
  const uniqueRatio = tokens.length ? new Set(tokens).size / tokens.length : 0;
  const sentenceBonus = /[.!?]$/.test(cleaned) ? 0.15 : 0;
  return clampUnit(Math.min(1, uniqueRatio + sentenceBonus + boundedScore(cleaned.length, 25, 180) * 0.35));
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return clampUnit(overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size)));
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function normalizeText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function boundedScore(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < min) return value / min;
  if (value > max) return Math.max(0, 1 - (value - max) / max);
  return 1;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function extractLeadingConcept(text: string): string {
  const tokens = tokenize(text);
  return tokens.slice(0, 3).join(" ") || "the core concept";
}

function buildConceptualHint(prompt: string, weakTopicMatches: string[], misconceptionSignals: MisconceptionCategory[]): string {
  const topic = weakTopicMatches[0] || extractLeadingConcept(prompt);
  const misconception = misconceptionSignals[0];
  if (misconception) {
    return `Your last attempts suggest a recurring issue around ${humanizeMisconceptionCategory(misconception)}. Re-state how ${topic} should guide the answer before you calculate or conclude anything.`;
  }
  return `Focus on the central idea behind ${topic}. Before continuing, explain that idea in one sentence without doing the final step.`;
}

function scoreMisconceptionAlignment(strategyType: TutoringStrategy["strategyType"], misconceptionSignals: MisconceptionCategory[]): number {
  const supported = MISCONCEPTION_SUPPORT[strategyType];
  const matches = misconceptionSignals.filter((signal) => supported.includes(signal)).length;
  return clampUnit(matches / Math.max(1, misconceptionSignals.length));
}

function scoreTutoringNovelty(
  strategyType: TutoringStrategy["strategyType"],
  answerAlignment: number,
  studentState?: StudentKnowledgeState
): number {
  const recentSuccessBias = clampUnit((studentState?.reasoningPatterns?.length || 0) / 6);
  const strategyBias = strategyType === "conceptual" ? 0.12 : strategyType === "diagnostic" ? 0.08 : 0.04;
  return round3(clampUnit((1 - answerAlignment) * 0.72 + strategyBias - recentSuccessBias * 0.08));
}

function estimateTutoringCognitiveLoad(
  strategyType: TutoringStrategy["strategyType"],
  prompt: string,
  studentAnswer: string,
  confidencePenalty: number
): number {
  const baseLoad = strategyType === "conceptual" ? 0.66 : strategyType === "diagnostic" ? 0.54 : 0.32;
  const complexity = boundedScore(cleanText(prompt).length + cleanText(studentAnswer).length, 80, 260);
  const penalty = strategyType === "scaffolded" ? confidencePenalty * 0.05 : confidencePenalty * 0.11;
  return round3(clampUnit(baseLoad + complexity * 0.16 + penalty));
}

function estimateHintGranularity(strategyType: TutoringStrategy["strategyType"]): number {
  if (strategyType === "scaffolded") return 0.88;
  if (strategyType === "diagnostic") return 0.58;
  return 0.28;
}

function estimatePriorLocalSuccessRate(
  strategyType: TutoringStrategy["strategyType"],
  studentState?: StudentKnowledgeState
): number {
  const confidenceMean = average(Object.values(studentState?.confidenceByTopic || {}));
  const retentionMean = average(Object.values(studentState?.retentionByTopic || {}));
  const misconceptionFit = scoreMisconceptionAlignment(strategyType, studentState?.priorMistakes || []);
  const strategyBias = strategyType === "scaffolded" ? 0.08 : strategyType === "diagnostic" ? 0.05 : 0.02;
  return round3(clampUnit(retentionMean * 0.45 + confidenceMean * 0.2 + misconceptionFit * 0.25 + strategyBias));
}

function estimateStrategySteps(
  strategyType: TutoringStrategy["strategyType"],
  prompt: string,
  confidencePenalty: number
): number {
  const complexity = boundedScore(cleanText(prompt).length, 40, 180);
  const baseSteps = strategyType === "conceptual" ? 3 : strategyType === "diagnostic" ? 2 : 1;
  const adjustment = strategyType === "scaffolded" ? confidencePenalty * 0.6 : complexity * 1.2;
  return round3(Math.max(1, Math.min(4, baseSteps + adjustment)));
}

function inferStrategyMode(
  strategyType: TutoringStrategy["strategyType"],
  confidencePenalty: number
): TutoringStrategy["strategyMode"] {
  if (strategyType === "conceptual") return "exploration";
  if (strategyType === "diagnostic") return "repair";
  return confidencePenalty >= 0.4 ? "reinforcement" : "repair";
}

const MISCONCEPTION_SUPPORT: Record<TutoringStrategy["strategyType"], MisconceptionCategory[]> = {
  conceptual: ["CONCEPTUAL_CONFUSION", "OVERGENERALIZATION", "MEMORIZATION_FAILURE", "FALSE_ASSUMPTION"],
  diagnostic: ["FALSE_ASSUMPTION", "SKIPPED_STEP", "OVERGENERALIZATION", "SIGN_ERROR"],
  scaffolded: ["ARITHMETIC_ERROR", "SIGN_ERROR", "UNIT_ERROR", "SKIPPED_STEP", "MEMORIZATION_FAILURE"],
};