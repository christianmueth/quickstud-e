"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";

export default function CreateForm() {
  const API_BODY_LIMIT = 4 * 1024 * 1024; // ~4MB body limit for serverless; larger videos will be uploaded to Blob
  const [pending, setPending] = useState(false);
  const [contentType, setContentType] = useState<
    "url" | "text" | "pdf" | "subtitle" | "video"
  >("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [videoName, setVideoName] = useState("");
  const [cardCount, setCardCount] = useState(20); // Default 20 cards
  const [generationMode, setGenerationMode] = useState<"flashcards" | "notes">("flashcards");

  // Refs to clear file inputs programmatically
  const urlRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null); // pdf/pptx
  const subtitleRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  function removeHidden(form: HTMLFormElement, name: string) {
    form.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`).forEach((el) => el.remove());
  }

  const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB limit for PDF/PPTX

  async function uploadViaBlob(file: File, kind: "doc" | "video" | "audio") {
    const safeName = (file.name || `${kind}.bin`).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const pathname = `uploads/${kind}/${Date.now()}-${safeName}`;
    return upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/blob-upload",
      multipart: file.size > 10 * 1024 * 1024,
    });
  }

  function looksLikeAudioFile(file: File) {
    const t = (file.type || "").toLowerCase();
    if (t.startsWith("audio/")) return true;
    const nm = (file.name || "").toLowerCase();
    return nm.endsWith(".mp3") || nm.endsWith(".m4a") || nm.endsWith(".wav") || nm.endsWith(".ogg") || nm.endsWith(".webm");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;

    const form = e.currentTarget;

    setPending(true);

    try {
      // Check file sizes for PDF/PPTX only (videos can be any size via Blob upload)
      const fileInput = form.querySelector<HTMLInputElement>('input[name="file"]');
      const pdfOrPptx = fileInput?.files?.[0];
      if (pdfOrPptx && pdfOrPptx.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(pdfOrPptx.size / 1024 / 1024).toFixed(1)}MB). Please keep files under 200MB.`);
      }

      // Clear stale hidden fields from older attempts
      ["videoUrl", "videoName", "videoSize", "docUrl", "docName"].forEach((n) => removeHidden(form, n));

      // Build FormData fresh with only the active content type's file input
      const original = new FormData(form);
      const fd = new FormData();
      for (const [k, v] of original.entries()) {
        // Skip all file inputs - we'll add back only the active one
        if (k === "video" || k === "file" || k === "subtitle") continue;
        fd.append(k, v);
      }
      
      // Add card count to form data
      fd.append("cardCount", String(cardCount));
      
      // Add back only the file input that matches current content type
      if (contentType === "pdf") {
        const f = original.get("file") as File | null;
        if (f && f.size > 0) {
          // Upload docs via direct Blob upload to avoid Vercel request body limits (413)
          const sizeMB = f.size / (1024 * 1024);
          const sizeDisplay = sizeMB >= 1 ? `${sizeMB.toFixed(1)}MB` : `${(f.size / 1024).toFixed(0)}KB`;
          toast.info(`Uploading document (${sizeDisplay})...`);
          try {
            const blob = await uploadViaBlob(f, "doc");
            fd.append("docUrl", blob.url);
            fd.append("docName", f.name || "document");
            toast.success("Document uploaded. Generating...");
          } catch (err: any) {
            console.warn("[Client] Blob doc upload failed:", err?.message || err);
            // If the doc is big, we cannot safely fall back to sending it through the API
            // (it will likely hit Vercel request size limits and 413).
            if (f.size > API_BODY_LIMIT) {
              throw new Error("Document upload failed. Please retry (Blob upload is required for large files).");
            }
            fd.append("file", f);
          }
        }
      } else if (contentType === "subtitle") {
        const s = original.get("subtitle");
        if (s) fd.append("subtitle", s);
      }
      // Video is handled specially below

      // Video/audio handling: upload large files to Blob and send URL instead of raw file
      const videoInput = form.querySelector<HTMLInputElement>('input[name="video"]');
      const videoFile = videoInput?.files?.[0] || (original.get("video") as File | null);
      if (videoFile) {
        const actualSize = videoFile.size;
        const sizeMB = actualSize / (1024 * 1024);
        const sizeKB = actualSize / 1024;
        
        console.log("[Client] Video file detected:", {
          name: videoFile.name,
          type: videoFile.type,
          sizeBytes: actualSize,
          sizeKB: sizeKB.toFixed(2),
          sizeMB: sizeMB.toFixed(2),
          limit: `${(API_BODY_LIMIT / (1024 * 1024)).toFixed(2)}MB`,
          needsBlobUpload: actualSize > API_BODY_LIMIT
        });
        
        const isAudio = looksLikeAudioFile(videoFile);

        // If the user uploads audio (mp3/m4a/etc), prefer the same reliable audioUrl path as the CLI.
        // This avoids the slower video-processing route and avoids any YouTube server-side fetching.
        if (isAudio) {
          const sizeMB = videoFile.size / (1024 * 1024);
          const sizeKB = videoFile.size / 1024;
          const sizeDisplay = sizeMB >= 1 ? `${sizeMB.toFixed(1)}MB` : `${sizeKB.toFixed(0)}KB`;
          toast.info(`Uploading audio (${sizeDisplay})...`);
          const blob = await uploadViaBlob(videoFile, "audio");
          fd.append("audioUrl", blob.url);
          toast.success("Audio uploaded. Transcribing + generating...");
        } else if (actualSize > API_BODY_LIMIT) {
          // Upload to Blob for large videos (direct client upload)
          const sizeMB = videoFile.size / (1024 * 1024);
          const sizeKB = videoFile.size / 1024;
          const sizeDisplay = sizeMB >= 1 
            ? `${sizeMB.toFixed(1)}MB` 
            : `${sizeKB.toFixed(0)}KB`;
          
          console.log("[Client] File size check:", {
            bytes: videoFile.size,
            KB: sizeKB.toFixed(2),
            MB: sizeMB.toFixed(2),
            display: sizeDisplay
          });
          
          toast.info(`Uploading video (${sizeDisplay})...`);

          const blob = await uploadViaBlob(videoFile, "video");

          fd.append("videoUrl", blob.url);
          fd.append("videoName", videoFile.name || "video.mp4");
          toast.success("Video uploaded. Processing may take up to 5 minutes. YouTube URLs are much faster!");
        } else {
          // Small enough to send directly
          console.log("[Client] Video small enough, sending directly in request");
          fd.append("video", videoFile);
          toast.info("Processing video (may take up to 5 minutes)...");
        }
      }

      // Show appropriate processing message based on content type
      if (contentType === "video") {
        // Already shown above for video
      } else if (contentType === "url" && url.includes("youtube.com")) {
        toast.info("Processing YouTube video...");
      } else {
        toast.info("Processing...");
      }

      // Route to the appropriate API based on mode
      const apiEndpoint = generationMode === "flashcards" ? "/api/flashcards" : "/api/study-notes";
      const controller = new AbortController();
      // Vercel functions can run for minutes; still cap client-side waits to avoid “frozen forever”.
      const timeoutMs = 330_000; // 5.5 minutes
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(apiEndpoint, { method: "POST", body: fd, signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) {
        const traceId = res.headers.get("x-quickstud-trace") || null;
        let msg = `Failed to generate (HTTP ${res.status})`;
        let j: any = null;
        try {
          j = await res.json();
          const bodyTrace = j?.traceId ? String(j.traceId) : null;
          const tid = traceId || bodyTrace;
          if (j?.error) msg = `${j.error}${j?.code ? ` [${j.code}]` : ""}${tid ? ` (traceId: ${tid})` : ""}`;
        } catch {}

        const tid = traceId || (j?.traceId ? String(j.traceId) : null);

        // RunPod serverless can queue jobs; when it doesn't start within our route timeout,
        // the API returns a retryable 503 instead of silently creating fallback content.
        if (res.status === 503 && j?.code === "RUNPOD_IN_QUEUE") {
          toast.error(`AI is queued on RunPod (no capacity yet). Please retry in ~30–60 seconds.${tid ? ` (traceId: ${tid})` : ""}`);
          return;
        }

        if (j?.code === "YT_AUDIO_DOWNLOAD_FAILED") {
          toast.error(
            `YouTube blocked server-side audio download. Use Subtitle upload (.srt/.vtt) or upload the video/audio file (mp3/m4a) in the Video tab. For reliable paste-a-link when captions aren’t accessible from Vercel, configure an external ingest worker (YT_ASR_WORKER_URL).${tid ? ` (traceId: ${tid})` : ""}`
          );
          return;
        }

        if (j?.code === "YT_ASR_WORKER_FAILED") {
          toast.error(
            `External YouTube ASR worker failed. Check its logs/config (YT_ASR_WORKER_URL / YT_ASR_WORKER_KEY). As a workaround upload subtitle or audio.${tid ? ` (traceId: ${tid})` : ""}`
          );
          return;
        }

        if (j?.code === "RUNPOD_YOUTUBE_NOT_CONFIGURED") {
          toast.error(
            `Paste-a-link needs the RunPod YouTube worker configured. Set RUNPOD_YOUTUBE_ENDPOINT_ID and RUNPOD_YOUTUBE_API_KEY in Vercel env vars (or reuse RUNPOD_API_KEY).${tid ? ` (traceId: ${tid})` : ""}`
          );
          return;
        }

        if (j?.code === "RUNPOD_YOUTUBE_FAILED") {
          toast.error(
            `RunPod YouTube worker failed. Check the worker logs on RunPod; as a workaround upload audio (mp3/m4a) instead.${tid ? ` (traceId: ${tid})` : ""}`
          );
          return;
        }

        if (res.status === 504) {
          toast.error(`Timed out while generating. Please retry (RunPod can be slow/queued).${tid ? ` (traceId: ${tid})` : ""}`);
          return;
        }

        throw new Error(msg);
      }

      if (generationMode === "notes") {
        // For study notes, show the result in a new window or redirect to a notes viewer
        const data = await res.json();
        if (data.success && data.notes) {
          // Store notes in sessionStorage and redirect to a viewer page
          sessionStorage.setItem("latestStudyNotes", JSON.stringify(data));
          toast.success("Study notes generated!");
          window.location.href = "/app/study-notes/view";
        } else {
          throw new Error("Failed to generate study notes");
        }
      } else {
        // For flashcards, use the existing redirect logic
        const location = res.headers.get("Location");
        if (location) {
          toast.success("Deck created successfully!");
          window.location.href = location;
        } else {
          toast.success("Deck created");
          window.location.reload();
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        toast.error("This is taking too long. Please retry (or try a smaller file / upload audio instead of video). ");
      } else {
        toast.error(err?.message || "Network error");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Generation mode selector */}
      <div>
        <label className="text-sm font-medium">What would you like to generate?</label>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => setGenerationMode("flashcards")}
            className={`flex-1 px-4 py-3 rounded border text-sm font-medium transition-colors ${
              generationMode === "flashcards"
                ? "bg-black text-white border-black"
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
            }`}
          >
            📇 Flashcards
            <p className="text-xs mt-1 opacity-75">Study with spaced repetition</p>
          </button>
          <button
            type="button"
            onClick={() => setGenerationMode("notes")}
            className={`flex-1 px-4 py-3 rounded border text-sm font-medium transition-colors ${
              generationMode === "notes"
                ? "bg-black text-white border-black"
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
            }`}
          >
            📝 Study Notes
            <p className="text-xs mt-1 opacity-75">Overview with critical points</p>
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Title <span className="text-red-500">*</span></label>
        <input 
          name="title" 
          placeholder="My deck" 
          className="w-full border rounded p-2" 
          required 
          minLength={3}
          maxLength={120}
        />
      </div>

      {/* Number of flashcards selector - only show for flashcards mode */}
      {generationMode === "flashcards" && (
        <div>
          <label className="text-sm font-medium">Number of flashcards</label>
          <select
            className="mt-1 w-full border rounded p-2 bg-white"
            value={cardCount}
            onChange={(e) => setCardCount(Number(e.target.value))}
          >
            <option value={10}>10 cards</option>
            <option value={15}>15 cards</option>
            <option value={20}>20 cards (recommended)</option>
            <option value={30}>30 cards</option>
            <option value={50}>50 cards</option>
            <option value={75}>75 cards</option>
            <option value={100}>100 cards (slow)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">More cards = longer generation time and higher cost</p>
        </div>
      )}

      {/* Content type selector */}
      <div>
        <label className="text-sm font-medium">Content type</label>
        <select
          className="mt-1 w-full border rounded p-2 bg-white"
          value={contentType}
          onChange={(e) => {
            const val = e.target.value as typeof contentType;
            setContentType(val);
            // Clear other fields when switching to reduce accidental multi-input
            if (val !== "url") {
              setUrl("");
              if (urlRef.current) urlRef.current.value = "";
            }
            if (val !== "text") {
              setText("");
              if (textRef.current) textRef.current.value = "";
            }
            if (val !== "pdf") {
              if (fileRef.current) fileRef.current.value = "";
              setPdfName("");
            }
            if (val !== "subtitle") {
              if (subtitleRef.current) subtitleRef.current.value = "";
              setSubtitleName("");
            }
            if (val !== "video") {
              if (videoRef.current) videoRef.current.value = "";
              setVideoName("");
            }
          }}
        >
          <option value="url">Website or YouTube URL</option>
          <option value="text">Paste text</option>
          <option value="pdf">Upload PPTX or PDF</option>
          <option value="subtitle">Upload subtitles (SRT/VTT)</option>
          <option value="video">Upload video file</option>
        </select>
      </div>

      {/* URL input */}
      <div className={contentType === "url" ? "" : "hidden"}>
        <label className="text-sm font-medium">Website or YouTube URL</label>
        <div className="flex gap-2 items-stretch">
          <input
            ref={urlRef}
            name="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full border rounded p-2"
          />
          <button
            type="button"
            className="px-3 whitespace-nowrap border rounded"
            onClick={async () => {
              try {
                const clip = await navigator.clipboard.readText();
                if (clip) setUrl(clip.trim());
                else toast.message("Clipboard is empty");
              } catch {
                toast.error("Couldn't read clipboard");
              }
            }}
            title="Paste from clipboard"
          >
            Paste
          </button>
          <button
            type="button"
            className="px-3 whitespace-nowrap border rounded"
            onClick={() => setUrl("https://www.youtube.com/watch?v=yy989li6xgY")}
            title="Use sample YouTube URL"
          >
            Sample
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">If the video has captions but the app doesn't detect them, download/upload the subtitle file (.srt or .vtt) instead.</p>
      </div>

      {/* Text input */}
      <div className={contentType === "text" ? "" : "hidden"}>
        <label className="text-sm font-medium">Paste text</label>
        <div className="space-y-2">
          <textarea
            ref={textRef}
            name="source"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste text here…"
            className="w-full border rounded p-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 border rounded"
              onClick={async () => {
                try {
                  const clip = await navigator.clipboard.readText();
                  if (clip) setText(clip);
                  else toast.message("Clipboard is empty");
                } catch {
                  toast.error("Couldn't read clipboard");
                }
              }}
            >
              Paste
            </button>
            <button
              type="button"
              className="px-3 border rounded"
              onClick={() => setText("")}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* PDF/PPTX */}
      <div className={contentType === "pdf" ? "" : "hidden"}>
        <label className="text-sm font-medium">Upload PPTX or PDF</label>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            id="pdf-input"
            type="file"
            name="file"
            accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              setPdfName(f ? f.name : "");
            }}
          />
          <button
            type="button"
            className="px-3 py-2 border rounded bg-white"
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </button>
          <span
            className="max-w-[50%] inline-flex items-center px-3 py-1 rounded-full border bg-gray-50 text-gray-700 text-xs truncate"
            title={pdfName || "No file chosen"}
            aria-live="polite"
          >
            {pdfName || "No file chosen"}
          </span>
          <button
            type="button"
            className="px-3 py-2 border rounded"
            onClick={() => {
              if (fileRef.current) fileRef.current.value = "";
              setPdfName("");
            }}
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-gray-500">Maximum file size: 200MB. For larger files, please extract and paste the text.</p>
      </div>

      {/* Subtitles */}
      <div className={contentType === "subtitle" ? "" : "hidden"}>
        <label className="text-sm font-medium">Upload subtitle file (SRT/VTT)</label>
        <div className="flex items-center gap-2">
          <input
            ref={subtitleRef}
            id="subtitle-input"
            type="file"
            name="subtitle"
            accept=".srt,.vtt,text/vtt"
            className="hidden"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              setSubtitleName(f ? f.name : "");
            }}
          />
          <button
            type="button"
            className="px-3 py-2 border rounded bg-white"
            onClick={() => subtitleRef.current?.click()}
          >
            Choose file
          </button>
          <span
            className="max-w-[50%] inline-flex items-center px-3 py-1 rounded-full border bg-gray-50 text-gray-700 text-xs truncate"
            title={subtitleName || "No file chosen"}
            aria-live="polite"
          >
            {subtitleName || "No file chosen"}
          </span>
          <button
            type="button"
            className="px-3 py-2 border rounded"
            onClick={() => { if (subtitleRef.current) subtitleRef.current.value = ""; setSubtitleName(""); }}
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Download subtitles from YouTube (⋮ menu → "Show transcript" → copy) or upload .srt/.vtt files here.
        </p>
      </div>

      {/* Video upload (server may disable) */}
      <div className={contentType === "video" ? "" : "hidden"}>
        <label className="text-sm font-medium">Upload video or audio file</label>
        
        {/* Warning banner */}
        <div className="mb-2 border-l-4 border-orange-500 bg-orange-50 p-3 rounded">
          <p className="text-sm font-semibold text-orange-800">⚠️ Uploads are slower and cost the website API credits</p>
          <p className="text-xs text-orange-700 mt-1">
            Processing can take a few minutes. If YouTube URL import is blocked, download the audio (mp3/m4a) and upload it here.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            ref={videoRef}
            id="video-input"
            type="file"
            name="video"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              setVideoName(f ? f.name : "");
            }}
          />
          <button
            type="button"
            className="px-3 py-2 border rounded bg-white"
            onClick={() => videoRef.current?.click()}
          >
            Choose file
          </button>
          <span
            className="max-w-[50%] inline-flex items-center px-3 py-1 rounded-full border bg-gray-50 text-gray-700 text-xs truncate"
            title={videoName || "No file chosen"}
            aria-live="polite"
          >
            {videoName || "No file chosen"}
          </span>
          <button
            type="button"
            className="px-3 py-2 border rounded"
            onClick={() => { if (videoRef.current) videoRef.current.value = ""; setVideoName(""); }}
          >
            Clear
          </button>
        </div>
      </div>

      <button className="px-4 py-2 rounded bg-black text-white disabled:opacity-60" type="submit" disabled={pending}>
        {pending 
          ? "Preparing…" 
          : generationMode === "flashcards" 
            ? "Generate Flashcards" 
            : "Generate Study Notes"}
      </button>
    </form>
  );
}