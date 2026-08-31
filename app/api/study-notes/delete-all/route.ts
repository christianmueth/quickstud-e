import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.deck.deleteMany({
    where: {
      user: { clerkUserId: userId },
      cards: { some: { question: "__STUDY_NOTE__" } },
    },
  });

  return NextResponse.json({ ok: true });
}