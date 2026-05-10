import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { ReasoningResponse } from "@/lib/reasoningEngine/contracts";
import type { FlashcardCandidate, GenerateFlashcardsResult, TutoringStrategy } from "@/lib/reasoningEngine/engine";

type PersistReasoningResponseRunInput = {
  userId?: string;
  deckId?: string;
  mode: string;
  origin?: string;
  title?: string;
  prompt?: string;
  response: ReasoningResponse;
  metadata?: Prisma.InputJsonValue;
  selectedCandidates?: Prisma.InputJsonValue;
  beamWidth?: number;
  candidatesGenerated?: number;
  candidatesSelected?: number;
  prunedCount?: number;
  verificationApplied?: boolean;
  averageCandidateScore?: number;
  averageVerificationConfidence?: number;
  candidateRows?: PersistedReasoningCandidate[];
};

type PersistedReasoningCandidate = {
  question: string;
  answer: string;
  score: number;
  verificationConfidence?: number;
  selected: boolean;
  pruned: boolean;
  trajectoryDepth: number;
  sourceAttempt?: number;
  difficulty?: string;
};

export async function persistReasoningResponseRun(input: PersistReasoningResponseRunInput) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.reasoningRun.create({
      data: {
        userId: input.userId,
        deckId: input.deckId,
        mode: input.mode,
        origin: input.origin,
        title: input.title,
        prompt: truncatePrompt(input.prompt),
        finalAnswer: input.response.final_answer,
        reasoning: input.response.reasoning,
        confidence: input.response.confidence,
        trajectoryScore: input.response.trajectory_score,
        searchDepth: input.response.search_depth,
        beamWidth: input.beamWidth,
        candidatesGenerated: input.candidatesGenerated,
        candidatesSelected: input.candidatesSelected,
        prunedCount: input.prunedCount,
        verificationApplied: input.verificationApplied ?? false,
        averageCandidateScore: input.averageCandidateScore,
        averageVerificationConfidence: input.averageVerificationConfidence,
        selectedCandidates: input.selectedCandidates,
        metadata: input.metadata,
      },
      select: { id: true },
    });

    if (input.candidateRows?.length) {
      await tx.reasoningCandidate.createMany({
        data: input.candidateRows.map((candidate, index) => ({
          runId: run.id,
          rank: index + 1,
          question: candidate.question,
          answer: candidate.answer,
          score: candidate.score,
          verificationConfidence: candidate.verificationConfidence,
          selected: candidate.selected,
          pruned: candidate.pruned,
          trajectoryDepth: candidate.trajectoryDepth,
          sourceAttempt: candidate.sourceAttempt,
          difficulty: candidate.difficulty,
        })),
      });
    }

    return run;
  });
}

type PersistFlashcardReasoningRunInput = {
  userId?: string;
  deckId?: string;
  title?: string;
  origin?: string;
  source?: string;
  result: GenerateFlashcardsResult;
  metadata?: Prisma.InputJsonValue;
};

export async function persistFlashcardReasoningRun(input: PersistFlashcardReasoningRunInput) {
  const result = input.result;

  return persistReasoningResponseRun({
    userId: input.userId,
    deckId: input.deckId,
    mode: "flashcards",
    origin: input.origin,
    title: input.title,
    prompt: input.source,
    response: result.response,
    beamWidth: result.metadata.beamWidth,
    candidatesGenerated: result.metadata.candidatesGenerated,
    candidatesSelected: result.metadata.candidatesSelected,
    prunedCount: result.metadata.prunedCount,
    verificationApplied: result.metadata.verificationApplied,
    averageCandidateScore: result.metadata.averageCandidateScore,
    averageVerificationConfidence: result.metadata.averageVerificationConfidence,
    selectedCandidates: result.metadata.selectedCandidates,
    candidateRows: mapFlashcardCandidates(result.metadata.rankedCandidates, result.metadata.selectedCandidates),
    metadata: {
      selectedCards: result.cards,
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? (input.metadata as Record<string, unknown>)
        : {}),
    } as Prisma.InputJsonValue,
  });
}

export function mapTutoringStrategies(strategies: TutoringStrategy[]): PersistedReasoningCandidate[] {
  return strategies.map((strategy) => ({
    question: strategy.label,
    answer: `${strategy.hint}\n\n${strategy.rationale}`,
    score: strategy.score,
    verificationConfidence: strategy.confidence,
    selected: strategy.selected,
    pruned: !strategy.selected,
    trajectoryDepth: 1,
    difficulty: strategy.strategyType,
  }));
}

function mapFlashcardCandidates(ranked: FlashcardCandidate[], selected: FlashcardCandidate[]): PersistedReasoningCandidate[] {
  const selectedKeys = new Set(selected.map(candidateKey));
  return ranked.map((candidate) => ({
    question: candidate.question,
    answer: candidate.answer,
    score: candidate.candidateScore,
    verificationConfidence: candidate.verificationConfidence,
    selected: selectedKeys.has(candidateKey(candidate)),
    pruned: !selectedKeys.has(candidateKey(candidate)),
    trajectoryDepth: candidate.sourceAttempt,
    sourceAttempt: candidate.sourceAttempt,
    difficulty: candidate.difficulty,
  }));
}

function candidateKey(candidate: FlashcardCandidate): string {
  return `${candidate.question}\n${candidate.answer}`.toLowerCase();
}

function truncatePrompt(source?: string): string | undefined {
  const text = String(source || "").trim();
  if (!text) return undefined;
  return text.length > 4000 ? text.slice(0, 4000) : text;
}