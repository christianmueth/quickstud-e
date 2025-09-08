import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// grade: 0=Again, 1=Hard, 2=Good, 3=Easy
function updateSm2(card: any, grade: number) {
  const now = new Date();
  let { ease, interval, repetitions } = card as { ease: number; interval: number; repetitions: number };

  if (grade < 2) {
    repetitions = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * ease);
    // ease adjustment
    const diff = 3 - grade;                 // 0 for Easy, 1 for Good, 2 for Hard
    ease = ease + 0.1 - diff * (0.08 + diff * 0.02);
    ease = Math.max(1.3, parseFloat(ease.toFixed(2)));
  }

  const dueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
  return { ease, interval, repetitions, dueAt, lastReviewedAt: now };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { cardId, grade } = await req.json();

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: { deck: { include: { user: true } } },
  });
  if (!card || card.deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  const updates = updateSm2(card, Math.max(0, Math.min(3, Number(grade))));
  await prisma.card.update({ where: { id: card.id }, data: updates });
  return new Response(null, { status: 204 });
}
