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

type RunpodYoutubeMode = "runsync" | "run";

function parseModeFromEndpoint(endpoint: string): RunpodYoutubeMode | null {
  const p = endpoint.replace(/\/+$/, "");
  if (p.endsWith("/runsync")) return "runsync";
  if (p.endsWith("/run")) return "run";
  return null;
}

function buildRunpodYoutubeUrls(): { mode: RunpodYoutubeMode; runUrl: string; statusBaseUrl: string } | null {
  const explicit = (process.env.RUNPOD_YOUTUBE_ENDPOINT || "").trim();
  const endpointId = (process.env.RUNPOD_YOUTUBE_ENDPOINT_ID || "").trim();

  if (!explicit && !endpointId) return null;

  const useRunEnv = process.env.RUNPOD_YOUTUBE_USE_RUN === "1";

  if (explicit) {
    const mode = parseModeFromEndpoint(explicit) ?? (useRunEnv ? "run" : "runsync");
    const normalized = explicit.replace(/\/+$/, "");
    if (mode === "run") {
      // If someone provided the base /v2/<id> URL, append /run.
      const runUrl = normalized.endsWith("/run") ? normalized : `${normalized}/run`;
      const statusBaseUrl = runUrl.replace(/\/run$/, "");
      return { mode, runUrl, statusBaseUrl };
    }

    // runsync
    const runUrl = normalized.endsWith("/runsync") ? normalized : `${normalized}/runsync`;
    const statusBaseUrl = runUrl.replace(/\/runsync$/, "");
    return { mode, runUrl, statusBaseUrl };
  }

  const mode: RunpodYoutubeMode = useRunEnv ? "run" : "runsync";
  const base = `https://api.runpod.ai/v2/${endpointId}`;
  return { mode, runUrl: `${base}/${mode}`, statusBaseUrl: base };
}

function buildRunpodStatusUrl(statusBaseUrl: string, jobId: string): string {
  const base = statusBaseUrl.replace(/\/+$/, "");
  return `${base}/status/${encodeURIComponent(jobId)}`;
}

function extractTranscriptFromRunpodOutput(output: any): string | null {
  const root = Array.isArray(output) ? output?.[0] : output;
  const candidates = [
    root?.transcript,
    root?.transcription,
    root?.text,
    root?.output_text,
    // Common nested shapes
    root?.result?.transcript,
    root?.result?.transcription,
    root?.result?.text,
    root?.data?.transcript,
    root?.data?.text,
    root?.result,
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
  const urls = buildRunpodYoutubeUrls();
  const apiKey = (process.env.RUNPOD_YOUTUBE_API_KEY || process.env.RUNPOD_API_KEY || "").trim();

  if (!urls || !apiKey) {
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
  const body = { input: { youtubeUrl } };

  try {
    const startedAt = Date.now();

    // Async (/run + /status/<id>) is more mechanically reliable under queueing than /runsync.
    if (urls.mode === "run") {
      const submitResp = await fetchWithTimeout(
        urls.runUrl,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        Math.min(timeoutMs, 30_000)
      );

      const submitStatus = submitResp.status;
      const submitRaw = await submitResp
        .json()
        .catch(async () => ({ _nonJson: await submitResp.text().catch(() => "") }))
        .catch(() => null);

      if (!submitResp.ok) {
        return {
          ok: false,
          reason: "HTTP_ERROR",
          message: `RunPod YouTube /run returned HTTP ${submitStatus}`,
          httpStatus: submitStatus,
          raw: submitRaw,
        };
      }

      const jobId = String((submitRaw as any)?.id || (submitRaw as any)?.jobId || "").trim();
      if (!jobId) {
        return {
          ok: false,
          reason: "EMPTY_OUTPUT",
          message: "RunPod YouTube /run did not return a job id",
          raw: submitRaw,
        };
      }

      while (true) {
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) {
          return { ok: false, reason: "TIMEOUT", message: `RunPod YouTube job timed out after ${timeoutMs}ms`, id: jobId };
        }

        const statusUrl = buildRunpodStatusUrl(urls.statusBaseUrl, jobId);
        const statusResp = await fetchWithTimeout(
          statusUrl,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
          },
          Math.min(remaining, 30_000)
        );

        const httpStatus = statusResp.status;
        const raw = await statusResp
          .json()
          .catch(async () => ({ _nonJson: await statusResp.text().catch(() => "") }))
          .catch(() => null);

        if (!statusResp.ok) {
          return {
            ok: false,
            reason: "HTTP_ERROR",
            message: `RunPod YouTube /status returned HTTP ${httpStatus}`,
            httpStatus,
            id: jobId,
            raw,
          };
        }

        const st = String((raw as any)?.status || (raw as any)?.state || "").toUpperCase();
        if (st === "COMPLETED") {
          const out = (raw as any)?.output ?? (raw as any)?.outputs ?? (raw as any);
          const transcript = extractTranscriptFromRunpodOutput(out);
          if (transcript) {
            return { ok: true, transcript, id: jobId, raw: out };
          }
          return {
            ok: false,
            reason: "EMPTY_OUTPUT",
            message: "RunPod YouTube job completed but returned no transcript",
            id: jobId,
            raw,
          };
        }

        if (st === "FAILED" || st === "CANCELLED") {
          return {
            ok: false,
            reason: "HTTP_ERROR",
            message: `RunPod YouTube job ${st}`,
            id: jobId,
            raw,
          };
        }

        await sleep(pollMs);
      }
    }

    while (true) {
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { ok: false, reason: "TIMEOUT", message: `RunPod YouTube job timed out after ${timeoutMs}ms` };
      }

      const resp = await fetchWithTimeout(
        urls.runUrl,
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
