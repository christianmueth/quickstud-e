/* eslint-disable @typescript-eslint/no-explicit-any */

export type RunpodYoutubeFailureReason = "NOT_CONFIGURED" | "HTTP_ERROR" | "TIMEOUT" | "EMPTY_OUTPUT" | "EXCEPTION";

export type RunpodYoutubeResult =
  | { ok: true; transcript: string; id?: string; raw?: unknown }
  | {
      ok: false;
      reason: RunpodYoutubeFailureReason;
      message: string;
      httpStatus?: number;
      id?: string;
      raw?: unknown;
    };

function cleanText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function buildRunpodRunsyncUrl(): string | null {
  const explicit = (process.env.RUNPOD_YOUTUBE_ENDPOINT || "").trim();
  if (explicit) return explicit;

  const id = (process.env.RUNPOD_YOUTUBE_ENDPOINT_ID || "").trim();
  if (!id) return null;
  return `https://api.runpod.ai/v2/${id}/runsync`;
}

function extractTranscriptFromRunpodOutput(output: any): string | null {
  const root = Array.isArray(output) ? output?.[0] : output;
  const candidates = [
    root?.transcript,
    root?.transcription,
    root?.text,
    root?.output_text,
    root?.result,
    root?.data?.transcript,
    root?.data?.text,
    root,
  ];

  for (const c of candidates) {
    if (typeof c === "string") {
      const cleaned = cleanText(c);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

export async function transcribeYoutubeUrlWithRunpod(
  youtubeUrl: string,
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<RunpodYoutubeResult> {
  const endpoint = buildRunpodRunsyncUrl();
  const apiKey = (process.env.RUNPOD_YOUTUBE_API_KEY || process.env.RUNPOD_API_KEY || "").trim();

  if (!endpoint || !apiKey) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "Missing RUNPOD_YOUTUBE_ENDPOINT(_ID) or RUNPOD_YOUTUBE_API_KEY/RUNPOD_API_KEY",
    };
  }

  const timeoutMs = Math.max(15_000, Number(options?.timeoutMs ?? process.env.RUNPOD_YOUTUBE_TIMEOUT_MS ?? 120_000));
  const pollMs = Math.max(250, Number(options?.pollMs ?? process.env.RUNPOD_YOUTUBE_POLL_MS ?? 1500));

  const authHeader = apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;

  // Expected worker contract (you implement on RunPod):
  // input: { youtubeUrl: "https://..." }
  // output: { transcript: string } (or { text/transcription/... })
  const body = {
    input: {
      youtubeUrl,
    },
  };

  try {
    const startedAt = Date.now();

    while (true) {
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { ok: false, reason: "TIMEOUT", message: `RunPod YouTube job timed out after ${timeoutMs}ms` };
      }

      const resp = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        Math.min(remaining, 30_000)
      );

      const status = resp.status;
      const raw = await resp
        .json()
        .catch(async () => ({ _nonJson: await resp.text().catch(() => "") }))
        .catch(() => null);

      if (!resp.ok) {
        return {
          ok: false,
          reason: "HTTP_ERROR",
          message: `RunPod YouTube endpoint returned HTTP ${status}`,
          httpStatus: status,
          raw,
        };
      }

      const out = (raw as any)?.output ?? (raw as any)?.outputs ?? (raw as any);
      const transcript = extractTranscriptFromRunpodOutput(out);
      if (transcript) {
        return { ok: true, transcript, id: (raw as any)?.id ?? (raw as any)?.jobId ?? undefined, raw: out };
      }

      // Some workers might return { status: "IN_QUEUE" } even on runsync-style endpoints.
      const st = String((raw as any)?.status || (raw as any)?.state || "").toUpperCase();
      if (st.includes("QUEUE") || st.includes("IN_QUEUE") || st.includes("IN_PROGRESS") || st.includes("RUNNING")) {
        await sleep(pollMs);
        continue;
      }

      return {
        ok: false,
        reason: "EMPTY_OUTPUT",
        message: "RunPod YouTube endpoint returned no transcript",
        raw,
      };
    }
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "TIMEOUT" : "EXCEPTION",
      message: String(e?.message || e || "Unknown error"),
    };
  }
}
