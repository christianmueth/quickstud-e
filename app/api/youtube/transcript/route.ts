import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { downloadYouTubeSubtitles, parseVTT } from "@/lib/fallback/yt-dlp";
import { extractYouTubeId, fetchYouTubeOEmbed } from "@/lib/youtube";
import type { Cue } from "@/lib/captions";
import { readFileSync } from "fs";

const BodySchema = z.object({
  url: z.string().url(),
  // optional language code preference like 'en', 'es'
  lang: z.string().min(2).max(10).optional()
});

// Very small in-memory cache to avoid re-fetching during hot usage
// (swap this for Redis in prod)
const cache = new Map<string, any>();
const TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, lang } = BodySchema.parse(body);
    const id = extractYouTubeId(url);
    if (!id) {
      return NextResponse.json({ error: "invalid_youtube_url" }, { status: 400 });
    }

    const cacheKey = `${id}:${lang ?? "en"}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return NextResponse.json(hit.payload);
    }

    // Download subtitles using yt-dlp (most reliable method)
    console.log(`[youtube/transcript] Downloading subtitles for ${id} (lang: ${lang ?? "en"})`);
    const subtitlePath = await downloadYouTubeSubtitles(id, {
      lang: lang ?? "en",
      format: "vtt"
    });

    const vttContent = readFileSync(subtitlePath, "utf-8");
    const captions: Cue[] = parseVTT(vttContent);

    if (!captions || captions.length === 0) {
      const payload = { provider: "youtube", videoId: id, error: "no_captions_available" };
      cache.set(cacheKey, { ts: Date.now(), payload });
      return NextResponse.json(payload, { status: 404 });
    }

    console.log(`[youtube/transcript] Successfully parsed ${captions.length} caption segments`);

    const meta = await fetchYouTubeOEmbed(url);
    const payload = {
      provider: "youtube" as const,
      videoId: id,
      language: lang ?? "en",
      captions,
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