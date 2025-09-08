// app/api/deck/[id]/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";

function getDeckIdFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => p === "deck");
  return i >= 0 && i + 1 < parts.length ? parts[i + 1] : null;
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const id = getDeckIdFromUrl(req);
  if (!id) return new Response("Bad Request", { status: 400 });

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!deck || deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  await prisma.card.deleteMany({ where: { deckId: id } });
  await prisma.deck.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
