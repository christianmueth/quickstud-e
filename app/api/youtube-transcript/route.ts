import { NextResponse } from "next/server";
import { fetchSupadataTranscript, isYouTubeUrl } from "@/lib/supadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const youtubeUrl = typeof body?.youtubeUrl === "string" ? body.youtubeUrl.trim() : "";
    const language = typeof body?.language === "string" ? body.language.trim() : undefined;

    if (!youtubeUrl) {
      return NextResponse.json({ error: "youtubeUrl required" }, { status: 400 });
    }

    if (!isYouTubeUrl(youtubeUrl)) {
      return NextResponse.json({ error: "Only YouTube URLs are supported" }, { status: 400 });
    }

    const r = await fetchSupadataTranscript({ youtubeUrl, language });
    if (!r.ok) {
      const status = r.reason === "NOT_CONFIGURED" ? 500 : 502;
      return NextResponse.json(
        { error: "Supadata failed", code: `SUPADATA_${r.reason}`, status: r.httpStatus ?? null, detail: r.raw ?? null },
        { status }
      );
    }

    return NextResponse.json({
      transcript: r.transcript,
      lang: r.lang,
      availableLangs: r.availableLangs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
