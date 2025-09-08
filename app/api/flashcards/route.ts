// app/api/flashcards/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4o-mini";
const MAX_CARDS = 25;

function buildPrompt(source: string) {
  return `You are an expert study coach.
Extract concise Q/A flashcards from the text below.

Rules:
- Return ONLY valid JSON (no backticks).
- 10–${MAX_CARDS} cards when content allows.
- Short, precise questions; answers 1–3 sentences or a formula.

TEXT:
${source}

Return JSON as:
[
  {"q":"Question?","a":"Answer."}
]`;
}

function stripCodeFences(s: string) {
  return s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}
function safeParseCards(raw: unknown): Array<{ q: string; a: string }> {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => ({ q: String((c as any)?.q || ""), a: String((c as any)?.a || "") }))
      .filter((c) => c.q && c.a)
      .slice(0, MAX_CARDS);
  } catch {
    return [];
  }
}

// more helpful fallback that tells you what happened
function fallbackCards(reason: "no_text_from_upload" | "no_api_key" | "empty_source") {
  const common = [
    { q: "What does this deck do?", a: "It generates flashcards from pasted text, PPTX, or PDF uploads." },
    { q: "How many cards are created?", a: `About 10–${MAX_CARDS}, depending on the content.` },
  ];
  if (reason === "no_text_from_upload") {
    return [
      { q: "Why no cards from my PDF?", a: "We couldn't extract selectable text from the uploaded file (likely a scanned/image-based PDF). Try a text-based PDF or paste the text." },
      ...common,
    ];
  }
  if (reason === "no_api_key") {
    return [
      { q: "Why default cards?", a: "OPENAI_API_KEY is missing or invalid. Add it to .env.local and restart the dev server." },
      ...common,
    ];
  }
  return common;
}

/** PPTX → text (walk slide XMLs and collect leaf strings) */
async function extractPptxText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const parser = new XMLParser({ ignoreAttributes: true, attributeNamePrefix: "@_", textNodeName: "#text" });

  const slideNames = Object.keys(zip.files)
    .filter((n) => n.startsWith("ppt/slides/slide") && n.endsWith(".xml"))
    .sort();

  const chunks: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const json = parser.parse(xml);

    const stack: any[] = [json];
    const texts: string[] = [];
    while (stack.length) {
      const node = stack.pop();
      if (node == null) continue;
      if (typeof node === "string") {
        const s = node.trim();
        if (s) texts.push(s);
        continue;
      }
      if (Array.isArray(node)) {
        for (const v of node) stack.push(v);
        continue;
      }
      if (typeof node === "object") {
        for (const k of Object.keys(node)) stack.push((node as any)[k]);
      }
    }
    if (texts.length) chunks.push(texts.join(" "));
  }
  return chunks.join("\n\n").trim();
}

/** PDF → text (uses pdf-parse). Note: image-only PDFs will return empty. */
async function extractPdfText(file: File): Promise<string> {
  // Try the internal path that tends to work better under bundlers, then fall back
  let pdfParse: any;
  try {
    const m = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = (m as any).default || m;
  } catch {
    const m = await import("pdf-parse");
    pdfParse = (m as any).default || m;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const data = await pdfParse(buf, { max: 0 }); // 0 = all pages
  return (data?.text || "").trim();
}

/** Find the uploaded file under common field names */
function getUpload(form: FormData): File | null {
  const fields = ["file", "pptx", "pdf"];
  for (const key of fields) {
    const v: any = form.get(key);
    if (v && typeof v.arrayBuffer === "function" && typeof v.name === "string") {
      return v as File;
    }
  }
  return null;
}

export async function POST(req: Request) {
  // AUTH
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));

  // FORM
  const form = await req.formData();
  const title = String(form.get("title") || "Untitled Deck").slice(0, 120).trim();

  let source = String(form.get("source") || "").trim();
  const upload = getUpload(form);
  const hasUpload = !!upload;

  // Extract from file if no pasted text
  if (!source && hasUpload) {
    try {
      const name = upload!.name ?? "";
      const lower = name.toLowerCase();
      const type = (upload as any).type || "";
      console.log("[upload]", { name, type, size: (upload as any).size });

      if (lower.endsWith(".pptx") || type.includes("presentation")) {
        source = await extractPptxText(upload!);
      } else if (lower.endsWith(".pdf") || type === "application/pdf") {
        source = await extractPdfText(upload!);
      } else {
        // Best-effort: try both
        source =
          (await extractPptxText(upload!).catch(() => "")) ||
          (await extractPdfText(upload!).catch(() => ""));
      }

      console.log("[extraction] chars=", source?.length ?? 0);
      if (!source) console.warn("Upload present but no textual content extracted (likely scanned).");
    } catch (e) {
      console.error("File parse failed:", e);
    }
  }

  // If neither text nor a file present at all → 400
  if (!source && !hasUpload) {
    return NextResponse.json({ error: "No content provided" }, { status: 400 });
  }

  const sourceClamped = (source || "").slice(0, 20000);

  // USER + DECK
  await prisma.user.upsert({
    where: { clerkUserId: userId },
    update: {},
    create: { clerkUserId: userId },
  });

  const deck = await prisma.deck.create({
    data: { title, source: sourceClamped, user: { connect: { clerkUserId: userId } } },
    select: { id: true },
  });

  // AI
  let cards: Array<{ q: string; a: string }> = [];
  try {
    if (!process.env.OPENAI_API_KEY) {
      cards = fallbackCards("no_api_key");
    } else if (!sourceClamped) {
      // We had a file but could not extract text → tell the user plainly
      cards = fallbackCards("no_text_from_upload");
    } else {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "Return only valid JSON. No commentary." },
            { role: "user", content: buildPrompt(sourceClamped) },
          ],
          temperature: 0.2,
        }),
      });

      if (!resp.ok) {
        console.error("OpenAI error:", await resp.text());
        cards = fallbackCards("no_api_key"); // generic fallback
      } else {
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content ?? "[]";
        cards = safeParseCards(content);
        if (!cards.length) cards = fallbackCards("empty_source");
      }
    }
  } catch (e) {
    console.error("AI generation failed:", e);
    cards = fallbackCards("empty_source");
  }

  // SAVE
  if (cards.length) {
    await prisma.card.createMany({
      data: cards.map(({ q, a }) => ({
        deckId: deck.id,
        question: q.slice(0, 500),
        answer: a.slice(0, 2000),
      })),
    });
  }

  // REDIRECT (303 → follow-up is a GET)
  return NextResponse.redirect(new URL(`/app/deck/${deck.id}`, req.url), { status: 303 });
}
