import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

function csvEscape(s: string) {
  const needs = s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r");
  const out = s.replace(/"/g, '""');
  return needs ? `"${out}"` : out;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const deck = await prisma.deck.findFirst({
    where: { id, user: { clerkUserId: userId } },
    include: { cards: { orderBy: { createdAt: "asc" }, select: { question: true, answer: true } } },
  });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(_req.url);
  const fmt = (url.searchParams.get("fmt") || "csv").toLowerCase(); // csv | tsv | anki-tsv

  let content = "";
  let filename = `${deck.title || "deck"}.${fmt === "csv" ? "csv" : "tsv"}`.replace(/\s+/g, "_");

  if (fmt === "csv") {
    content = ["Question,Answer", ...deck.cards.map(c => `${csvEscape(c.question)},${csvEscape(c.answer)}`)].join("\r\n");
  } else {
    // tsv & anki-tsv (both are tab-separated, Anki can import TSV)
    const sep = "\t";
    content = ["Question\tAnswer", ...deck.cards.map(c => [c.question, c.answer].join(sep))].join("\n");
    filename = `${deck.title || "deck"}.${fmt === "tsv" ? "tsv" : "tsv"}`.replace(/\s+/g, "_");
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": fmt === "csv" ? "text/csv; charset=utf-8" : "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
