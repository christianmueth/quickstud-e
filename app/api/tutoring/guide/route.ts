import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createReasoningEngine, type TutoringGuidanceResult } from "@/lib/reasoningEngine/engine";
import { DEFAULT_TUTORING_POLICY_ARTIFACT, scoreTutoringStrategyWithArtifact } from "@/lib/reasoningEngine/adaptivePolicyArtifact";
import { persistReasoningResponseRun, mapTutoringStrategies } from "@/lib/reasoningEngine/persistence";
import { getStudentKnowledgeState, updateStudentStateFromVerification, formatStudentState } from "@/lib/reasoningEngine/studentState";
import { buildTutoringWorldModel } from "@/lib/reasoningEngine/worldModel";

const reasoningEngine = createReasoningEngine({
  beamWidth: Number(process.env.REASONING_ENGINE_BEAM_WIDTH || 3),
  maxAttempts: Number(process.env.REASONING_ENGINE_MAX_ATTEMPTS || 3),
});

type TutoringGuideBody = {
  prompt?: string;
  studentAnswer?: string;
  expectedAnswer?: string;
  title?: string;
  origin?: string;
  persist?: boolean;
};

type AdaptiveTutoringConfig = {
  enabled: boolean;
  shadowEnabled: boolean;
  blendWeight: number;
  abstainThreshold: number;
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: string;
};

type AdaptiveCandidateScore = {
  strategyId: string;
  heuristicScore: number;
  artifactValueScore: number;
  blendedScore: number;
  heuristicSelected: boolean;
  adaptiveSelected: boolean;
};

type AdaptiveTutoringTelemetry = {
  mode: "disabled" | "shadow" | "active";
  policyVersion: string;
  selectedPolicyLabel: string;
  scorerKind: string;
  blendWeight: number;
  abstainThreshold: number;
  heuristicSelectedStrategyId: string;
  adaptiveSelectedStrategyId: string;
  effectiveSelectedStrategyId: string;
  disagreement: boolean;
  abstained: boolean;
  overrideApplied: boolean;
  candidateScores: AdaptiveCandidateScore[];
};

export async function POST(req: Request) {
  const traceId = req.headers.get("x-quickstud-trace") || createTraceId();
  const testKey = process.env.FLASHCARDS_TEST_KEY;
  const isTestMode = !!testKey && req.headers.get("x-flashcards-test-key") === testKey;

  let clerkUserId: string | null = null;
  if (!isTestMode) {
    const authResult = await auth();
    clerkUserId = authResult.userId;
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized", traceId }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => null)) as TutoringGuideBody | null;
  const prompt = body?.prompt?.trim();
  const studentAnswer = body?.studentAnswer?.trim();
  if (!prompt || !studentAnswer) {
    return NextResponse.json({ error: "Prompt and studentAnswer are required", traceId }, { status: 400 });
  }

  const persist = body?.persist !== false && !isTestMode;

  try {
    let userRow: { id: string } | null = null;
    let studentState;
    if (!isTestMode) {
      userRow = await prisma.user.upsert({
        where: { clerkUserId: clerkUserId! },
        update: {},
        create: { clerkUserId: clerkUserId! },
        select: { id: true },
      });
      studentState = await getStudentKnowledgeState(userRow.id);
    }

    const verification = await reasoningEngine.verify({
      prompt,
      answer: studentAnswer,
      expectedAnswer: body?.expectedAnswer?.trim(),
    });

    const guidance = await reasoningEngine.generateTutoringGuidance({
      prompt,
      studentAnswer,
      expectedAnswer: body?.expectedAnswer?.trim(),
      verification,
      studentState,
    });
    const adaptiveConfig = getAdaptiveTutoringConfig();
    const { guidance: effectiveGuidance, telemetry: adaptiveTelemetry } = applyAdaptiveTutoringPolicy(guidance, adaptiveConfig);
    const worldModel = buildTutoringWorldModel({
      prompt,
      studentAnswer,
      verification,
      studentState,
      weakTopicMatches: effectiveGuidance.metadata.weakTopicMatches,
      misconceptionSignals: effectiveGuidance.metadata.misconceptionSignals,
      strategies: effectiveGuidance.metadata.candidateStrategies,
      selectedStrategyId: effectiveGuidance.metadata.selectedStrategy.id,
    });

    let reasoningRunId: string | null = null;
    let studentStateView = null;
    if (persist && userRow) {
      const saved = await persistReasoningResponseRun({
        userId: userRow.id,
        mode: "tutor_guidance",
        origin: body?.origin,
        title: body?.title,
        prompt,
        response: effectiveGuidance.response,
        verificationApplied: true,
        selectedCandidates: effectiveGuidance.metadata.candidateStrategies as unknown as Prisma.InputJsonValue,
        candidateRows: mapTutoringStrategies(effectiveGuidance.metadata.candidateStrategies),
        metadata: {
          verification,
          weakTopicMatches: effectiveGuidance.metadata.weakTopicMatches,
          misconceptionSignals: effectiveGuidance.metadata.misconceptionSignals,
          adaptivePolicy: adaptiveTelemetry,
          worldModel,
        } as Prisma.InputJsonValue,
        candidatesGenerated: effectiveGuidance.metadata.candidateStrategies.length,
        candidatesSelected: 1,
        prunedCount: Math.max(0, effectiveGuidance.metadata.candidateStrategies.length - 1),
        averageCandidateScore:
          effectiveGuidance.metadata.candidateStrategies.reduce((sum, candidate) => sum + candidate.score, 0) /
          Math.max(1, effectiveGuidance.metadata.candidateStrategies.length),
        averageVerificationConfidence:
          effectiveGuidance.metadata.candidateStrategies.reduce((sum, candidate) => sum + candidate.confidence, 0) /
          Math.max(1, effectiveGuidance.metadata.candidateStrategies.length),
      });
      reasoningRunId = saved.id;

      await updateStudentStateFromVerification({
        userId: userRow.id,
        mode: "verify_answer",
        prompt,
        response: verification,
        answer: studentAnswer,
        expectedAnswer: body?.expectedAnswer?.trim(),
      });

      const refreshed = await prisma.studentState.findUnique({ where: { userId: userRow.id } });
      studentStateView = formatStudentState(refreshed);
    }

    return NextResponse.json({
      ok: true,
      mode: "tutor_guidance",
      verification,
      tutoring: effectiveGuidance.response,
      weakTopicMatches: effectiveGuidance.metadata.weakTopicMatches,
      misconceptionSignals: effectiveGuidance.metadata.misconceptionSignals,
      selectedStrategy: effectiveGuidance.metadata.selectedStrategy,
      candidateStrategies: effectiveGuidance.metadata.candidateStrategies,
      adaptivePolicy: adaptiveTelemetry,
      worldModel,
      reasoningRunId,
      persisted: persist,
      studentState: studentStateView,
      traceId,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error && error.message ? error.message : "Failed to generate tutoring guidance",
        traceId,
      },
      { status: 500 }
    );
  }
}

function getAdaptiveTutoringConfig(): AdaptiveTutoringConfig {
  const enabled = process.env.TUTORING_ADAPTIVE_RERANK_ENABLED === "1";
  const shadowEnabled = enabled || process.env.TUTORING_ADAPTIVE_RERANK_SHADOW === "1";
  return {
    enabled,
    shadowEnabled,
    blendWeight: clamp(Number(process.env.TUTORING_ADAPTIVE_BLEND_WEIGHT || DEFAULT_TUTORING_POLICY_ARTIFACT.operatingPoint.blendWeight), 0, 1),
    abstainThreshold: clamp(Number(process.env.TUTORING_ADAPTIVE_ABSTAIN_THRESHOLD || DEFAULT_TUTORING_POLICY_ARTIFACT.operatingPoint.abstainThreshold), 0, 1),
    policyVersion: process.env.TUTORING_ADAPTIVE_POLICY_VERSION || DEFAULT_TUTORING_POLICY_ARTIFACT.policyVersion,
    selectedPolicyLabel: DEFAULT_TUTORING_POLICY_ARTIFACT.selectedPolicyLabel,
    scorerKind: DEFAULT_TUTORING_POLICY_ARTIFACT.scorerKind,
  };
}

function applyAdaptiveTutoringPolicy(
  guidance: TutoringGuidanceResult,
  config: AdaptiveTutoringConfig
): { guidance: TutoringGuidanceResult; telemetry: AdaptiveTutoringTelemetry | null } {
  const heuristicSelected = guidance.metadata.selectedStrategy;
  const candidateScores = guidance.metadata.candidateStrategies
    .map((strategy) => {
      const artifactValueScore = scoreTutoringStrategyWithArtifact(strategy, DEFAULT_TUTORING_POLICY_ARTIFACT);
      const blendedScore = round3(strategy.score * config.blendWeight + artifactValueScore * (1 - config.blendWeight));
      return {
        strategy,
        heuristicScore: strategy.score,
        artifactValueScore,
        blendedScore,
      };
    })
    .sort((left, right) => right.blendedScore - left.blendedScore || right.heuristicScore - left.heuristicScore);

  const adaptiveSelected = candidateScores[0]?.strategy || heuristicSelected;
  const predictedUplift = round3((candidateScores[0]?.blendedScore || 0) - (candidateScores.find((candidate) => candidate.strategy.id === heuristicSelected.id)?.blendedScore || 0));
  const disagreement = adaptiveSelected.id !== heuristicSelected.id;
  const abstained = disagreement && predictedUplift < config.abstainThreshold;
  const overrideApplied = config.enabled && disagreement && !abstained;
  const effectiveSelected = overrideApplied ? adaptiveSelected : heuristicSelected;
  const updatedStrategies = guidance.metadata.candidateStrategies.map((strategy) => ({
    ...strategy,
    selected: strategy.id === effectiveSelected.id,
  }));
  const telemetry: AdaptiveTutoringTelemetry | null = config.shadowEnabled || config.enabled
    ? {
        mode: config.enabled ? "active" : "shadow",
        policyVersion: config.policyVersion,
      selectedPolicyLabel: config.selectedPolicyLabel,
      scorerKind: config.scorerKind,
        blendWeight: round3(config.blendWeight),
        abstainThreshold: round3(config.abstainThreshold),
        heuristicSelectedStrategyId: heuristicSelected.id,
        adaptiveSelectedStrategyId: adaptiveSelected.id,
        effectiveSelectedStrategyId: effectiveSelected.id,
        disagreement,
        abstained,
        overrideApplied,
        candidateScores: candidateScores.map((candidate) => ({
          strategyId: candidate.strategy.id,
          heuristicScore: round3(candidate.heuristicScore),
          artifactValueScore: round3(candidate.artifactValueScore),
          blendedScore: round3(candidate.blendedScore),
          heuristicSelected: candidate.strategy.id === heuristicSelected.id,
          adaptiveSelected: candidate.strategy.id === adaptiveSelected.id,
        })),
      }
    : null;

  if (!overrideApplied) {
    return {
      guidance: {
        ...guidance,
        metadata: {
          ...guidance.metadata,
          candidateStrategies: updatedStrategies,
          selectedStrategy: updatedStrategies.find((strategy) => strategy.id === heuristicSelected.id) || heuristicSelected,
        },
      },
      telemetry,
    };
  }

  return {
    guidance: {
      response: {
        ...guidance.response,
        final_answer: effectiveSelected.hint,
        reasoning: `Applied the ${config.selectedPolicyLabel} adaptive policy artifact over ${updatedStrategies.length} tutoring candidates while preserving the heuristic tutoring controller as the default path.`,
        confidence: effectiveSelected.confidence,
        trajectory_score: effectiveSelected.score,
      },
      metadata: {
        ...guidance.metadata,
        candidateStrategies: updatedStrategies,
        selectedStrategy: updatedStrategies.find((strategy) => strategy.id === effectiveSelected.id) || effectiveSelected,
      },
    },
    telemetry,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function createTraceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}