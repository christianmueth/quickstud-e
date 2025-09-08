import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4o-mini";
const MAX_CARDS = 25;

type CardJSON = { q: string; a: string };

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

function safeParseCards(raw: unknown): CardJSON[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(stripCodeFences(raw));
    if (!Array.isArray(parsed)) return [];
    const out: CardJSON[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const q = typeof obj.q === "string" ? obj.q : "";
        const a = typeof obj.a === "string" ? obj.a : "";
        if (q && a) out.push({ q, a });
      }
    }
    return out.slice(0, MAX_CARDS);
  } catch {
    return [];
  }
}

function fallbackCards(
  reason: "no_text_from_upload" | "no_api_key" | "empty_source",
): CardJSON[] {
  const common: CardJSON[] = [
    { q: "What does this deck do?", a: "It generates flashcards from pasted text, PPTX, or PDF uploads." },
    { q: "How many cards are created?", a: `About 10–${MAX_CARDS}, depending on the content.` },
  ];
  if (reason === "no_text_from_upload") {
    return [
      {
        q: "Why no cards from my PDF?",
        a: "We couldn't extract selectable text from the uploaded file (likely a scanned/image-based PDF). Try a text-based PDF or paste the text.",
      },
      ...common,
    ];
  }
  if (reason === "no_api_key") {
    return [
      {
        q: "Why default cards?",
        a: "OPENAI_API_KEY is missing or invalid. Add it to .env.local and restart the dev server.",
      },
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

    const stack: unknown[] = [json];
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
        for (const k of Object.keys(node)) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          stack.push((node as Record<string, unknown>)[k]);
        }
      }
    }
    if (texts.length) chunks.push(texts.join(" "));
  }
  return chunks.join("\n\n").trim();
}

/** PDF → text (uses pdf-parse). Note: image-only PDFs will return empty. */
async function extractPdfText(file: File): Promise<string> {
  // Define the function type we expect from pdf-parse
  type PdfParseFn = (data: Buffer, options?: unknown) => Promise<{ text?: string }>;

  let pdfParse: PdfParseFn;
  try {
    const m = (await import("pdf-parse/lib/pdf-parse.js")) as { default: PdfParseFn } | PdfParseFn;
    pdfParse = (typeof m === "function" ? m : m.default) as PdfParseFn;
  } catch {
    const m = (await import("pdf-parse")) as { default: PdfParseFn } | PdfParseFn;
    pdfParse = (typeof m === "function" ? m : m.default) as PdfParseFn;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const data = await pdfParse(buf, { max: 0 });
  return (data?.text || "").trim();
}

function isFile(val: FormDataEntryValue | null): val is File {
  if (typeof val !== "object" || val === null) return false;
  const maybe = val as File;
  return typeof maybe.name === "string" && typeof maybe.arrayBuffer === "function";
}

/** Find the uploaded file under common field names */
function getUpload(form: FormData): File | null {
  const fields = ["file", "pptx", "pdf"];
  for (const key of fields) {
    const v = form.get(key);
    if (isFile(v)) return v;
  }
  return null;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));

  const form = await req.formData();
  const title = String(form.get("title") || "Untitled Deck").slice(0, 120).trim();

  let source = String(form.get("source") || "").trim();
  const upload = getUpload(form);
  const hasUpload = upload !== null;

  // Extract from file if no pasted text
  if (!source && upload) {
    try {
      const name = (upload.name ?? "").toLowerCase();
      const type = (upload as File & { type?: string }).type ?? "";
      if (name.endsWith(".pptx") || type.includes("presentation")) {
        source = await extractPptxText(upload);
      } else if (name.endsWith(".pdf") || type === "application/pdf") {
        source = await extractPdfText(upload);
      } else {
        source = (await extractPptxText(upload).catch(() => "")) || (await extractPdfText(upload).catch(() => ""));
      }
    } catch (e) {
      console.error("File parse failed:", e);
    }
  }

  if (!source && !hasUpload) {
    return NextResponse.json({ error: "No content provided" }, { status: 400 });
  }

  const sourceClamped = (source || "").slice(0, 20_000);

  // Ensure user + create deck
  await prisma.user.upsert({ where: { clerkUserId: userId }, update: {}, create: { clerkUserId: userId } });
  const deck = await prisma.deck.create({
    data: { title, source: sourceClamped, user: { connect: { clerkUserId: userId } } },
    select: { id: true },
  });

  // AI (with fallbacks)
  let cards: CardJSON[] = [];
  try {
    if (!process.env.OPENAI_API_KEY) {
      cards = fallbackCards("no_api_key");
    } else if (!sourceClamped) {
      cards = fallbackCards("no_text_from_upload");
    } else {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
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
        cards = fallbackCards("no_api_key");
      } else {
        const data = (await resp.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data?.choices?.[0]?.message?.content ?? "[]";
        cards = safeParseCards(content);
        if (!cards.length) cards = fallbackCards("empty_source");
      }
    }
  } catch (e) {
    console.error("AI generation failed:", e);
    cards = fallbackCards("empty_source");
  }

  if (cards.length) {
    await prisma.card.createMany({
      data: cards.map(({ q, a }) => ({
        deckId: deck.id,
        question: q.slice(0, 500),
        answer: a.slice(0, 2000),
      })),
    });
  }

  return NextResponse.redirect(new URL(`/app/deck/${deck.id}`, req.url), { status: 303 });
}
