// app/api/card/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { Card, Deck, User } from "@prisma/client";

export const runtime = "nodejs";

type RouteContext = { params: Record<string, string | string[]> };

type CardWithDeckUser = Card & { deck: Deck & { user: User } };

export async function PATCH(req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // Get id as a single string even if framework passes an array
  const rawId = context.params["id"];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) return new Response("Bad Request", { status: 400 });

  // Parse body safely
  const body = (await req.json().catch(() => ({}))) as Partial<{
    question: string;
    answer: string;
  }>;

  const question = typeof body.question === "string" ? body.question.slice(0, 500) : undefined;
  const answer = typeof body.answer === "string" ? body.answer.slice(0, 2000) : undefined;

  const card = (await prisma.card.findUnique({
    where: { id },
    include: { deck: { include: { user: true } } },
  })) as CardWithDeckUser | null;

  if (!card || card.deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  await prisma.card.update({ where: { id }, data: { question, answer } });
  return new Response(null, { status: 204 });
}
