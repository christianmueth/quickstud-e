import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

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

  const body = (await req.json().catch(() => null)) as { cardId?: string; rating?: "again"|"good"|"easy" } | null;
  if (!body?.cardId || !body?.rating) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Select only safe fields if SRS cols aren’t present
  const card = await prisma.card.findFirst({
    where: { id: body.cardId, deck: { user: { clerkUserId: userId } } },
    // use `as any` to avoid TS errors pre-migration
    select: { id: true, deckId: true, srsEase: true, srsReps: true, srsIntervalDays: true } as any,
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

  return NextResponse.json({ ok: true, nextDue });
}
