import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createReasoningResponse } from "@/lib/reasoningEngine/contracts";
import { persistReasoningResponseRun } from "@/lib/reasoningEngine/persistence";

type CoachingContext = {
  prompt?: string;
  studentAnswer?: string;
  expectedAnswer?: string;
  misconceptionSignals?: string[];
  weakTopicMatches?: string[];
  studentState?: {
    weakConcepts?: string[];
    misconceptionPatterns?: string[];
    confidenceProfile?: Record<string, unknown>;
    retentionProfile?: Record<string, unknown>;
    pacingProfile?: Record<string, unknown>;
    preferredExplanationStyle?: string | null;
    recentFailures?: string[];
    recentSuccesses?: string[];
    updatedAt?: string | null;
    createdAt?: string | null;
  } | null;
  verification?: {
    confidence?: number;
    final_answer?: string;
    reasoning?: string;
  };
  selectedStrategy?: {
    id?: string;
    label?: string;
    hint?: string;
    rationale?: string;
    score?: number;
    confidence?: number;
    strategyType?: string;
  };
};

function schedule(ease: number, reps: number, interval: number, rating: "again"|"good"|"easy") {
  let newEase = ease;
  let newReps = reps;
  let newInterval = interval;

  if (rating === "again") {
    newEase = Math.max(1.3, ease - 0.2);
    newReps = 0;
    return { ease: newEase, reps: newReps, intervalDays: 0, minutes: 10, lapse: true };
  }
  if (rating === "good") {
    newEase = Math.max(1.3, ease - 0.02);
    newReps = reps + 1;
    if (reps < 1) newInterval = 1;
    else if (reps < 2) newInterval = 3;
    else newInterval = Math.round(interval * newEase);
    return { ease: newEase, reps: newReps, intervalDays: Math.max(1, newInterval), minutes: 0, lapse: false };
  }
  // easy
  newEase = ease + 0.15;
  newReps = reps + 1;
  if (reps < 1) newInterval = 2;
  else if (reps < 2) newInterval = 4;
  else newInterval = Math.round(interval * newEase * 1.2);
  return { ease: newEase, reps: newReps, intervalDays: Math.max(1, newInterval), minutes: 0, lapse: false };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    cardId?: string;
    rating?: "again"|"good"|"easy";
    coachingContext?: CoachingContext;
  } | null;
  if (!body?.cardId || !body?.rating) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Select only safe fields if SRS cols aren’t present
  const card = await prisma.card.findFirst({
    where: { id: body.cardId, deck: { user: { clerkUserId: userId } } },
    // use `as any` to avoid TS errors pre-migration
    select: { id: true, deckId: true, question: true, answer: true, srsEase: true, srsReps: true, srsIntervalDays: true } as any,
  });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const { ease, reps, intervalDays, minutes, lapse } = schedule(
    (card as any).srsEase ?? 2.5,
    (card as any).srsReps ?? 0,
    (card as any).srsIntervalDays ?? 0,
    body.rating
  );

  const nextDue = new Date(now);
  if (minutes && minutes > 0) nextDue.setMinutes(nextDue.getMinutes() + minutes);
  else nextDue.setDate(nextDue.getDate() + intervalDays);

  // Try to write SRS fields; if schema lacks them, fall back silently
  try {
    await prisma.card.update({
      where: { id: card.id },
      data: {
        srsEase: ease,
        srsReps: reps,
        srsIntervalDays: intervalDays,
        srsLapses: { increment: lapse ? 1 : 0 } as any,
        srsDueAt: nextDue,
        lastReviewedAt: now,
      } as any,
    });
  } catch {
    // fallback: just touch updatedAt so something changes
    await prisma.card.update({ where: { id: card.id }, data: { updatedAt: new Date() } }).catch(() => {});
  }

  // Gamified XP/streak — attempt if columns exist, otherwise ignore
  try {
    const user = await prisma.user.findFirst({
      where: { clerkUserId: userId },
      select: { id: true, xp: true, studyStreak: true, lastStudyDate: true } as any,
    });
    if (user) {
      const xpGain = body.rating === "easy" ? 5 : body.rating === "good" ? 3 : 1;
      const today = new Date(); today.setHours(0,0,0,0);
      const last = user.lastStudyDate ? new Date(user.lastStudyDate as any) : null;
      const lastDay = last ? (last.setHours(0,0,0,0), last) : null;

      let streak = (user.studyStreak as any) || 0;
      if (!lastDay || Number(today) - Number(lastDay) >= 86_400_000) {
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        if (lastDay && Number(lastDay) === Number(yesterday)) streak += 1;
        else streak = 1;
      }
      await prisma.user.update({
        where: { id: user.id as any },
        data: { xp: ((user.xp as any) ?? 0) + xpGain, studyStreak: streak, lastStudyDate: new Date() } as any,
      });
    }
  } catch {
    // ignore if XP/streak columns aren’t there yet
  }

  try {
    const coaching = body.coachingContext;
    if (coaching?.selectedStrategy || coaching?.misconceptionSignals?.length || coaching?.verification) {
      const user = await prisma.user.findFirst({
        where: { clerkUserId: userId },
        select: { id: true },
      });

      if (user) {
        const priorConfidence = toFiniteNumber(coaching.verification?.confidence);
        const recovered = body.rating !== "again";
        const stabilized = body.rating === "easy" || (body.rating === "good" && priorConfidence >= 0.35);
        const postReviewConfidence = estimatePostReviewConfidence(body.rating, priorConfidence);

        await persistReasoningResponseRun({
          userId: user.id,
          deckId: (card as any).deckId,
          mode: "study_recovery",
          origin: "study_carousel",
          title: "Inline study recovery outcome",
          prompt: coaching.prompt || (card as any).question,
          response: createReasoningResponse({
            final_answer: recovered
              ? "Student recovered after coaching and continued the card."
              : "Student remained unstable after coaching and marked the card again.",
            reasoning: recovered
              ? `The coached intervention ${coaching.selectedStrategy?.label || "selected strategy"} led to a ${body.rating} outcome.`
              : `The coached intervention ${coaching.selectedStrategy?.label || "selected strategy"} did not yet stabilize recall; the card was marked again.`,
            confidence: postReviewConfidence,
            trajectory_score: stabilized ? 0.82 : recovered ? 0.62 : 0.28,
            search_depth: 1,
          }),
          verificationApplied: true,
          metadata: {
            cardId: body.cardId,
            rating: body.rating,
            recovered,
            stabilized,
            priorConfidence,
            postReviewConfidence,
            confidenceDelta: round3(postReviewConfidence - priorConfidence),
            misconceptionSignals: coaching.misconceptionSignals || [],
            weakTopicMatches: coaching.weakTopicMatches || [],
            studentState: coaching.studentState || null,
            studentAnswer: truncate(coaching.studentAnswer),
            expectedAnswer: truncate(coaching.expectedAnswer || (card as any).answer),
            verification: coaching.verification || null,
            selectedStrategy: coaching.selectedStrategy || null,
          } as Prisma.InputJsonValue,
          candidatesSelected: 1,
        });
      }
    }
  } catch {
    // recovery persistence is additive and should not block grading
  }

  return NextResponse.json({ ok: true, nextDue });
}

function estimatePostReviewConfidence(rating: "again"|"good"|"easy", priorConfidence: number): number {
  if (rating === "again") return round3(Math.max(0.12, priorConfidence * 0.55));
  if (rating === "easy") return round3(Math.min(0.96, Math.max(priorConfidence + 0.32, 0.82)));
  return round3(Math.min(0.88, Math.max(priorConfidence + 0.2, 0.64)));
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function truncate(value: unknown, max = 400): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
