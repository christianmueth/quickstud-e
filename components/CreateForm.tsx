"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

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
      
      // Add back only the file input that matches current content type
      if (contentType === "pdf") {
        const f = original.get("file");
        if (f) fd.append("file", f);
      } else if (contentType === "subtitle") {
        const s = original.get("subtitle");
        if (s) fd.append("subtitle", s);
      }
      // Video is handled specially below

      // Video handling: upload large files to Blob and send URL instead of raw file
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
        
        if (actualSize > API_BODY_LIMIT) {
          // Upload to Blob for large videos (server-side upload)
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
          
          const uploadFormData = new FormData();
          uploadFormData.append("file", videoFile);
          
          console.log("[Client] Sending to blob upload, FormData size:", uploadFormData.has("file"));
          
          const uploadRes = await fetch("/api/blob-upload-url", {
            method: "POST",
            body: uploadFormData
          });
          
          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            throw new Error(errData.error || "Failed to upload video");
          }
          
          const { url } = await uploadRes.json();
          
          fd.append("videoUrl", url);
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

      const res = await fetch("/api/flashcards", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Failed to generate (HTTP ${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = `${j.error}${j?.code ? ` [${j.code}]` : ""}`; } catch {}
        throw new Error(msg);
      }

      const location = res.headers.get("Location");
      if (location) {
        toast.success("Deck created successfully!");
        // Use router.refresh() to update the page data
        window.location.href = location;
      } else {
        toast.success("Deck created");
        window.location.reload(); // Fallback refresh
      }
    } catch (err: any) {
      toast.error(err?.message || "Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        <label className="text-sm font-medium">Upload video file</label>
        
        {/* Warning banner */}
        <div className="mb-2 border-l-4 border-orange-500 bg-orange-50 p-3 rounded">
          <p className="text-sm font-semibold text-orange-800">⚠️ Video uploads are slow and cost the website API credits</p>
          <p className="text-xs text-orange-700 mt-1">
            Processing takes up to 5 minutes. YouTube URLs are instant and free!
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            ref={videoRef}
            id="video-input"
            type="file"
            name="video"
            accept="video/*"
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
        {pending ? "Preparing…" : "Generate Flashcards"}
      </button>
    </form>
  );
}