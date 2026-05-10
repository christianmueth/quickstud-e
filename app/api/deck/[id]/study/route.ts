import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

const SRS_ENABLED = process.env.SRS_ENABLED === "1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const focusConcept = clean(url.searchParams.get("concept"));

  const deck = await prisma.deck.findFirst({
    where: { id, user: { clerkUserId: userId } },
    select: { id: true },
  });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const take = 30;

  if (SRS_ENABLED) {
    try {
      const cards = await prisma.card.findMany({
        where: { deckId: deck.id, OR: [{ srsReps: 0 }, { srsDueAt: { lte: now } }] } as any,
        orderBy: [{ srsDueAt: "asc" } as any, { createdAt: "asc" }],
        take: focusConcept ? Math.max(take * 3, 90) : take,
        select: { id: true, question: true, answer: true, srsReps: true, srsDueAt: true } as any,
      });
      return NextResponse.json({ cards: prioritizeCards(cards, focusConcept).slice(0, take) });
    } catch { /* fall through */ }
  }

  const cards = await prisma.card.findMany({
    where: { deckId: deck.id },
    orderBy: { createdAt: "asc" },
    take: focusConcept ? Math.max(take * 3, 90) : take,
    select: { id: true, question: true, answer: true },
  });
  return NextResponse.json({ cards: prioritizeCards(cards, focusConcept).slice(0, take) });
}

function prioritizeCards<T extends { question: string; answer: string }>(cards: T[], focusConcept: string | null): T[] {
  if (!focusConcept) return cards;

  const query = focusConcept.toLowerCase();
  return [...cards].sort((left, right) => scoreCard(right, query) - scoreCard(left, query));
}

function scoreCard(card: { question: string; answer: string }, focusConcept: string): number {
  const question = String(card.question || "").toLowerCase();
  const answer = String(card.answer || "").toLowerCase();
  let score = 0;
  if (question.includes(focusConcept)) score += 3;
  if (answer.includes(focusConcept)) score += 2;
  const tokens = focusConcept.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (question.includes(token)) score += 1;
    if (answer.includes(token)) score += 1;
  }
  return score;
}

function clean(value: string | null): string | null {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}
