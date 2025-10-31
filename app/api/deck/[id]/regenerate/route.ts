import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

const MODEL = "gpt-4o-mini";

function buildPrompt(source: string, count: number) {
  return `You are an expert study coach. Create ${count} concise Q/A flashcards from the text below.
Return ONLY JSON array like:
[{"q":"...","a":"..."}]

Text:
${source}`;
}

function strip(s: string) {
  return s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    count?: number; temperature?: number; model?: string; append?: boolean;
  };

  const deck = await prisma.deck.findFirst({
    where: { id, user: { clerkUserId: userId } },
    select: { id: true, title: true, source: true },
  });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!deck.source) return NextResponse.json({ error: "No source to regenerate from" }, { status: 400 });

  const cnt = Math.min(Math.max(Number(body.count || 12), 5), 50);
  const temp = Math.max(0, Math.min(1, Number(body.temperature ?? 0.2)));
  const model = (body.model || MODEL).trim();
  const append = !!body.append;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: buildPrompt(deck.source.slice(0, 20000), cnt) },
      ],
      temperature: temp,
    }),
  });
  if (!resp.ok) return NextResponse.json({ error: "OpenAI error" }, { status: 500 });
  const data = await resp.json();
  const content = strip(data?.choices?.[0]?.message?.content || "[]");

  let parsed: Array<{ q?: string; a?: string }> = [];
  try { parsed = JSON.parse(content); } catch { parsed = []; }
  const cards = parsed
    .filter((c) => c && typeof c === "object" && typeof c.q === "string" && typeof c.a === "string")
    .map((c) => ({ question: c.q!.slice(0, 500), answer: c.a!.slice(0, 2000) }));

  if (!cards.length) return NextResponse.json({ error: "No cards produced" }, { status: 400 });

  if (!append) await prisma.card.deleteMany({ where: { deckId: deck.id } });
  await prisma.card.createMany({ data: cards.map((c) => ({ deckId: deck.id, ...c })) });

  return NextResponse.json({ ok: true, added: cards.length });
}
