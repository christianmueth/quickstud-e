import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { isInternalOperator } from "@/lib/internalAccess";
import {
  getRunMisconceptionSignals,
  normalizeReasoningCandidateRow,
  normalizeReasoningRunRow,
  summarizeReasoningRuns,
  summarizeReplayCandidates,
} from "@/lib/reasoningEngine/analytics";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isInternalOperator(userId)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const mode = clean(url.searchParams.get("mode"));
    const misconception = clean(url.searchParams.get("misconception"));
    const runId = clean(url.searchParams.get("runId"));
    const limit = clampLimit(url.searchParams.get("limit"));
    const includeCandidates = isTruthy(url.searchParams.get("includeCandidates"));
    const candidateLimit = clampCandidateLimit(url.searchParams.get("candidateLimit"));

    const user = await prisma.user.findFirst({
      where: { clerkUserId: userId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: true, runs: [], analytics: summarizeReasoningRuns([]) });
    }

    const fetchTake = misconception && !runId ? Math.max(limit * 5, 200) : limit;

    const runs = await prisma.reasoningRun.findMany({
      where: {
        userId: user.id,
        ...(runId ? { id: runId } : {}),
        ...(mode ? { mode } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: fetchTake,
      select: {
        id: true,
        mode: true,
        title: true,
        origin: true,
        confidence: true,
        trajectoryScore: true,
        searchDepth: true,
        beamWidth: true,
        candidatesGenerated: true,
        candidatesSelected: true,
        prunedCount: true,
        verificationApplied: true,
        metadata: true,
        createdAt: true,
        deckId: true,
        ...(includeCandidates
          ? {
              candidates: {
                orderBy: [{ rank: "asc" }, { createdAt: "asc" }],
                take: candidateLimit,
                select: {
                  id: true,
                  rank: true,
                  question: true,
                  answer: true,
                  score: true,
                  verificationConfidence: true,
                  selected: true,
                  pruned: true,
                  trajectoryDepth: true,
                  sourceAttempt: true,
                  difficulty: true,
                  createdAt: true,
                },
              },
            }
          : {}),
      },
    });

    const filteredRuns = misconception
      ? runs.filter((run) => getRunMisconceptionSignals(run).includes(misconception))
      : runs;

    const visibleRuns = runId ? filteredRuns : filteredRuns.slice(0, limit);

    const normalizedRuns = visibleRuns.map((run) => {
      const base = normalizeReasoningRunRow(run);
      if (!includeCandidates) return base;
      const candidates = (run as typeof run & { candidates?: Array<Parameters<typeof normalizeReasoningCandidateRow>[0]> }).candidates || [];
      return {
        ...base,
        replay: {
          summary: summarizeReplayCandidates(candidates),
          candidates: candidates.map(normalizeReasoningCandidateRow),
        },
      };
    });

    return NextResponse.json({
      ok: true,
      filter: {
        mode: mode || null,
        misconception: misconception || null,
        runId: runId || null,
        limit,
        includeCandidates,
        candidateLimit,
      },
      analytics: summarizeReasoningRuns(visibleRuns),
      runs: normalizedRuns,
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    const missingTable = /ReasoningRun|relation .* does not exist|table .* does not exist/i.test(message);

    return NextResponse.json(
      {
        ok: false,
        error: missingTable
          ? "Reasoning runs are not available yet. Apply the latest Prisma migration before using this endpoint."
          : "Failed to load reasoning runs.",
      },
      { status: missingTable ? 503 : 500 }
    );
  }
}

function clampLimit(raw: string | null): number {
  const parsed = Number(raw || 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function clampCandidateLimit(raw: string | null): number {
  const parsed = Number(raw || 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function clean(value: string | null): string | null {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function isTruthy(value: string | null): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}