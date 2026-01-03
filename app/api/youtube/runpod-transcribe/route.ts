import { NextResponse } from "next/server";
import { transcribeYoutubeUrlWithRunpod } from "@/lib/runpodYoutubeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHeaderTestBypass(req: Request): boolean {
  const testKey = process.env.FLASHCARDS_TEST_KEY;
  if (!testKey) return false;
  return req.headers.get("x-flashcards-test-key") === testKey;
}

async function readUrlFromRequest(req: Request): Promise<string> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as any;
    return String(body?.url || body?.youtubeUrl || "").trim();
  }

  // Default to formData (curl-friendly)
  const form = await req.formData().catch(() => null);
  if (!form) return "";
  return String(form.get("url") || form.get("youtubeUrl") || "").trim();
}

export async function POST(req: Request) {
  // If the test key bypass is not used, this endpoint requires Clerk auth via middleware.
  // (The middleware will protect /api/* by default.)
  const _bypass = getHeaderTestBypass(req);

  const url = await readUrlFromRequest(req);
  if (!url) {
    return NextResponse.json({ error: "Missing url", code: "URL_REQUIRED" }, { status: 400 });
  }

  const result = await transcribeYoutubeUrlWithRunpod(url, {
    timeoutMs: Number(process.env.RUNPOD_YOUTUBE_TIMEOUT_MS || 180_000),
  });

  if (!result.ok) {
    const status = result.reason === "NOT_CONFIGURED" ? 500 : result.reason === "TIMEOUT" ? 504 : 502;
    return NextResponse.json(
      {
        error: result.message,
        code: `RUNPOD_YOUTUBE_${result.reason}`,
        detail: result,
      },
      { status }
    );
  }

  return NextResponse.json({ ok: true, transcript: result.transcript, id: result.id ?? null }, { status: 200 });
}
