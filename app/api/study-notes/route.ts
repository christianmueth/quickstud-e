/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { callLLM } from "@/lib/aiClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini";
const MAX_SOURCE_CHARS = 30_000;

function cleanText(s: string) { return s.replace(/\s+/g, " ").trim(); }
function truncate(s: string, max = MAX_SOURCE_CHARS) { return s.length > max ? s.slice(0, max) : s; }

async function generateStudyNotesWithOpenAI(source: string): Promise<string | null> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    console.error("[StudyNotes] RUNPOD_API_KEY missing");
    return null;
  }
  
  const systemPrompt = `You are an expert study assistant. Given educational content, create comprehensive study notes that include:

1. **Overview**: A brief summary of the main topic and its importance
2. **Key Concepts**: Core ideas explained clearly with context
3. **Critical Points**: The most important takeaways that students must understand (mark these with ⚠️)
4. **Main Topics**: Organized breakdown of major themes or sections
5. **Examples & Applications**: Real-world applications or examples if mentioned
6. **Study Tips**: Recommended focus areas and connections between concepts

Format the output in clean Markdown with:
- Clear headings (##, ###)
- Bullet points for lists
- Bold text for emphasis
- Use ⚠️ emoji for critical/must-know points

Make the notes comprehensive yet concise, suitable for review and exam prep.`;

  const userPrompt = `Create detailed study notes and overview for the following content:\n\n${truncate(source)}`;

  try {
    console.log("[StudyNotes] Calling RunPod API...");
    
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt }
    ];
    
    const content = await callLLM(messages, 4000);
    
    if (!content) {
      console.error("[StudyNotes] Empty response from RunPod");
      return null;
    }

    console.log(`[StudyNotes] Generated ${content.length} characters of notes`);
    return content.trim();
  } catch (err: any) {
    console.error("[StudyNotes] RunPod error:", err.message);
    return null;
  }
}

async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    console.log("[StudyNotes/PDF] Starting extraction, buffer size:", buf.length);
    const data = await pdfParse(buf, { max: 0 });
    
    if (!data?.text) {
      console.error("[StudyNotes/PDF] No text content found");
      return "";
    }
    
    const text = cleanText(data.text);
    console.log("[StudyNotes/PDF] Extracted", text.length, "characters");
    return text;
  } catch (error) {
    console.error("[StudyNotes/PDF] Error extracting text:", error);
    return "";
  }
}

async function extractPptxTextFromBuffer(buf: Buffer): Promise<string> {
  try {
    console.log("[StudyNotes/PPTX] Starting extraction, buffer size:", buf.length);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    
    const slideFiles = Object.keys(zip.files)
      .filter((p) => p.startsWith("ppt/slides/slide") && p.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });
    
    console.log("[StudyNotes/PPTX] Found", slideFiles.length, "slides");
    if (slideFiles.length === 0) return "";
    
    const chunks: string[] = [];
    for (const p of slideFiles) {
      const xml = await zip.files[p].async("string");
      const slideText = (xml.match(/<a:t>([^<]*)<\/a:t>/g) || [])
        .map(match => match.replace(/<a:t>|<\/a:t>/g, ""))
        .filter(text => text.trim().length > 0)
        .join(" ");
      if (slideText.trim()) {
        chunks.push(`[Slide ${chunks.length + 1}] ${cleanText(slideText)}`);
      }
    }
    
    const fullText = chunks.join("\n\n");
    console.log("[StudyNotes/PPTX] Extracted", fullText.length, "characters");
    return fullText;
  } catch (error) {
    console.error("[StudyNotes/PPTX] Error extracting text:", error);
    return "";
  }
}

async function extractTextFromSource(fd: FormData): Promise<{ text: string; title: string; source: string }> {
  let text = "";
  let title = (fd.get("title") as string) || "Study Notes";
  let source = "unknown";

  // Handle different content types
  const urlStr = fd.get("url") as string;
  const textContent = fd.get("source") as string;
  const file = fd.get("file") as File | null;

  if (textContent) {
    text = truncate(cleanText(textContent));
    source = "text";
  } else if (file) {
    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    
    if (fileName.endsWith(".pdf")) {
      text = await extractPdfTextFromBuffer(buffer);
      source = "pdf";
    } else if (fileName.endsWith(".pptx")) {
      text = await extractPptxTextFromBuffer(buffer);
      source = "pptx";
    }
    text = truncate(text);
  } else if (urlStr) {
    // For URLs, try to extract content (simplified - you could enhance this)
    try {
      const response = await fetch(urlStr);
      const html = await response.text();
      // Basic text extraction from HTML
      const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      text = truncate(textOnly);
      source = "url";
    } catch (err) {
      console.error("[StudyNotes] URL fetch error:", err);
      text = `Content from URL: ${urlStr}`;
    }
  }

  if (!text) {
    throw new Error("No content provided");
  }

  return { text, title, source };
}

export async function POST(req: Request) {
  try {
    const authResult = await auth();
    if (!authResult.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // In production we should not silently fail if RunPod isn't configured.
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

    const fd = await req.formData();
    
    // Extract content
    const { text, title, source } = await extractTextFromSource(fd);
    console.log(`[StudyNotes] Generating notes for: ${title} (source: ${source}, ${text.length} chars)`);

    // Generate study notes
    const notes = await generateStudyNotesWithOpenAI(text);
    
    if (!notes) {
      return NextResponse.json(
        { error: "Failed to generate study notes" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      notes,
      title,
      source
    });

  } catch (error: any) {
    console.error("[StudyNotes] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate study notes" },
      { status: 500 }
    );
  }
}
