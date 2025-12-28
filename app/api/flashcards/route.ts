/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/aiClient";

export const runtime = "nodejs";         // node runtime to allow larger bodies locally
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini";
const MAX_SOURCE_CHARS = 20_000;
const DEFAULT_CARD_COUNT = 20;
const STRICT_VIDEO = process.env.STRICT_VIDEO === "1";
// Cost guardrails
const DISABLE_AUDIO_UPLOAD = process.env.DISABLE_AUDIO_UPLOAD === "1";
const OPENAI_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 3000);
const MAX_DECKS_PER_DAY = Number(process.env.MAX_DECKS_PER_DAY || 50);

function cleanText(s: string) { return s.replace(/\s+/g, " ").trim(); }
function truncate(s: string, max = MAX_SOURCE_CHARS) { return s.length > max ? s.slice(0, max) : s; }
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
  const first = s.indexOf("[");
  const last = s.lastIndexOf("]");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
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

  // 2) If captions unavailable, attempt to download audio and transcribe via OpenAI
  try {
    const ytdl = (await import("ytdl-core")) as any;
    const stream = ytdl(id, { filter: "audioonly", quality: "lowestaudio" });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    console.log("[YouTube] Downloaded audio size:", buf.length);
    const text = await transcribeBufferWithOpenAI(buf);
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
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", file, file.name || "audio.mp3");
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

// Transcribe a server-side audio buffer using OpenAI Whisper endpoint
async function transcribeBufferWithOpenAI(buf: Buffer): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const form = new FormData();
  form.append("model", "whisper-1");
  // Node 18+ supports Blob; cast to any to satisfy TS for server environment
  const blob = new Blob([buf as any]);
  form.append("file", blob as any, "audio.mp3");
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
  return `You are an expert tutor creating study flashcards. Generate ${n} question-and-answer flashcards from the material below.

RULES:
- Each card has a QUESTION and an ANSWER
- Questions must be clear, specific, and testable
- Answers must be concise (1-3 sentences max)
- Test ONE concept per card
- Focus on key facts, definitions, and relationships
- Use simple, direct language

GOOD EXAMPLES:
Q: "What is a qubit?"
A: "A qubit is the basic unit of quantum information that can exist in superposition of 0 and 1 states simultaneously."

Q: "What causes decoherence in quantum computers?"
A: "Environmental noise and interference cause quantum computers to lose their quantum properties."

Return ONLY a JSON array: [{"q":"question","a":"answer"},...]

Material:
${text}`;
}
async function generateCardsWithOpenAI(source: string, count = DEFAULT_CARD_COUNT) {
  if (!process.env.RUNPOD_API_KEY) {
    console.warn("[Cards] RunPod API key not configured, using fallback");
    return null;
  }
  
  console.log("[Cards] Generating cards from source text length:", source.length);
  console.log("[Cards] First 200 chars of source:", source.slice(0, 200));
  console.log("[Cards] Requesting", count, "cards with max_tokens:", OPENAI_MAX_OUTPUT_TOKENS);
  
  const messages = [
    { role: "system" as const, content: "You are an expert tutor creating educational flashcards. Return only valid JSON with no additional text." }, 
    { role: "user" as const, content: buildFlashcardPrompt(source, count) }
  ];

  // Lower temperature to reduce non-JSON chatter.
  const content = await callLLM(messages, OPENAI_MAX_OUTPUT_TOKENS, 0.2);
  
  if (!content) {
    console.warn("[Cards] Using fallback cards due to API failure");
    return null;
  }
  
  const cleanedContent = stripFence(content);
  console.log("[Cards] RunPod returned", cleanedContent.length, "chars of response");
  
  try {
    let jsonText = cleanedContent;
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
      .filter((c) => c.question && c.answer)
      .map((c) => ({ question: c.question.slice(0, 500), answer: c.answer.slice(0, 2000) }));
    if (mapped.length === 0) {
      console.warn("[Cards] RunPod returned empty card array, using fallback");
      return null;
    }
    console.log("[Cards] Successfully parsed", mapped.length, "AI-generated flashcards");
    return mapped;
  } catch (e) { 
    console.error("[Cards] Failed to parse RunPod JSON response:", (e as any)?.message);
    console.error("[Cards] Invalid response content:", cleanedContent.slice(0, 500));
    console.warn("[Cards] Using fallback cards due to parse error");
    return null; 
  }
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
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(new URL("/sign-in", req.url));

    // In production we should not silently fall back if RunPod isn't configured.
    if (process.env.NODE_ENV === "production") {
      const missingRunpod = !process.env.RUNPOD_ENDPOINT || !process.env.RUNPOD_API_KEY;
      if (missingRunpod) {
        return NextResponse.json(
          {
            error: "RunPod is not configured on the server. Set RUNPOD_ENDPOINT and RUNPOD_API_KEY in Vercel environment variables.",
            code: "RUNPOD_NOT_CONFIGURED",
          },
          { status: 500 }
        );
      }
    }

    const form = await req.formData();
    
    // Enforce per-user daily deck creation limit
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const createdToday = await prisma.deck.count({
        where: { user: { clerkUserId: userId }, createdAt: { gte: startOfDay } },
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
  const file = form.get("file") as File | null;
  const video = form.get("video") as File | null;
  const subtitle = form.get("subtitle") as File | null;
    const audioFile = form.get("audio") as File | null;
  const videoUrl = getLast("videoUrl").trim();
  const videoName = getLast("videoName").trim();
    
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
    if (!source && !urlStr && !file && !video && !audioFile && !subtitle) {
      return NextResponse.json(
        { error: "Please provide content through text, URL, PDF, PPTX, video, or audio", code: "NO_CONTENT" },
        { status: 400 }
      );
    }

    // Origin tracking
    let origin: "text" | "url" | "youtube" | "video" | "pdf" | "pptx" | "unknown" = "unknown";

    // 0) Video file - extract audio server-side and transcribe
    if (!source && (video || videoUrl)) {
      try {
        const isRemote = !!videoUrl && !video;
        const videoSize = video?.size || 0;
        console.log("[Video] Processing", isRemote ? "remote video URL" : "uploaded video file", isRemote ? videoUrl : video!.name, "size:", videoSize);
        
        // Validate OPENAI_API_KEY before attempting expensive processing
        if (!process.env.OPENAI_API_KEY) {
          throw new Error("OpenAI API key not configured. Cannot transcribe video.");
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
          // Use system ffmpeg
          const bin = "ffmpeg";
          console.log("[Video] Using system ffmpeg");
          
          const ffmpeg = spawn(bin, [
            "-i", isRemote ? videoUrl : videoPath,
            "-vn",              // no video
            "-ac", "1",         // mono
            "-ar", "16000",     // 16 kHz
            "-b:a", "32k",      // 32 kbps
            "-y",
            audioPath
          ]);
          
          let stderr = "";
          ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
          
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
        console.log("[Video] Audio extracted:", audioBuffer.length, "bytes. Sending to OpenAI Whisper...");
        
        // OpenAI Whisper has a 25MB file size limit for audio
        if (audioBuffer.length > 25 * 1024 * 1024) {
          throw new Error("Extracted audio exceeds 25MB limit for Whisper API. Try a shorter video or use YouTube URL with captions.");
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
          try {
            const yt = await extractFromYouTubeStrict(u);
            source = truncate(yt.text); origin = "youtube";
          } catch (e: any) {
            if (STRICT_VIDEO) return NextResponse.json({ error: e?.message || "Failed to read YouTube captions.", code: "YT_NO_CAPTIONS" }, { status: 400 });
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

    // 5) fallback (always produce something)
    let title = formTitle;
    if (!source) {
      const hint = formTitle || docName || urlStr || "untitled";
      source = `Topic: ${hint}. No content was extracted, so create generic study prompts about the topic.`;
      origin = "unknown";
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
    const aiCards = await generateCardsWithOpenAI(source, cardCount);
    const cards = aiCards ?? (() => {
      console.warn("[Cards] ⚠️ USING FALLBACK CARDS - AI generation failed or unavailable");
      return fallbackCards(source).map((c) => ({ question: c.question, answer: c.answer }));
    })();

    // Ensure user
    const userRow = await prisma.user.upsert({
      where: { clerkUserId: userId }, update: {}, create: { clerkUserId: userId },
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
