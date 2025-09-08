// app/api/deck/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return new Response("Unauthorized", { status: 401 });

  const user = await prisma.user.findUnique({
    where: { clerkUserId: clerkId },
    select: { id: true },
  });
  if (!user) return new Response("Unauthorized", { status: 401 });

  const deck = await prisma.deck.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  });
  if (!deck || deck.userId !== user.id) return new Response("Not found", { status: 404 });

  // Cascade delete
  await prisma.card.deleteMany({ where: { deckId: deck.id } });
  await prisma.deck.delete({ where: { id: deck.id } });

  return new Response(null, { status: 204 });
}
