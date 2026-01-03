import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { transcribeAudioUrlWithRunpod } from "@/lib/asrClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file") as File | null;
    const audioUrl = String(form.get("audioUrl") || "").trim();

    let url = audioUrl;

    if (!url) {
      if (!file) {
        return NextResponse.json(
          { error: "Missing file (form field name: file) or audioUrl" },
          { status: 400 }
        );
      }

      const buf = Buffer.from(await file.arrayBuffer());
      const safeName = (file.name || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g, "_");
      const pathname = `uploads/audio/${Date.now()}-${safeName}`;

      const blob = await put(pathname, new Blob([buf as any]), {
        access: "public",
        contentType: file.type || "application/octet-stream",
        addRandomSuffix: true,
      });

      url = blob.url;
    }

    const result = await transcribeAudioUrlWithRunpod(url);
    if (!result.ok) {
      const status = result.code === "NOT_CONFIGURED" ? 500 : 502;
      return NextResponse.json({ error: result.message, code: result.code, raw: result.raw ?? null }, { status });
    }

    return NextResponse.json({ transcript: result.transcript, audioUrl: url, raw: result.raw ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
