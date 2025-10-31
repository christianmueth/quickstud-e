import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question, answer } = (await req.json().catch(() => ({}))) as { question?: string; answer?: string };
  const q = (question ?? "").trim().slice(0, 500);
  const a = (answer ?? "").trim().slice(0, 2000);

  // ensure ownership via join
  const card = await prisma.card.findFirst({
    where: { id: params.id, deck: { user: { clerkUserId: userId } } },
    select: { id: true },
  });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.card.update({
    where: { id: params.id },
    data: {
      ...(q ? { question: q } : {}),
      ...(a ? { answer: a } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const card = await prisma.card.findFirst({
    where: { id: params.id, deck: { user: { clerkUserId: userId } } },
    select: { id: true },
  });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.card.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
