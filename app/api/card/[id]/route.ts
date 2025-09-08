import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.slice(0, 500) : undefined;
  const answer = typeof body.answer === "string" ? body.answer.slice(0, 2000) : undefined;

  const card = await prisma.card.findUnique({
    where: { id: params.id },
    include: { deck: { include: { user: true } } },
  });
  if (!card || card.deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  await prisma.card.update({ where: { id: params.id }, data: { question, answer } });
  return new Response(null, { status: 204 });
}
