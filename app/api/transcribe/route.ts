import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { transcribeAudioUrlWithRunpod } from "@/lib/asrClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";

    let url = "";
    let uploaded = false;

    // Mode B: JSON { audioUrl }
    if (ct.includes("application/json")) {
      // NOTE: Some clients/environments can cause req.json() to throw even when Content-Type is set.
      // Read raw text and JSON.parse for maximum compatibility.
      const bodyText = await req.text().catch(() => "");
      let body: any = {};
      try {
        body = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        return NextResponse.json(
          {
            error: "Invalid JSON body",
            hint: "Send {\"audioUrl\":\"https://...\"} with Content-Type: application/json",
          },
          { status: 400 }
        );
      }
      url = String(body?.audioUrl || "").trim();
      if (!url) {
        return NextResponse.json({ error: "Missing audioUrl" }, { status: 400 });
      }
    } else {
      // Mode A: multipart/form-data (file) and/or audioUrl
      const form = await req.formData();
      const file = form.get("file") as File | null;
      const audioUrl = String(form.get("audioUrl") || "").trim();

      url = audioUrl;
      if (!url) {
        if (!file) {
          return NextResponse.json({ error: "Missing file (form field name: file) or audioUrl" }, { status: 400 });
        }

        const safeName = (file.name || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g, "_");
        const pathname = `uploads/audio/${Date.now()}-${safeName}`;

        const blob = await put(pathname, file, {
          access: "public",
          contentType: file.type || "application/octet-stream",
          addRandomSuffix: true,
        });

        url = blob.url;
        uploaded = true;
      }
    }

    const timeoutMs = Number(process.env.RUNPOD_ASR_TIMEOUT_MS || 90_000);
    const result = await transcribeAudioUrlWithRunpod(url, { timeoutMs });
    if (!result.ok) {
      const status =
        result.code === "TIMEOUT" ? 504 : result.code === "NOT_CONFIGURED" ? 500 : result.code === "EXCEPTION" ? 500 : 502;
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          status: result.status ?? null,
          id: result.id ?? null,
          raw: result.raw ?? null,
        },
        { status }
      );
    }

    const includeRaw = process.env.ASR_DEBUG === "1";
    return NextResponse.json({
      transcript: result.transcript,
      segments: (result as any).segments ?? null,
      detectedLanguage: (result as any).detectedLanguage ?? null,
      audioUrl: url,
      uploaded,
      ...(includeRaw ? { raw: (result as any).raw ?? null } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
