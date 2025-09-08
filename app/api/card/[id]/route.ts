// app/api/card/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { Card, Deck, User } from "@prisma/client";

export const runtime = "nodejs";

type CardWithDeckUser = Card & { deck: Deck & { user: User } };

function getCardIdFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../api/card/:id
  const i = parts.findIndex((p) => p === "card");
  return i >= 0 && i + 1 < parts.length ? parts[i + 1] : null;
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const id = getCardIdFromUrl(req);
  if (!id) return new Response("Bad Request", { status: 400 });

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
