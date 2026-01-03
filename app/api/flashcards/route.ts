/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { callLLMResult } from "@/lib/aiClient";
import { put } from "@vercel/blob";
import { transcribeAudioUrlWithRunpod } from "@/lib/asrClient";

export const runtime = "nodejs";         // node runtime to allow larger bodies locally
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "gpt-4o-mini";
const MAX_SOURCE_CHARS = 20_000;
const MAX_LLM_SOURCE_CHARS = Number(process.env.MAX_LLM_SOURCE_CHARS || 8000);
const DEFAULT_CARD_COUNT = 20;
const STRICT_VIDEO = process.env.STRICT_VIDEO === "1";
// Cost guardrails
const DISABLE_AUDIO_UPLOAD = process.env.DISABLE_AUDIO_UPLOAD === "1";
const OPENAI_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200);
const MAX_DECKS_PER_DAY = Number(process.env.MAX_DECKS_PER_DAY || 50);

const MAX_Q_CHARS = Number(process.env.FLASHCARDS_MAX_Q_CHARS || 140);
const MAX_A_CHARS = Number(process.env.FLASHCARDS_MAX_A_CHARS || 220);

function cleanText(s: string) { return s.replace(/\s+/g, " ").trim(); }
function truncate(s: string, max = MAX_SOURCE_CHARS) { return s.length > max ? s.slice(0, max) : s; }

function shrinkSourceForLLM(text: string, maxChars: number): string {
  const t = String(text || "").trim();
  if (!t || t.length <= maxChars) return t;

  // PPTX extraction uses markers like: [Slide 12] ...
  // For large decks, sending the full 20k chars every batch is slow.
  // Keep a representative slice per slide until we hit the budget.
  if (/\[Slide\s+\d+\]/i.test(t)) {
    const chunks = t.match(/\[Slide\s+\d+\][\s\S]*?(?=\[Slide\s+\d+\]|$)/gi) || [];
    let out = "";
    for (const chunk of chunks) {
      const c = chunk.replace(/\s+/g, " ").trim();
      if (!c) continue;
      const clipped = c.length > 320 ? `${c.slice(0, 320)}…` : c;
      const next = out ? `${out}\n${clipped}` : clipped;
      if (next.length > maxChars) break;
      out = next;
    }
    if (out) return out;
  }

  return t.slice(0, maxChars);
}
function isYouTubeHostname(host: string) { return ["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(host); }
function getYouTubeId(u: URL) {
  if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
  if (u.searchParams.get("v")) return u.searchParams.get("v")!;
  const m = u.pathname.match(/\/shorts\/([^/]+)/);
  return m?.[1] || null;
}
function guessKindFromNameType(name?: string, type?: string): "pdf" | "pptx" | "unknown" {
  const nm = (name || "").toLowerCase();
  const tp = (type || "").toLowerCase();
  if (nm.endsWith(".pdf") || tp === "application/pdf") return "pdf";
  if (nm.endsWith(".pptx") || tp === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  return "unknown";
}
const stripFence = (s: string) => s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

function extractFirstJsonArray(s: string): string | null {
  const start = s.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }

  return null;
}

async function fetchYouTubeTranscriptViaYtdlCore(id: string): Promise<string | null> {
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

    // Try JSON3
    try {
      const r = await fetch(baseUrl + "&fmt=json3");
      if (r.ok) {
        const j: any = await r.json();
        const text = (j.events || [])
          .map((ev: any) => (ev.segs || []).map((s: any) => s.utf8 || "").join(""))
          .join(" ");
        const cleaned = String(text || "").replace(/\s+/g, " ").trim();
        if (cleaned) return cleaned;
      }
    } catch {
      // ignore
    }

    // Fallback XML timedtext
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
        const cleaned = String(text || "").replace(/\s+/g, " ").trim();
        if (cleaned) return cleaned;
      }
    } catch {
      // ignore
    }

    return null;
  } catch (e) {
    console.warn("[YouTube] ytdl-core fallback failed:", (e as any)?.message || e);
    return null;
  }
}

async function downloadYouTubeAudioBufferViaYtdlCore(
  id: string,
  maxBytes: number
): Promise<{ buf: Buffer; filename: string; contentType: string }> {
  const ytdl = (await import("ytdl-core")) as any;
  const ytdlDefault = ytdl.default ?? ytdl;

  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const requestOptions = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  };

  const info = await (ytdlDefault.getInfo
    ? ytdlDefault.getInfo(watchUrl, { requestOptions })
    : ytdl.getInfo(watchUrl, { requestOptions }));
  const format = ytdlDefault.chooseFormat
    ? ytdlDefault.chooseFormat(info.formats, { quality: "highestaudio", filter: "audioonly" })
    : (ytdl.chooseFormat(info.formats, { quality: "highestaudio", filter: "audioonly" }) as any);

  const mimeTypeRaw: string | undefined = format?.mimeType;
  const contentType = (mimeTypeRaw ? String(mimeTypeRaw).split(";")[0] : "audio/webm") || "audio/webm";
  const ext = contentType.includes("mp4") || contentType.includes("m4a") ? "m4a" : "webm";
  const filename = `youtube-${id}.${ext}`;

  const stream = ytdlDefault(watchUrl, {
    quality: format.itag,
    requestOptions,
    highWaterMark: 1 << 25,
  });

  const chunks: Buffer[] = [];
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy(new Error(`YouTube audio too large (> ${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve());
    stream.on("error", (e: any) => reject(e));
  });

  return { buf: Buffer.concat(chunks), filename, contentType };
}

async function extractFromYouTubeStrict(u: URL): Promise<{ title: string; text: string }> {
  const id = getYouTubeId(u);
  if (!id) throw new Error("Could not parse YouTube video ID.");

  // 1) Try yt-dlp subtitle download (most reliable method)
  try {
    console.log("[YouTube] Attempting yt-dlp subtitle download for:", id);
    const { downloadYouTubeSubtitles, parseVTT } = await import("@/lib/fallback/yt-dlp");
    const { readFileSync } = await import("fs");
    
    const subtitlePath = await downloadYouTubeSubtitles(id, {
      lang: "en",
      format: "vtt"
    });
    
    const vttContent = readFileSync(subtitlePath, "utf-8");
    const cues = parseVTT(vttContent);
    
    if (cues && cues.length > 0) {
      const text = cues.map(c => c.text).join(" ");
      const cleaned = cleanText(text || "");
      if (cleaned) {
        console.log(`[YouTube] yt-dlp succeeded: ${cues.length} caption segments, ${cleaned.length} chars`);
        return { title: `YouTube ${id}`, text: cleaned };
      }
    }
  } catch (err) {
    console.warn("[YouTube] yt-dlp subtitle download failed:", (err as any)?.message || err);
  }

  // 2) Fallback: Try youtube-transcript library (may not work reliably)
  try {
    const { YoutubeTranscript } = (await import("youtube-transcript")) as any;
    const items =
      (await YoutubeTranscript.fetchTranscript(id).catch(() => null)) ??
      (await YoutubeTranscript.fetchTranscript(id, { lang: "en" }).catch(() => null));
    const text = Array.isArray(items) ? items.map((i: any) => i.text).join(" ") : "";
    const cleaned = cleanText(text || "");
    if (cleaned) {
      console.log("[YouTube] youtube-transcript library succeeded");
      return { title: `YouTube ${id}`, text: cleaned };
    }
  } catch (err) {
    console.warn("[YouTube] youtube-transcript library failed:", (err as any)?.message || err);
  }

  // 1a) Try scraping the watch page HTML for ytInitialPlayerResponse -> captions
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${id}`;
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
    const htmlRes = await fetch(watchUrl, { headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9" } }).catch(() => null);
    if (htmlRes && htmlRes.ok) {
      const html = await htmlRes.text();
      // Look for ytInitialPlayerResponse JSON in HTML
      const patterns = [
        /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*var/,
        /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*function/,
        /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*if/,
        /window\["ytInitialPlayerResponse"\]\s*=\s*(\{[\s\S]*?\})\s*;/,
        /var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;/,
      ];
      let prObj: any = null;
      for (const p of patterns) {
        const m = html.match(p as RegExp);
        if (m && m[1]) {
          try { prObj = JSON.parse(m[1]); break; } catch { /* try next */ }
        }
      }
      // fallback: search for "player_response":"{...}" style (escaped)
      if (!prObj) {
        const esc = html.match(/"player_response"\s*:\s*"(\{[\s\S]*?\})"/);
        if (esc && esc[1]) {
          try { prObj = JSON.parse(esc[1].replace(/\\n/g, "").replace(/\\"/g, '"')); } catch {}
        }
      }
      if (prObj) {
        const tracks = prObj?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length) {
          const track = tracks.find((t: any) => t.languageCode === "en") || tracks[0];
          const baseUrl: string = track.baseUrl;
          try {
            const r = await fetch(baseUrl + "&fmt=json3");
            if (r.ok) {
              const j = await r.json();
              const text = (j.events || []).map((ev: any) => (ev.segs || []).map((s: any) => s.utf8 || "").join("")).join(" ");
              const cleaned = cleanText(text || "");
              if (cleaned) return { title: `YouTube ${id}`, text: cleaned };
            }
          } catch (e) { /* ignore and continue to other strategies */ }
          try {
            const r2 = await fetch(baseUrl);
            if (r2.ok) {
              const xml = await r2.text();
              const matches = Array.from(xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g));
              const text = matches.map((m: any) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')).join(' ');
              const cleaned = cleanText(text || "");
              if (cleaned) return { title: `YouTube ${id}`, text: cleaned };
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('[YouTube] HTML scrape for captions failed:', (e as any)?.message || e);
  }

  // 1b) Try to extract captions from player_response via ytdl-core (more robust for some videos)
  try {
    const ytdl = (await import("ytdl-core")) as any;
    const target = u.toString();
    try {
      const info = await (ytdl.default ? ytdl.default.getInfo(target) : ytdl.getInfo(target));
      const pr = info.player_response || (typeof info.player_response === "string" ? JSON.parse(info.player_response) : info.player_response) || info.playerResponse;
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length) {
        // prefer English if available
        const track = tracks.find((t: any) => t.languageCode === "en") || tracks[0];
        const baseUrl: string = track.baseUrl;
        // try JSON3 first
        try {
          const r = await fetch(baseUrl + "&fmt=json3");
          if (r.ok) {
            const j = await r.json();
            const text = (j.events || []).map((ev: any) => (ev.segs || []).map((s: any) => s.utf8 || "").join("")).join(" ");
            const cleaned = cleanText(text || "");
            if (cleaned) return { title: `YouTube ${id}`, text: cleaned };
          }
        } catch {}
        // fallback to XML timedtext
        try {
          const r2 = await fetch(baseUrl);
          if (r2.ok) {
            const xml = await r2.text();
            const matches = Array.from(xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g));
            const text = matches.map((m: any) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<')).join(' ');
            const cleaned = cleanText(text || "");
            if (cleaned) return { title: `YouTube ${id}`, text: cleaned };
          }
        } catch (e) { /* ignore */ }
      }
    } catch (ie) {
      console.warn("[YouTube] ytdl-core getInfo failed:", (ie as any)?.message || ie);
    }
  } catch (e) {
    console.warn("[YouTube] ytdl-core captions fetch failed:", (e as any)?.message || e);
  }

  // 2) If captions unavailable, attempt to download audio and transcribe.
  try {
    const ytdl = (await import("ytdl-core")) as any;
    const stream = ytdl(id, { filter: "audioonly", quality: "lowestaudio" });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    console.log("[YouTube] Downloaded audio size:", buf.length);
    const text = await transcribeBuffer(buf, "youtube.mp3", "audio/mpeg");
    const cleaned = cleanText(text || "");
    if (!cleaned) throw new Error("Transcription returned empty text.");
    return { title: `YouTube ${id}`, text: cleaned };
  } catch (e: any) {
    console.error("[YouTube] Audio transcription fallback failed:", e?.message || e);
    throw new Error("This YouTube video has no accessible captions and audio transcription failed.");
  }
}

async function extractFromWebsite(u: URL): Promise<{ title: string; text: string } | null> {
  try {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
    const res = await fetch(u.toString(), { headers: { "User-Agent": ua } });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = cleanText(titleMatch?.[1] || u.hostname);
    const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    const text = cleanText(noScript.replace(/<[^>]+>/g, " "));
    return text ? { title, text } : null;
  } catch { return null; }
}

// Parse subtitle buffers (SRT or VTT) into plain text
function parseSubtitleBuffer(buf: Buffer): string {
  const s = buf.toString("utf8");
  // Remove WEBVTT header
  let t = s.replace(/^WEBVTT[\s\S]*?\n\n/, "");
  // Remove SRT numeric indexes and timestamps
  t = t.replace(/^[0-9]+\s*\n/gm, "");
  t = t.replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{3}/g, "");
  // Remove VTT timestamps
  t = t.replace(/\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}/g, "");
  // Remove remaining tag-like constructs
  t = t.replace(/<[^>]+>/g, "");
  // Collapse whitespace
  return cleanText(t);
}

async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  try {
    // Direct import of pdf-parse/lib/pdf-parse.js to avoid the test file issue
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    
    console.log("[PDF] Starting extraction, buffer size:", buf.length);
    const data = await pdfParse(buf, {
      max: 0 // No page limit
    });
    
    if (!data?.text) {
      console.error("[PDF] No text content found in PDF");
      return "";
    }
    
    const text = cleanText(data.text);
    console.log("[PDF] Extraction complete");
    console.log("[PDF] Extracted text length:", text.length);
    console.log("[PDF] Sample of extracted text:", text.slice(0, 200));
    
    // Additional validation
    if (text.length < 50) {
      console.warn("[PDF] Extracted text is suspiciously short:", text);
      return "";
    }
    
    return text;
  } catch (error) {
    console.error("[PDF] Error extracting text:", error);
    if (error instanceof Error) {
      console.error("[PDF] Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return ""; 
  }
}
async function extractPptxTextFromBuffer(buf: Buffer): Promise<string> {
  try {
    console.log("[PPTX] Starting extraction, buffer size:", buf.length);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    
    const slideFiles = Object.keys(zip.files)
      .filter((p) => p.startsWith("ppt/slides/slide") && p.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });
    
    console.log("[PPTX] Found slides:", slideFiles.length);
    if (slideFiles.length === 0) {
      console.error("[PPTX] No slides found in file");
      return "";
    }
    
    const chunks: string[] = [];
    for (const p of slideFiles) {
      const xml = await zip.files[p].async("string");
      // Extract text specifically from PowerPoint text tags
      const slideText = (xml.match(/<a:t>([^<]*)<\/a:t>/g) || [])
        .map(match => match.replace(/<a:t>|<\/a:t>/g, ""))
        .filter(text => text.trim().length > 0)
        .join(" ");
      if (slideText.trim()) {
        chunks.push(`[Slide ${chunks.length + 1}] ${cleanText(slideText)}`);
      }
    }
    
    const text = cleanText(chunks.join(" "));
    console.log("[PPTX] Extracted text length:", text.length);
    console.log("[PPTX] Sample of extracted text:", text.slice(0, 200));
    
    if (text.length < 50) {
      console.warn("[PPTX] Extracted text is suspiciously short:", text);
      return "";
    }
    
    return text;
  } catch (error) {
    console.error("[PPTX] Error extracting text:", error);
    if (error instanceof Error) {
      console.error("[PPTX] Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return ""; }
}

// ---- transcribe an audio File (from client MP3) ----
async function transcribeAudioFile(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  return transcribeBuffer(buf, file.name || "audio.mp3", file.type || "application/octet-stream");
}

// Transcribe a server-side audio buffer using OpenAI Whisper endpoint
async function transcribeBufferWithOpenAI(buf: Buffer): Promise<string> {
  return transcribeBuffer(buf, "audio.mp3", "audio/mpeg");
}

async function transcribeBuffer(buf: Buffer, filename: string, contentType: string): Promise<string> {
  // Prefer RunPod ASR (Whisper replacement) if configured.
  const hasRunpodAsr = !!(process.env.RUNPOD_ASR_ENDPOINT || process.env.RUNPOD_ASR_ENDPOINT_ID);
  if (hasRunpodAsr) {
    const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
    if (!hasBlobToken) {
      throw new Error(
        "Vercel Blob is not configured for server-side uploads. Set BLOB_READ_WRITE_TOKEN in production so the server can upload audio for ASR."
      );
    }
    const safeName = (filename || "audio.mp3").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const pathname = `uploads/audio/${Date.now()}-${safeName}`;
    let blob: { url: string };
    try {
      blob = await put(pathname, new Blob([buf as any]), {
        access: "public",
        contentType: contentType || "application/octet-stream",
        addRandomSuffix: true,
      });
    } catch (e: any) {
      const msg = String(e?.message || e || "BLOB_UPLOAD_FAILED");
      throw new Error(`Vercel Blob upload failed: ${msg}`);
    }

    const asr = await transcribeAudioUrlWithRunpod(blob.url);
    if (!asr.ok) {
      throw new Error(`RunPod ASR failed: ${asr.message} [${asr.code}]`);
    }
    const t = cleanText(asr.transcript || "");
    if (!t) throw new Error("No speech recognized.");
    return t;
  }

  // Fallback to OpenAI Whisper ONLY if explicitly allowed.
  const allowOpenAIFallback = String(process.env.ASR_FALLBACK || "").toLowerCase() === "openai";
  if (!allowOpenAIFallback) {
    throw new Error(
      "RunPod ASR is not configured. Set RUNPOD_ASR_ENDPOINT(_ID) and RUNPOD_ASR_API_KEY, or set ASR_FALLBACK=openai to allow Whisper fallback."
    );
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY (ASR_FALLBACK=openai requested)");
  const form = new FormData();
  form.append("model", "whisper-1");
  const blob = new Blob([buf as any]);
  form.append("file", blob as any, filename || "audio.mp3");
  const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!tr.ok) {
    const errTxt = await tr.text().catch(() => "");
    throw new Error(`Transcription failed: ${tr.status} ${errTxt}`);
  }
  const out = (await tr.json()) as { text?: string };
  const text = cleanText(out.text || "");
  if (!text) throw new Error("No speech recognized.");
  return text;
}

// -------------------- cards --------------------
function buildFlashcardPrompt(text: string, count: number) {
  const n = Math.min(Math.max(count, 5), 50);
  return `Generate EXACTLY ${n} flashcards from the material.

ABSOLUTE OUTPUT FORMAT (must be valid JSON):
- Output MUST be a JSON array and NOTHING else.
- The first non-whitespace character MUST be '[' and the last MUST be ']'.
- No preface, no explanation, no markdown, no code fences.

JSON schema:
[
  {"q":"...","a":"..."}
]

Rules:
- One concept per card
- Questions are specific and testable
- Answers are concise (1–2 sentences, max ${MAX_A_CHARS} characters)

Material:
${text}`;
}

function buildFlashcardPromptQA(text: string, count: number) {
  const n = Math.min(Math.max(count, 5), 50);
  return `Generate EXACTLY ${n} flashcards from the material.

ABSOLUTE OUTPUT FORMAT (NO JSON):
- Output ONLY flashcards in this repeated block format.
- No preface, no explanation, no markdown, no code fences, no numbering.
- The FIRST characters of your response MUST be 'Q:' (no leading whitespace).

Format (repeat EXACTLY ${n} times):
Q: <question>
A: <answer>
---

After the final '---', output the single token:</final>

Example (format only):
Q: What is the main topic?
A: It is about the key ideas in the provided material.
---
Q: What is one important detail?
A: It describes a specific concept mentioned in the material.
---
</final>

Now generate the REAL ${n} flashcards (no placeholders).

Rules:
- One concept per card
- Questions are specific and testable
- Answers are concise (1–2 sentences, max ${MAX_A_CHARS} characters)

Material:
${text}`;
}
async function generateCardsWithOpenAI(source: string, count = DEFAULT_CARD_COUNT) {
  if (!process.env.RUNPOD_API_KEY) {
    console.warn("[Cards] RunPod API key not configured, using fallback");
    return null;
  }
  
  const llmSource = shrinkSourceForLLM(source, MAX_LLM_SOURCE_CHARS);
  console.log("[Cards] Generating cards from source text length:", source.length);
  console.log("[Cards] LLM input text length:", llmSource.length);
  console.log("[Cards] First 200 chars of LLM input:", llmSource.slice(0, 200));
  console.log("[Cards] Requesting", count, "cards with max_tokens:", OPENAI_MAX_OUTPUT_TOKENS);
  
  const messages = [
    {
      role: "system" as const,
      content:
        `You generate flashcards. You MUST output ONLY valid JSON. Do not include any analysis, reasoning, markdown, or extra text. Each item must have non-empty q and a. q must end with '?'. q must be <= ${MAX_Q_CHARS} characters. a must directly answer q in 1–2 concise sentences and must be <= ${MAX_A_CHARS} characters. If you cannot comply, output [].`,
    },
    { role: "user" as const, content: buildFlashcardPrompt(llmSource, count) },
  ];

  const useGuidedJson = process.env.RUNPOD_GUIDED_JSON === "1";
  console.log(`[Cards] RUNPOD_GUIDED_JSON=${useGuidedJson ? "1" : "0"}`);
  const makeGuidedJson = (n: number) =>
    useGuidedJson
      ? {
          type: "array",
          minItems: n,
          maxItems: n,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["q", "a"],
            properties: {
              q: { type: "string", minLength: 8, maxLength: Math.max(40, MAX_Q_CHARS) },
              a: { type: "string", minLength: 12, maxLength: Math.max(80, MAX_A_CHARS) },
            },
          },
        }
      : undefined;

  const modelName = process.env.RUNPOD_MODEL || "deepseek-r1";
  const preferQaForModel = /deepseek.*r1/i.test(modelName) || /\br1\b/i.test(modelName);
  const n = Math.min(Math.max(count, 5), 50);

  function ensureQuestionMark(q: string) {
    const qq = cleanText(q || "");
    if (!qq) return "";
    return qq.endsWith("?") ? qq : `${qq}?`;
  }

  async function parseCardsFromJsonLike(text: string) {
    let jsonText = text;
    try {
      JSON.parse(jsonText);
    } catch {
      const extracted = extractFirstJsonArray(jsonText);
      if (extracted) jsonText = extracted;
    }

    const arr = JSON.parse(jsonText) as Array<{
      q?: string;
      a?: string;
      question?: string;
      answer?: string;
    }>;

    const mapped = arr
      .map((c) => ({
        question: typeof c?.q === "string" ? c.q : typeof c?.question === "string" ? c.question : "",
        answer: typeof c?.a === "string" ? c.a : typeof c?.answer === "string" ? c.answer : "",
      }))
      .map((c) => ({ question: ensureQuestionMark(c.question), answer: cleanText(c.answer) }))
      .filter((c) => c.question.length >= 8 && c.answer.length >= 12)
      .map((c) => ({ question: c.question.slice(0, MAX_Q_CHARS), answer: c.answer.slice(0, MAX_A_CHARS) }));

    return mapped.length ? mapped : null;
  }

  function parseCardsFromQA(text: string) {
    const normalized = String(text || "").replace(/\r\n/g, "\n");
    const out: Array<{ question: string; answer: string }> = [];

    const lines = normalized
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== "</final>");

    const isSep = (l: string) => l === "---" || l === "***";
    const isQ = (l: string) => /^(?:\d+\s*[).\-]\s*)?(?:Q|Question)\s*[:\-]/i.test(l);
    const isA = (l: string) => /^(?:\d+\s*[).\-]\s*)?(?:A|Answer)\s*[:\-]/i.test(l);
    const stripLabel = (l: string) => l.replace(/^(?:\d+\s*[).\-]\s*)?(?:Q|Question|A|Answer)\s*[:\-]\s*/i, "");

    let currentQ = "";
    let currentA = "";
    let mode: "none" | "q" | "a" = "none";

    const flush = () => {
      const q = cleanText(currentQ);
      const a = cleanText(currentA);
      if (q && a) out.push({ question: q.slice(0, MAX_Q_CHARS), answer: a.slice(0, MAX_A_CHARS) });
      currentQ = "";
      currentA = "";
      mode = "none";
    };

    for (const line of lines) {
      if (out.length >= n) break;
      if (isSep(line)) {
        flush();
        continue;
      }

      // Handle same-line Q and A: "Q: ... A: ..."
      if (isQ(line) && /\b(?:A|Answer)\s*[:\-]/i.test(line)) {
        const parts = line.split(/\b(?:A|Answer)\s*[:\-]\s*/i);
        const qPart = stripLabel(parts[0] || "");
        const aPart = parts.slice(1).join(" ");
        currentQ = qPart;
        currentA = aPart;
        flush();
        continue;
      }

      if (isQ(line)) {
        if (currentQ || currentA) flush();
        mode = "q";
        currentQ += (currentQ ? " " : "") + stripLabel(line);
        continue;
      }

      if (isA(line)) {
        mode = "a";
        currentA += (currentA ? " " : "") + stripLabel(line);
        continue;
      }

      if (mode === "q") currentQ += (currentQ ? " " : "") + line;
      else if (mode === "a") currentA += (currentA ? " " : "") + line;
    }

    if (out.length < n) flush();
    return out.length ? out : null;
  }

  async function runQaPass(remaining: number, already: Array<{ question: string; answer: string }>) {
    const prefix = already.length
      ? `\n\nAlready generated (do NOT repeat):\n${already
          .slice(0, 10)
          .map((c, i) => `- ${i + 1}. ${c.question}`)
          .join("\n")}`
      : "";

    const qaMessages = [
      {
        role: "system" as const,
        content:
          "You are a flashcard generator. Output ONLY flashcards in the requested Q/A format. No analysis, no reasoning, no extra text. If you output anything other than Q/A blocks, it will be rejected.",
      },
      { role: "user" as const, content: `${buildFlashcardPromptQA(source, remaining)}${prefix}` },
      // Assistant prefill to bias the model to start with the required token.
      { role: "assistant" as const, content: "Q:" },
    ];

    const qaResult = await callLLMResult(qaMessages, OPENAI_MAX_OUTPUT_TOKENS, 0, {
      topP: 1,
      stop: ["</final>"],
    });

    return qaResult;
  }

  // Fast path: for DeepSeek-R1, prefer Q/A blocks first (fast + easy to parse).
  // If parsing fails, fall back to guided JSON / strict JSON.
  if (preferQaForModel) {
    console.log(`[Cards] Using Q/A primary mode for model=${modelName}`);

    const qa1 = await runQaPass(n, []);
    if (!qa1.ok) {
      if (qa1.reason === "TIMEOUT" && String(qa1.lastStatus || "").toUpperCase() === "IN_QUEUE") {
        const err: any = new Error("RunPod job is still in queue (no capacity). Try again in a minute.");
        err.code = "RUNPOD_IN_QUEUE";
        err.jobId = qa1.jobId;
        err.lastStatus = qa1.lastStatus;
        throw err;
      }
      console.warn("[Cards] Q/A primary call failed; falling back to JSON attempts");
    } else {
      const parsed1 = qa1.content ? parseCardsFromQA(qa1.content) : null;
      const cards: Array<{ question: string; answer: string }> = parsed1 ? [...parsed1] : [];
      const preview = String(qa1.content || "").slice(0, 300);
      if (cards.length === 0) {
        console.warn("[Cards] Q/A output preview:", preview);
      }
      console.log(`[Cards] Q/A primary returned ${qa1.content?.length || 0} chars, parsed ${cards.length}/${n}`);

      if (cards.length > 0 && cards.length < n) {
        const qa2 = await runQaPass(n - cards.length, cards);
        if (qa2.ok && qa2.content) {
          const parsed2 = parseCardsFromQA(qa2.content) || [];
          console.log(`[Cards] Q/A continuation parsed ${parsed2.length} cards`);
          cards.push(...parsed2);
        }
      }

      const unique = new Map<string, { question: string; answer: string }>();
      for (const c of cards) unique.set(c.question.toLowerCase(), c);
      let deduped = Array.from(unique.values()).slice(0, n);

      // If we got close but not exact, do a couple of cheap fill attempts.
      // This avoids creating decks with 18/20 cards.
      for (let attempt = 0; attempt < 2 && deduped.length < n; attempt++) {
        const missing = n - deduped.length;
        console.log(`[Cards] Q/A fill attempt ${attempt + 1}: missing ${missing}/${n}`);

        const qaFill = await runQaPass(missing, deduped);
        if (qaFill.ok && qaFill.content) {
          const parsedFill = parseCardsFromQA(qaFill.content) || [];
          if (parsedFill.length) {
            for (const c of parsedFill) deduped.push(c);
            const u2 = new Map<string, { question: string; answer: string }>();
            for (const c of deduped) u2.set(c.question.toLowerCase(), c);
            deduped = Array.from(u2.values()).slice(0, n);
          }
        }
      }

      // If still short and we have guided JSON available, fill the remainder strictly.
      if (deduped.length < n && useGuidedJson) {
        const missing = n - deduped.length;
        console.log(`[Cards] Falling back to guided JSON to fill remaining ${missing}/${n}`);
        const avoid = deduped.length
          ? `\n\nAlready generated (do NOT repeat these questions):\n${deduped
              .slice(0, 12)
              .map((c, i) => `- ${i + 1}. ${c.question}`)
              .join("\n")}`
          : "";

        const batchMessages = [
          messages[0],
          { role: "user" as const, content: `${buildFlashcardPrompt(llmSource, missing)}${avoid}` },
        ];

        const maxTokens = Math.min(OPENAI_MAX_OUTPUT_TOKENS, 45 * missing + 120);
        const guided = await callLLMResult(batchMessages as any, maxTokens, 0, {
          topP: 1,
          guidedJson: makeGuidedJson(missing),
        });

        if (guided.ok) {
          const cleaned = stripFence(guided.content || "");
          const parsed = await parseCardsFromJsonLike(cleaned);
          if (parsed && parsed.length) {
            for (const c of parsed) deduped.push(c);
            const u3 = new Map<string, { question: string; answer: string }>();
            for (const c of deduped) u3.set(c.question.toLowerCase(), c);
            deduped = Array.from(u3.values()).slice(0, n);
          }
        }
      }

      if (deduped.length === n) return deduped;

      console.warn(`[Cards] Could not reach exact card count (${deduped.length}/${n}); falling back to JSON modes`);
    }
  }

  // Guided JSON path: generate in batches and enforce timeouts to avoid platform runtime timeouts.
  if (useGuidedJson) {
    const startedAt = Date.now();
    const envBudgetMs = Number(process.env.FLASHCARDS_WALLCLOCK_BUDGET_MS || "");
    const wallClockBudgetMs =
      Number.isFinite(envBudgetMs) && envBudgetMs > 0
        ? Math.floor(envBudgetMs)
        // Default conservatively under ~60s serverless limits.
        : 55_000;

    // If FLASHCARDS_BATCH_SIZE is not set, default to a single call for typical counts (e.g. 20)
    // to avoid paying prompt overhead multiple times.
    const envBatchSizeRaw = process.env.FLASHCARDS_BATCH_SIZE;
    const batchSize = Math.max(
      3,
      Math.min(25, Number(envBatchSizeRaw ? envBatchSizeRaw : String(n)) || n)
    );
    const cards: Array<{ question: string; answer: string }> = [];

    while (cards.length < n) {
      if (Date.now() - startedAt > wallClockBudgetMs) {
        const err: any = new Error("AI generation took too long. Try fewer cards or retry.");
        err.code = "RUNPOD_TIMEOUT";
        throw err;
      }

      const remaining = n - cards.length;
      const m = Math.min(batchSize, remaining);

      const remainingBudgetMs = wallClockBudgetMs - (Date.now() - startedAt);
      // Ensure we never start a call that cannot complete before our own budget expires.
      // This avoids Vercel killing the function without a structured error response.
      const perCallTimeoutMs = Math.max(8_000, Math.min(50_000, remainingBudgetMs - 1_500));
      if (perCallTimeoutMs < 8_000) {
        const err: any = new Error("AI generation took too long. Try fewer cards or retry.");
        err.code = "RUNPOD_TIMEOUT";
        throw err;
      }
      const avoid = cards.length
        ? `\n\nAlready generated (do NOT repeat these questions):\n${cards
            .slice(0, 12)
            .map((c, i) => `- ${i + 1}. ${c.question}`)
            .join("\n")}`
        : "";

      const batchMessages = [
        messages[0],
        { role: "user" as const, content: `${buildFlashcardPrompt(llmSource, m)}${avoid}` },
      ];

      // Keep tokens proportional to requested cards to reduce latency.
      // Short answers: 20 cards should typically fit in ~800–1200 tokens.
      const maxTokens = Math.min(OPENAI_MAX_OUTPUT_TOKENS, 45 * m + 120);

      const result = await callLLMResult(batchMessages as any, maxTokens, 0, {
        topP: 1,
        guidedJson: makeGuidedJson(m),
        timeoutMs: perCallTimeoutMs,
      });

      if (!result.ok) {
        if (result.reason === "TIMEOUT" && String(result.lastStatus || "").toUpperCase() === "IN_QUEUE") {
          const err: any = new Error("RunPod job is still in queue (no capacity). Try again in a minute.");
          err.code = "RUNPOD_IN_QUEUE";
          err.jobId = result.jobId;
          err.lastStatus = result.lastStatus;
          throw err;
        }
        if (result.reason === "TIMEOUT") {
          const err: any = new Error("AI generation took too long. Try fewer cards or retry.");
          err.code = "RUNPOD_TIMEOUT";
          throw err;
        }

        const err: any = new Error("RunPod request failed.");
        err.code = "RUNPOD_HTTP_ERROR";
        err.reason = result.reason;
        err.httpStatus = result.httpStatus;
        throw err;
      }

      const cleaned = stripFence(result.content || "");
      const parsed = await parseCardsFromJsonLike(cleaned);
      if (!parsed || parsed.length === 0) {
        const err: any = new Error("RunPod returned output that could not be parsed into flashcards.");
        err.code = "RUNPOD_BAD_OUTPUT";
        err.preview = String(cleaned || "").slice(0, 500);
        err.jobId = result.jobId || null;
        throw err;
      }

      for (const c of parsed) cards.push(c);
      const unique = new Map<string, { question: string; answer: string }>();
      for (const c of cards) unique.set(c.question.toLowerCase(), c);
      cards.splice(0, cards.length, ...Array.from(unique.values()));
    }

    return cards.slice(0, n);
  }

  // Non-guided path: single call + parse/repair.
  // Zero temperature to reduce non-JSON chatter.
  const result = await callLLMResult(messages, OPENAI_MAX_OUTPUT_TOKENS, 0, {
    topP: 1,
    guidedJson: undefined,
  });
  if (!result.ok) {
    if (result.reason === "TIMEOUT" && String(result.lastStatus || "").toUpperCase() === "IN_QUEUE") {
      const err: any = new Error("RunPod job is still in queue (no capacity). Try again in a minute.");
      err.code = "RUNPOD_IN_QUEUE";
      err.jobId = result.jobId;
      err.lastStatus = result.lastStatus;
      throw err;
    }
    if (result.reason === "TIMEOUT") {
      const err: any = new Error("AI generation took too long. Try fewer cards or retry.");
      err.code = "RUNPOD_TIMEOUT";
      throw err;
    }
    console.warn("[Cards] Using fallback cards due to API failure");
    return null;
  }

  const content = result.content;
  const primaryJobId = result.jobId;
  
  if (!content) {
    console.warn("[Cards] Using fallback cards due to API failure");
    return null;
  }
  
  let cleanedContent = stripFence(content);
  console.log("[Cards] RunPod returned", cleanedContent.length, "chars of response");

  // First parse attempt
  try {
    const parsed = await parseCardsFromJsonLike(cleanedContent);
    if (parsed) return parsed;
  } catch (e) {
    console.error("[Cards] Failed to parse RunPod JSON response:", (e as any)?.message);
    console.error("[Cards] Invalid response content:", cleanedContent.slice(0, 500));
  }

  // One-shot repair attempt: ask the model to convert its own output into JSON-only.
  let repairJobId: string | null = null;
  try {
    const repairMessages = [
      {
        role: "system" as const,
        content:
          "You are a strict JSON formatter. Output ONLY valid JSON. No prose, no markdown, no code fences. The output must be a JSON array of objects with keys q and a.",
      },
      {
        role: "user" as const,
        content:
          `Convert the following into a JSON array of EXACTLY ${Math.min(Math.max(count, 5), 50)} flashcards with keys q and a. Output JSON only.\n\nCONTENT:\n${cleanedContent}`,
      },
    ];

    const repaired = await callLLMResult(repairMessages, OPENAI_MAX_OUTPUT_TOKENS, 0, {
      topP: 1,
      guidedJson: undefined,
    });
    if (repaired.ok && repaired.content) {
      repairJobId = repaired.jobId || null;
      cleanedContent = stripFence(repaired.content);
      const parsed = await parseCardsFromJsonLike(cleanedContent);
      if (parsed) return parsed;
    }
  } catch (e) {
    console.warn("[Cards] Repair pass failed:", (e as any)?.message || e);
  }

  // Second fallback: request strict Q/A blocks (more reliable than JSON for reasoning models), then parse into cards.
  try {
    const qaMessages = [
      {
        role: "system" as const,
        content:
          "You are a flashcard generator. Output ONLY flashcards in the requested Q/A format. No analysis, no reasoning, no extra text.",
      },
      { role: "user" as const, content: buildFlashcardPromptQA(source, count) },
    ];

    const qaResult = await callLLMResult(qaMessages, OPENAI_MAX_OUTPUT_TOKENS, 0, {
      topP: 1,
      stop: ["</final>"],
    });

    if (qaResult.ok && qaResult.content) {
      const parsed = parseCardsFromQA(qaResult.content);
      if (parsed && parsed.length > 0) {
        console.log("[Cards] Parsed", parsed.length, "cards from Q/A fallback format");
        return parsed;
      }
    }
  } catch (e) {
    console.warn("[Cards] Q/A fallback pass failed:", (e as any)?.message || e);
  }

  const err: any = new Error("RunPod returned non-JSON output; cannot parse flashcards.");
  err.code = "RUNPOD_BAD_OUTPUT";
  err.preview = String(cleanedContent || "").slice(0, 500);
  err.jobId = primaryJobId || null;
  err.repairJobId = repairJobId;
  throw err;
}
function fallbackCards(text: string) {
  const chunks = cleanText(text).split(/[.!?]\s+/).slice(0, 20);
  if (!chunks.length) return [
    { question: "What is the main idea?", answer: "This deck was generated without enough context." },
    { question: "What is one key term?", answer: "Add more content to generate richer cards." },
  ];
  return chunks.map((c, i) => ({ question: `Key point ${i + 1}`, answer: c }));
}

// -------------------- route --------------------
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const testKey = process.env.FLASHCARDS_TEST_KEY;
    const isTestMode = !!testKey && req.headers.get("x-flashcards-test-key") === testKey;

    let userId: string | null = null;
    if (!isTestMode) {
      const authResult = await auth();
      userId = authResult.userId;
      if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    const clerkUserId = userId ?? undefined;

    // In production we should not silently fall back if RunPod isn't configured.
    if (process.env.NODE_ENV === "production") {
      const missingEndpoint = !process.env.RUNPOD_ENDPOINT;
      const missingApiKey = !process.env.RUNPOD_API_KEY;
      const missingRunpod = missingEndpoint || missingApiKey;
      if (missingRunpod) {
        return NextResponse.json(
          {
            error: "RunPod is not configured on the server. Set RUNPOD_ENDPOINT and RUNPOD_API_KEY in Vercel environment variables.",
            code: "RUNPOD_NOT_CONFIGURED",
            missing: {
              RUNPOD_ENDPOINT: missingEndpoint,
              RUNPOD_API_KEY: missingApiKey,
            },
            vercel: {
              VERCEL_ENV: process.env.VERCEL_ENV || null,
              VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF || null,
              VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || null,
            },
          },
          { status: 500 }
        );
      }
    }

    const form = await req.formData();
    
    // Enforce per-user daily deck creation limit (skip in test mode)
    if (!isTestMode) {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const createdToday = await prisma.deck.count({
          where: { user: { clerkUserId: userId! }, createdAt: { gte: startOfDay } },
        });
        if (createdToday >= MAX_DECKS_PER_DAY) {
          return NextResponse.json(
            { error: `Daily limit reached. You can create up to ${MAX_DECKS_PER_DAY} decks per day.`, code: "RATE_LIMIT" },
            { status: 429 }
          );
        }
      } catch (e) {
        console.warn("[RateLimit] Failed to check daily limit:", (e as any)?.message || e);
      }
    }

    // Helper function for getting last value from form
    const getLast = (name: string) => {
      const all = form.getAll(name);
      return all.length ? String(all[all.length - 1] ?? "") : "";
    };

    // Get all form inputs at once
    const formTitle = String(form.get("title") || "").trim();
    let source = String(form.get("source") || "").trim();
    const urlStr = String(form.get("url") || "").trim();
    const docUrl = getLast("docUrl").trim();
    const docName = getLast("docName").trim();
  let file = form.get("file") as File | null;
  let video = form.get("video") as File | null;
  let subtitle = form.get("subtitle") as File | null;
  let audioFile = form.get("audio") as File | null;
  const videoUrl = getLast("videoUrl").trim();
  const videoName = getLast("videoName").trim();

    // Some browsers/frameworks can submit an empty File placeholder.
    // Treat those as not provided so we don't accidentally trigger video/audio paths.
    if (file && file.size === 0) file = null;
    if (video && video.size === 0) video = null;
    if (subtitle && subtitle.size === 0) subtitle = null;
    if (audioFile && audioFile.size === 0) audioFile = null;
    
    // Debug logging
    console.log("[Form] Received inputs:", {
      title: formTitle,
      hasSource: !!source,
      hasUrl: !!urlStr,
      hasFile: !!file,
      hasVideo: !!video,
      hasSubtitle: !!subtitle,
      hasAudio: !!audioFile,
      videoUrl: videoUrl || undefined,
      videoName: videoName || undefined,
      fileSize: file?.size,
      videoSize: video?.size,
      subtitleSize: subtitle?.size,
      audioFileName: audioFile?.name,
      audioFileSize: audioFile?.size
    });

    // Initialize source tracking
    const sourceOptions = {
      content: false,
      pdf: false,
      pptx: false,
      url: false,
    };

    // Optional: Block audio/video ingestion to avoid transcription costs
    if (DISABLE_AUDIO_UPLOAD && (audioFile || video || getLast("videoUrl").trim())) {
      return NextResponse.json(
        { error: "Audio/video uploads are disabled in this environment.", code: "AUDIO_DISABLED" },
        { status: 400 }
      );
    }

    // Validate title
    if (!formTitle) {
      return NextResponse.json({ error: "Title is required", code: "TITLE_REQUIRED" }, { status: 400 });
    }
    if (formTitle.length < 3) {
      return NextResponse.json({ error: "Title must be at least 3 characters", code: "TITLE_TOO_SHORT" }, { status: 400 });
    }
    if (formTitle.length > 120) {
      return NextResponse.json({ error: "Title must be at most 120 characters", code: "TITLE_TOO_LONG" }, { status: 400 });
    }

    // Validate content
    const hasRemoteVideo = !!videoUrl;
    const hasDocUrl = !!docUrl;
    if (!source && !urlStr && !file && !video && !audioFile && !subtitle && !hasRemoteVideo && !hasDocUrl) {
      return NextResponse.json(
        { error: "Please provide content through text, URL, PDF, PPTX, video, or audio", code: "NO_CONTENT" },
        { status: 400 }
      );
    }

    // Origin tracking
    let origin: "text" | "url" | "youtube" | "video" | "pdf" | "pptx" | "unknown" = "unknown";

    // 0) Video file - prefer RunPod ASR by URL (fast); fallback to local ffmpeg + Whisper only if needed.
    if (!source && (video || videoUrl)) {
      try {
        const isRemote = !!videoUrl && !video;
        const videoSize = video?.size || 0;
        console.log("[Video] Processing", isRemote ? "remote video URL" : "uploaded video file", isRemote ? videoUrl : video!.name, "size:", videoSize);

        // Some deployments/browsers can submit an empty file object; skip it.
        if (!isRemote && video && videoSize === 0) {
          console.warn("[Video] Uploaded video file has size 0; skipping transcription.");
          throw new Error("Empty video upload");
        }
        
        const hasRunpodAsr = !!(process.env.RUNPOD_ASR_ENDPOINT || process.env.RUNPOD_ASR_ENDPOINT_ID);

        // Fast path: if RunPod ASR is configured, send the video URL directly to the ASR worker.
        // This avoids server-side ffmpeg (slow + fragile on Vercel) and avoids moving large bytes through the function.
        if (hasRunpodAsr) {
          let mediaUrl = videoUrl;
          if (!mediaUrl && video) {
            const safeName = (video.name || videoName || "video.mp4").replace(/[^a-zA-Z0-9._-]+/g, "_");
            const pathname = `uploads/video/${Date.now()}-${safeName}`;
            const blob = await put(pathname, video, {
              access: "public",
              contentType: video.type || "application/octet-stream",
              addRandomSuffix: true,
            });
            mediaUrl = blob.url;
          }

          if (!mediaUrl) throw new Error("Missing videoUrl/video file");

          console.log("[Video] Using RunPod ASR via URL (skipping local ffmpeg)");
          const asrTimeoutMs = Number(process.env.RUNPOD_ASR_TIMEOUT_MS || 90_000);
          const asr = await transcribeAudioUrlWithRunpod(mediaUrl, { timeoutMs: asrTimeoutMs });
          if (asr.ok) {
            const text = cleanText(asr.transcript || "");
            if (!text || text.length < 10) {
              throw new Error("Transcription returned no usable text. The video may have no speech.");
            }

            source = truncate(text);
            origin = "video";
            console.log("[Video] Successfully processed video into", source.length, "chars of text (RunPod ASR)");
          } else {
            // Compatibility fallback: some ASR workers cannot ingest video URLs directly.
            // Extract audio locally with ffmpeg, then send audio to RunPod ASR.
            console.warn(
              "[Video] RunPod ASR URL ingest failed; falling back to local ffmpeg audio extraction:",
              asr.code,
              asr.message
            );

            const { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } = await import("fs");
            const { tmpdir } = await import("os");
            const { join } = await import("path");
            const { spawn } = await import("child_process");

            const tempDir = mkdtempSync(join(tmpdir(), "quickstud-video-"));
            const videoPath = join(tempDir, `input${(video?.name || videoName || "").match(/\.[^.]+$/)?.[0] || ".mp4"}`);
            const audioPath = join(tempDir, "audio.mp3");

            try {
              if (!isRemote && video) {
                const videoBuffer = Buffer.from(await video.arrayBuffer());
                writeFileSync(videoPath, videoBuffer);
                console.log("[Video] Saved to:", videoPath);
              }

              console.log("[Video] Starting audio extraction with ffmpeg (fallback)...");
              await new Promise<void>((resolve, reject) => {
                const bin = "ffmpeg";
                const ffmpeg = spawn(bin, [
                  "-i",
                  isRemote ? videoUrl : videoPath,
                  "-vn",
                  "-ac",
                  "1",
                  "-ar",
                  "16000",
                  "-b:a",
                  "32k",
                  "-y",
                  audioPath,
                ]);

                let stderr = "";
                ffmpeg.stderr.on("data", (data) => {
                  stderr += data.toString();
                });

                ffmpeg.on("close", (code) => {
                  if (code === 0) return resolve();
                  reject(new Error(`FFmpeg failed with code ${code} (binary: ${bin}). ${stderr.slice(-200)}`));
                });

                ffmpeg.on("error", (err) => {
                  reject(new Error(`Could not spawn ffmpeg: ${err.message}`));
                });
              });

              const audioBuffer = readFileSync(audioPath);
              console.log("[Video] Audio extracted:", audioBuffer.length, "bytes. Sending to RunPod ASR...");

              const text = await transcribeBuffer(audioBuffer, "audio.mp3", "audio/mpeg");
              const cleaned = cleanText(text || "");
              if (!cleaned || cleaned.length < 10) {
                throw new Error("Transcription returned no usable text. The video may have no speech.");
              }

              source = truncate(cleaned);
              origin = "video";
              console.log("[Video] Successfully processed video into", source.length, "chars of text (ffmpeg -> RunPod ASR)");
            } finally {
              try {
                if (!isRemote) unlinkSync(videoPath);
                unlinkSync(audioPath);
                rmSync(tempDir, { recursive: true });
              } catch (e) {
                console.warn("[Video] Cleanup warning:", (e as any)?.message);
              }
            }
          }
        } else {
          // Fallback path (legacy): extract audio server-side and transcribe.
          // This is slower and more likely to hit serverless limits.
          const allowOpenAIFallback = String(process.env.ASR_FALLBACK || "").toLowerCase() === "openai";
          if (!allowOpenAIFallback) {
            throw new Error(
              "RunPod ASR is not configured. Set RUNPOD_ASR_ENDPOINT(_ID) and RUNPOD_ASR_API_KEY, or set ASR_FALLBACK=openai to allow Whisper fallback."
            );
          }
          if (!process.env.OPENAI_API_KEY) {
            throw new Error("Missing OPENAI_API_KEY (ASR_FALLBACK=openai requested)");
          }
        
          // Save video to temp file
          const { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } = await import("fs");
          const { tmpdir } = await import("os");
          const { join } = await import("path");
          const { spawn } = await import("child_process");

          const tempDir = mkdtempSync(join(tmpdir(), "quickstud-video-"));
          const videoPath = join(tempDir, `input${(video?.name || videoName || "").match(/\.[^.]+$/)?.[0] || ".mp4"}`);
          const audioPath = join(tempDir, "audio.mp3");

          if (!isRemote && video) {
            // Write uploaded video file to disk
            const videoBuffer = Buffer.from(await video.arrayBuffer());
            writeFileSync(videoPath, videoBuffer);
            console.log("[Video] Saved to:", videoPath);
          }

          // Extract audio using ffmpeg (system binary)
          console.log("[Video] Starting audio extraction with ffmpeg...");
          await new Promise<void>((resolve, reject) => {
            const bin = "ffmpeg";
            console.log("[Video] Using system ffmpeg");

            const ffmpeg = spawn(bin, [
              "-i",
              isRemote ? videoUrl : videoPath,
              "-vn", // no video
              "-ac",
              "1", // mono
              "-ar",
              "16000", // 16 kHz
              "-b:a",
              "32k", // 32 kbps
              "-y",
              audioPath,
            ]);

            let stderr = "";
            ffmpeg.stderr.on("data", (data) => {
              stderr += data.toString();
            });

            ffmpeg.on("close", (code) => {
              if (code === 0) {
                console.log("[Video] Audio extracted successfully");
                resolve();
              } else {
                console.error("[Video] FFmpeg stderr:", stderr);
                reject(new Error(`FFmpeg failed with code ${code} (binary: ${bin}). ${stderr.slice(-200)}`));
              }
            });

            ffmpeg.on("error", (err) => {
              console.error("[Video] FFmpeg spawn error:", err);
              reject(new Error(`Could not spawn ffmpeg: ${err.message}`));
            });
          });

          // Transcribe extracted audio
          const audioBuffer = readFileSync(audioPath);
          console.log("[Video] Audio extracted:", audioBuffer.length, "bytes. Sending to Whisper...");

          // OpenAI Whisper has a 25MB file size limit for audio
          if (audioBuffer.length > 25 * 1024 * 1024) {
            throw new Error(
              "Extracted audio exceeds 25MB limit for Whisper API. Try a shorter video or use YouTube URL with captions."
            );
          }

          const text = await transcribeBufferWithOpenAI(audioBuffer);
          console.log("[Video] Transcription completed:", text.length, "chars");
          console.log("[Video] Sample:", text.slice(0, 200));

          // Cleanup
          try {
            if (!isRemote) unlinkSync(videoPath);
            unlinkSync(audioPath);
            rmSync(tempDir, { recursive: true });
            console.log("[Video] Cleanup complete");
          } catch (e) {
            console.warn("[Video] Cleanup warning:", (e as any)?.message);
          }

          if (!text || text.length < 10) {
            throw new Error("Transcription returned no usable text. The video may have no speech.");
          }

          source = truncate(text);
          origin = "video";
          console.log("[Video] Successfully processed video into", source.length, "chars of text");
        }
      } catch (e: any) {
        console.error("[Video] Processing failed:", e?.message || e);
        if (STRICT_VIDEO) return NextResponse.json({ 
          error: `Video processing failed: ${e?.message || e}`, 
          code: "VIDEO_PROCESS" 
        }, { status: 400 });
        console.warn("[Video] Continuing without video transcription");
      }
    }

    // 0b) Audio file (from client-side processing, legacy)
    if (!source && audioFile) {
      try {
        console.log("[Audio] Transcribing audio file:", audioFile.name, "size:", audioFile.size, "bytes");
        const text = await transcribeAudioFile(audioFile);
        console.log("[Audio] Transcription completed:", text.length, "chars");
        console.log("[Audio] Sample:", text.slice(0, 200));
        if (text) { source = truncate(text); origin = "video"; }
      } catch (e: any) {
        console.error("[Audio] Transcription failed:", e?.message || e);
        if (STRICT_VIDEO) return NextResponse.json({ error: e?.message || "Audio transcription failed.", code: "AUDIO_TRANSCRIBE" }, { status: 400 });
        console.warn("[Audio] Continuing without audio transcription");
      }
    }

    // 1) Raw text
    if (!source && form.get("source")) { source = truncate(cleanText(String(form.get("source")))); origin = "text"; }

    // 2) URL: YouTube captions → else scrape website text
    if (!source && urlStr) {
      try {
        const u = new URL(urlStr);
        if (isYouTubeHostname(u.hostname)) {
          const ytDiag: any = {
            videoId: getYouTubeId(u),
            captions: { attempted: false, ok: false, error: null as string | null },
            asr: {
              attempted: false,
              ok: false,
              error: null as string | null,
              disabledByEnv: DISABLE_AUDIO_UPLOAD,
              hasRunpodAsr: !!(process.env.RUNPOD_ASR_ENDPOINT || process.env.RUNPOD_ASR_ENDPOINT_ID),
              hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
            },
            vercel: {
              VERCEL_ENV: process.env.VERCEL_ENV || null,
              VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || null,
            },
          };

          try {
            const yt = await extractFromYouTubeStrict(u);
            source = truncate(yt.text);
            origin = "youtube";
            if (!source) throw new Error("YouTube extraction returned empty text");
          } catch (e: any) {
            // Production note: yt-dlp often isn't available on Vercel.
            // Fallback to ytdl-core caption track fetch (no external binary).
            const id = getYouTubeId(u);
            if (id) {
              ytDiag.captions.attempted = true;
              try {
                const text = await fetchYouTubeTranscriptViaYtdlCore(id);
                if (text) {
                  source = truncate(text);
                  origin = "youtube";
                  ytDiag.captions.ok = true;
                }
              } catch (capErr: any) {
                ytDiag.captions.error = String(capErr?.message || capErr || "CAPTIONS_FAILED");
              }

              // If captions are unavailable, fall back to audio download + RunPod ASR.
              // This avoids requiring yt-dlp/ffmpeg on Vercel.
              if (!source && !DISABLE_AUDIO_UPLOAD) {
                const hasRunpodAsr = !!(process.env.RUNPOD_ASR_ENDPOINT || process.env.RUNPOD_ASR_ENDPOINT_ID);
                if (hasRunpodAsr) {
                  console.log("[YouTube] Captions unavailable; downloading audio for ASR:", id);
                  // Keep this conservative to avoid blowing serverless memory/time.
                  const maxBytes = Number(process.env.YT_AUDIO_MAX_BYTES || 35_000_000);
                  ytDiag.asr.attempted = true;
                  try {
                    const audio = await downloadYouTubeAudioBufferViaYtdlCore(id, maxBytes);
                    const asrText = await transcribeBuffer(audio.buf, audio.filename, audio.contentType);
                    if (asrText) {
                      source = truncate(asrText);
                      origin = "youtube";
                      ytDiag.asr.ok = true;
                    }
                  } catch (asrErr: any) {
                    ytDiag.asr.error = String(asrErr?.message || asrErr || "ASR_FAILED");
                  }
                }
              }
            }

            // If we still don't have text for a YouTube URL, return an actionable error.
            if (!source) {
              if (ytDiag.asr.disabledByEnv) {
                return NextResponse.json(
                  {
                    error: "YouTube captions were unavailable and audio transcription is disabled (DISABLE_AUDIO_UPLOAD=1).",
                    code: "YT_AUDIO_DISABLED",
                    diag: ytDiag,
                  },
                  { status: 400 }
                );
              }
              if (!ytDiag.asr.hasRunpodAsr) {
                return NextResponse.json(
                  {
                    error:
                      "YouTube captions were unavailable and RunPod ASR is not configured in production. Set RUNPOD_ASR_ENDPOINT(_ID) and RUNPOD_ASR_API_KEY in Vercel env vars.",
                    code: "RUNPOD_ASR_NOT_CONFIGURED",
                    diag: ytDiag,
                  },
                  { status: 500 }
                );
              }
              if (ytDiag.asr.attempted && ytDiag.asr.error) {
                const errMsg = String(ytDiag.asr.error || "");
                const looksLikeYouTubeBlocked = /status code:\s*\d+/i.test(errMsg) || /410|403|429/.test(errMsg);
                if (looksLikeYouTubeBlocked) {
                  return NextResponse.json(
                    {
                      error:
                        "YouTube blocked server-side audio download from this deployment. Try a different video, or use an upload/transcript source instead.",
                      code: "YT_AUDIO_DOWNLOAD_FAILED",
                      diag: ytDiag,
                    },
                    { status: 400 }
                  );
                }
                return NextResponse.json(
                  {
                    error: "YouTube captions were unavailable and audio transcription failed.",
                    code: "YT_ASR_FAILED",
                    diag: ytDiag,
                  },
                  { status: 400 }
                );
              }
            }

            if (!source && STRICT_VIDEO) {
              return NextResponse.json(
                { error: e?.message || "Failed to read YouTube captions.", code: "YT_NO_CAPTIONS" },
                { status: 400 }
              );
            }
          }
        } else {
          const web = await extractFromWebsite(u);
          if (web?.text) { source = truncate(web.text); origin = "url"; }
        }
      } catch { /* malformed URL */ }
    }

    // 2b) subtitle upload (SRT/VTT) → parse into text
    if (!source && subtitle) {
      try {
        const buf = Buffer.from(await subtitle.arrayBuffer());
        const text = parseSubtitleBuffer(buf);
        if (text) { source = truncate(text); origin = "video"; }
      } catch (e) {
        console.warn("[Subtitle] Failed to parse uploaded subtitle:", (e as any)?.message || e);
      }
    }

    // 3) file → pdf/pptx
    if (!source && file) {
      console.log("[Upload] File received:", { name: file.name, type: file.type, size: file.size });
      const buf = Buffer.from(await file.arrayBuffer());
      const kind = guessKindFromNameType(file.name, file.type);
      console.log("[Upload] Detected file kind:", kind);
      if (kind === "pdf") {
        const text = await extractPdfTextFromBuffer(buf); 
        if (text) { 
          console.log("[Upload] PDF text extracted successfully");
          source = truncate(text);
          origin = "pdf";
        } else {
          console.log("[Upload] PDF text extraction failed - empty result");
        }
      } else if (kind === "pptx") {
        const text = await extractPptxTextFromBuffer(buf);
        if (text) {
          console.log("[Upload] PPTX text extracted successfully");
          source = truncate(text);
          origin = "pptx";
        } else {
          console.log("[Upload] PPTX text extraction failed - empty result");
        }
      }
    }

    // 4) docUrl → pdf/pptx
    if (!source && docUrl) {
      try {
        const head = await fetch(docUrl, { method: "HEAD" }).catch(() => null);
        const ct = head?.ok ? head.headers.get("content-type") || undefined : undefined;
        const res = await fetch(docUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const kind = guessKindFromNameType(docName, ct);
          if (kind === "pdf") {
            const text = await extractPdfTextFromBuffer(buf); if (text) { source = truncate(text); origin = "pdf"; }
          } else if (kind === "pptx") {
            const text = await extractPptxTextFromBuffer(buf); if (text) { source = truncate(text); origin = "pptx"; }
          }
        }
      } catch {}
    }

    // If the user provided an input but we couldn't extract any text, fail loudly.
    // Generating a "generic" deck here leads to low-quality, repetitive cards.
    const providedNonTitleInput =
      !!String(form.get("source") || "").trim() ||
      !!urlStr ||
      !!file ||
      !!video ||
      !!audioFile ||
      !!subtitle ||
      !!videoUrl ||
      !!docUrl;

    let title = formTitle;
    if (!source && providedNonTitleInput) {
      return NextResponse.json(
        {
          error:
            "We couldn't extract readable text from what you provided. Try pasting text directly, using a text-based PDF (not scanned images), or providing a different URL/video with captions.",
          code: "NO_TEXT_EXTRACTED",
          inputs: {
            hasSource: !!String(form.get("source") || "").trim(),
            hasUrl: !!urlStr,
            hasFile: !!file,
            hasDocUrl: !!docUrl,
            hasVideo: !!video || !!videoUrl,
            hasSubtitle: !!subtitle,
            hasAudio: !!audioFile,
          },
        },
        { status: 400 }
      );
    }
    if (!title) {
      if (docName) title = docName.replace(/\.(pdf|pptx)$/i, "");
      else if (urlStr) {
        try {
          const u = new URL(urlStr);
          title = isYouTubeHostname(u.hostname) ? `YouTube ${getYouTubeId(u) ?? u.hostname}` : u.hostname;
        } catch { title = "New Deck"; }
      } else title = "New Deck";
    }
    title = title.slice(0, 120);

    // Get card count from form data (default to 20)
    const cardCount = Number(form.get("cardCount")) || DEFAULT_CARD_COUNT;
    console.log(`[Cards] Generating ${cardCount} flashcards for deck: ${title}`);

    // Generate cards
    let aiCards: Awaited<ReturnType<typeof generateCardsWithOpenAI>> = null;
    try {
      aiCards = await generateCardsWithOpenAI(source, cardCount);
    } catch (e: any) {
      if (e?.code === "RUNPOD_IN_QUEUE") {
        return NextResponse.json(
          {
            error: "AI generation is queued on RunPod and did not start within the request time limit. Please retry shortly.",
            code: "RUNPOD_IN_QUEUE",
            jobId: e?.jobId || null,
            lastStatus: e?.lastStatus || null,
          },
          { status: 503 }
        );
      }

      if (e?.code === "RUNPOD_TIMEOUT") {
        return NextResponse.json(
          {
            error:
              "AI generation took too long and timed out. Try fewer cards (e.g. 10) or retry shortly.",
            code: "RUNPOD_TIMEOUT",
          },
          { status: 504 }
        );
      }

      if (e?.code === "RUNPOD_BAD_OUTPUT") {
        return NextResponse.json(
          {
            error:
              "AI returned an invalid format (expected JSON flashcards). Please retry, or adjust the RunPod template/model to output strict JSON.",
            code: "RUNPOD_BAD_OUTPUT",
            preview: e?.preview || null,
            jobId: e?.jobId || null,
            repairJobId: e?.repairJobId || null,
          },
          { status: 502 }
        );
      }
      throw e;
    }
    const cards = aiCards ?? (() => {
      console.warn("[Cards] ⚠️ USING FALLBACK CARDS - AI generation failed or unavailable");
      return fallbackCards(source).map((c) => ({ question: c.question, answer: c.answer }));
    })();

    // Test mode: don't touch the DB, just return the cards.
    if (isTestMode) {
      return NextResponse.json(
        {
          ok: true,
          mode: "test",
          title,
          origin,
          cardCountRequested: cardCount,
          cardCountReturned: cards.length,
          cards,
        },
        { status: 200 }
      );
    }

    // Ensure user
    const userRow = await prisma.user.upsert({
      where: { clerkUserId }, update: {}, create: { clerkUserId: clerkUserId! },
    });

    // Create deck
    let deckId: string;
    try {
      const deck = await prisma.deck.create({
        data: { title, userId: userRow.id, /* @ts-ignore */ source: truncate(source) },
        select: { id: true },
      });
      deckId = deck.id;
    } catch {
      const deck = await prisma.deck.create({ data: { title, userId: userRow.id }, select: { id: true } });
      deckId = deck.id;
    }

    if (cards.length) {
      await prisma.card.createMany({ data: cards.map((c) => ({ deckId, question: c.question, answer: c.answer })) });
    }

    const redirectUrl = new URL(`/app/deck/${deckId}`, req.url);
    redirectUrl.searchParams.set("origin", origin);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to generate", code: "SERVER_FAIL" }, { status: 500 });
  }
}
