import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { downloadYouTubeSubtitles, parseVTT } from "@/lib/fallback/yt-dlp";
import { extractYouTubeId, fetchYouTubeOEmbed } from "@/lib/youtube";
import type { Cue } from "@/lib/captions";
import { readFileSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  url: z.string().url(),
  // optional language code preference like 'en', 'es'
  lang: z.string().min(2).max(10).optional()
});

// Very small in-memory cache to avoid re-fetching during hot usage
// (swap this for Redis in prod)
const cache = new Map<string, any>();
const TTL_MS = 10 * 60 * 1000;

async function readBody(req: NextRequest): Promise<{ url: string; lang?: string }> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const bodyText = await req.text().catch(() => "");
    let parsed: any = {};
    try {
      const trimmed = (bodyText || "").trim().replace(/^\uFEFF/, "");
      parsed = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      // try object substring
      const t = (bodyText || "").trim().replace(/^\uFEFF/, "");
      const start = t.indexOf("{");
      const end = t.lastIndexOf("}");
      if (start >= 0 && end > start) {
        parsed = JSON.parse(t.slice(start, end + 1));
      }
    }
    return BodySchema.parse(parsed);
  }

  // Allow multipart/form-data for easy curl testing
  const form = await req.formData();
  const url = String(form.get("url") || "").trim();
  const lang = String(form.get("lang") || "").trim();
  return BodySchema.parse({ url, ...(lang ? { lang } : {}) });
}

async function fetchCaptionsViaYtdlCore(id: string): Promise<string | null> {
  try {
    const ytdl = (await import("ytdl-core")) as any;
    const info = await (ytdl.default ? ytdl.default.getInfo(id) : ytdl.getInfo(id));
    const pr =
      info.player_response ||
      (typeof info.player_response === "string" ? JSON.parse(info.player_response) : info.player_response) ||
      info.playerResponse;

    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || !tracks.length) return null;

    const track = tracks.find((t: any) => t.languageCode === "en") || tracks[0];
    const baseUrl: string = track.baseUrl;

    // Try JSON3 first
    try {
      const r = await fetch(baseUrl + "&fmt=json3");
      if (r.ok) {
        const j: any = await r.json();
        const text = (j.events || [])
          .map((ev: any) => (ev.segs || []).map((s: any) => s.utf8 || "").join(""))
          .join(" ");
        return String(text || "").replace(/\s+/g, " ").trim() || null;
      }
    } catch {
      // ignore
    }

    // Fallback to XML timedtext
    try {
      const r2 = await fetch(baseUrl);
      if (r2.ok) {
        const xml = await r2.text();
        const matches = Array.from(xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g));
        const text = matches
          .map((m: any) =>
            String(m[1] || "")
              .replace(/&amp;/g, "&")
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&gt;/g, ">")
              .replace(/&lt;/g, "<")
          )
          .join(" ");
        return String(text || "").replace(/\s+/g, " ").trim() || null;
      }
    } catch {
      // ignore
    }

    return null;
  } catch (e) {
    console.warn("[youtube/transcript] ytdl-core fallback failed:", (e as any)?.message || e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, lang } = await readBody(req);
    const id = extractYouTubeId(url);
    if (!id) {
      return NextResponse.json({ error: "invalid_youtube_url" }, { status: 400 });
    }

    const cacheKey = `${id}:${lang ?? "en"}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return NextResponse.json(hit.payload);
    }

    let captions: Cue[] | null = null;
    let provider: "youtube" | "ytdl-core" = "youtube";
    let rawTranscript: string | null = null;

    // 1) Download subtitles using yt-dlp (most reliable when available)
    try {
      console.log(`[youtube/transcript] Downloading subtitles for ${id} (lang: ${lang ?? "en"})`);
      const subtitlePath = await downloadYouTubeSubtitles(id, {
        lang: lang ?? "en",
        format: "vtt",
      });

      const vttContent = readFileSync(subtitlePath, "utf-8");
      captions = parseVTT(vttContent);
      if (captions && captions.length > 0) {
        console.log(`[youtube/transcript] Successfully parsed ${captions.length} caption segments (yt-dlp)`);
      } else {
        captions = null;
      }
    } catch (e) {
      console.warn("[youtube/transcript] yt-dlp failed, trying ytdl-core fallback:", (e as any)?.message || e);
    }

    // 2) Fallback: fetch captions directly via ytdl-core (no external binary)
    if (!captions) {
      provider = "ytdl-core";
      rawTranscript = await fetchCaptionsViaYtdlCore(id);
      if (!rawTranscript) {
        const payload = { provider: "youtube", videoId: id, error: "no_captions_available" };
        cache.set(cacheKey, { ts: Date.now(), payload });
        return NextResponse.json(payload, { status: 404 });
      }
    }

    const meta = await fetchYouTubeOEmbed(url);
    const payload = {
      provider,
      videoId: id,
      language: lang ?? "en",
      captions: captions ?? undefined,
      transcript: rawTranscript ?? undefined,
      metadata: {
        title: "title" in meta ? meta.title : undefined,
        author: "author_name" in meta ? meta.author_name : undefined,
        thumbnail: "thumbnail_url" in meta ? meta.thumbnail_url : undefined
      }
    };

    cache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e: any) {
    // Common cases: region/age-gated video; deleted video; network hiccup; yt-dlp not installed
    console.error("[youtube/transcript] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "failed_to_fetch_transcript" },
      { status: 500 }
    );
  }
}