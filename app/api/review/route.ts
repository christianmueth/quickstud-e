import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { Card, Deck, User } from "@prisma/client";

export const runtime = "nodejs";

type Sm2Updatable = Pick<Card, "ease" | "interval" | "repetitions">;
type Sm2Result = Pick<Card, "ease" | "interval" | "repetitions" | "dueAt" | "lastReviewedAt">;

function updateSm2(card: Sm2Updatable, grade: number): Sm2Result {
  const now = new Date();
  let { ease, interval, repetitions } = card;

  const clamped = Math.max(0, Math.min(3, grade));

  if (clamped < 2) {
    repetitions = 0;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * ease);

    const diff = 3 - clamped;
    ease = ease + 0.1 - diff * (0.08 + diff * 0.02);
    ease = Math.max(1.3, parseFloat(ease.toFixed(2)));
  }

  const dueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
  return { ease, interval, repetitions, dueAt, lastReviewedAt: now };
}

type CardWithDeckUser = Card & { deck: Deck & { user: User } };

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { cardId, grade } = (await req.json().catch(() => ({}))) as { cardId?: string; grade?: number };
  if (!cardId) return new Response("Bad Request", { status: 400 });

  const card = (await prisma.card.findUnique({
    where: { id: cardId },
    include: { deck: { include: { user: true } } },
  })) as CardWithDeckUser | null;

  if (!card || card.deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  const updates = updateSm2(card, Number.isFinite(grade) ? (grade as number) : 0);
  await prisma.card.update({ where: { id: card.id }, data: updates });
  return new Response(null, { status: 204 });
}
