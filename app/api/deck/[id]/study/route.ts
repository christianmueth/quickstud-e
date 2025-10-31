import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

const SRS_ENABLED = process.env.SRS_ENABLED === "1";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

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
        take,
        select: { id: true, question: true, answer: true, srsReps: true, srsDueAt: true } as any,
      });
      return NextResponse.json({ cards });
    } catch { /* fall through */ }
  }

  const cards = await prisma.card.findMany({
    where: { deckId: deck.id },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, question: true, answer: true },
  });
  return NextResponse.json({ cards });
}
