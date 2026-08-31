import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await prisma.deck.findFirst({
    where: {
      id,
      user: { clerkUserId: userId },
      cards: { some: { question: "__STUDY_NOTE__" } },
    },
    select: { id: true },
  });

  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.deck.delete({ where: { id: note.id } });
  return NextResponse.json({ ok: true });
}