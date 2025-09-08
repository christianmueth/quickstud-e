// app/api/deck/[id]/export/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function getDeckIdFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../api/deck/:id/export
  const i = parts.findIndex((p) => p === "deck");
  return i >= 0 && i + 1 < parts.length ? parts[i + 1] : null;
}

function csvEscape(s: string) {
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function filenameSafe(s: string) {
  return s.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 60);
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const id = getDeckIdFromUrl(req);
  if (!id) return new Response("Bad Request", { status: 400 });

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: { cards: { orderBy: { createdAt: "asc" } }, user: true },
  });
  if (!deck || deck.user.clerkUserId !== userId) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const fmt = (url.searchParams.get("fmt") || "csv").toLowerCase();
  const name = filenameSafe(deck.title || "deck");

  if (fmt === "xlsx" || fmt === "excel") {
    // Strictly typed dynamic import of xlsx
    type XlsxModule = typeof import("xlsx");
    const { utils, write } = (await import("xlsx")) as XlsxModule;

    const aoa: (string[])[] = [["question", "answer"], ...deck.cards.map((c) => [c.question, c.answer])];
    const wb = utils.book_new();
    const ws = utils.aoa_to_sheet(aoa);
    utils.book_append_sheet(wb, ws, "Cards");
    const buf: ArrayBuffer = write(wb, { bookType: "xlsx", type: "array" });

    return new Response(Buffer.from(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (fmt === "tsv" || fmt === "anki") {
    const tsv = ["question\tanswer", ...deck.cards.map((c) => `${c.question}\t${c.answer}`)].join("\r\n");
    return new Response(tsv, {
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.tsv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // CSV with BOM + CRLF for Excel friendliness
  const header = "question,answer";
  const csvLF = [header, ...deck.cards.map((c) => `${csvEscape(c.question)},${csvEscape(c.answer)}`)].join("\n");
  const csvCRLF = csvLF.replace(/\n/g, "\r\n");
  const bom = "\uFEFF";
  return new Response(bom + csvCRLF, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
