/* eslint-disable @typescript-eslint/no-explicit-any */

export type YoutubeAsrWorkerFailureReason = "NOT_CONFIGURED" | "HTTP_ERROR" | "TIMEOUT" | "INVALID_RESPONSE" | "EXCEPTION";

export type YoutubeAsrWorkerResult =
  | { ok: true; transcript: string; raw?: unknown }
  | { ok: false; reason: YoutubeAsrWorkerFailureReason; message: string; httpStatus?: number; raw?: unknown };

function cleanText(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
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

function getWorkerConfig(): { url: string; key?: string; timeoutMs: number } | null {
  const url = (process.env.YT_ASR_WORKER_URL || "").trim();
  if (!url) return null;
  const key = (process.env.YT_ASR_WORKER_KEY || "").trim() || undefined;
  const timeoutMs = Math.max(10_000, Number(process.env.YT_ASR_WORKER_TIMEOUT_MS || 180_000));
  return { url, key, timeoutMs };
}

export async function transcribeYoutubeViaAsrWorker(
  youtubeUrl: string,
  options?: { language?: string }
): Promise<YoutubeAsrWorkerResult> {
  const cfg = getWorkerConfig();
  if (!cfg) {
    return { ok: false, reason: "NOT_CONFIGURED", message: "Missing YT_ASR_WORKER_URL" };
  }

  const body = {
    youtubeUrl,
    language: options?.language || "en",
  };

  try {
    const resp = await fetchWithTimeout(
      cfg.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
        },
        body: JSON.stringify(body),
      },
      cfg.timeoutMs
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
        message: `YT_ASR_WORKER_URL returned HTTP ${status}`,
        httpStatus: status,
        raw,
      };
    }

    const transcript = cleanText((raw as any)?.transcript);
    if (!transcript) {
      return {
        ok: false,
        reason: "INVALID_RESPONSE",
        message: "YT_ASR_WORKER_URL returned no transcript",
        raw,
      };
    }

    return { ok: true, transcript, raw };
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "TIMEOUT" : "EXCEPTION",
      message: String(e?.message || e || "Unknown error"),
    };
  }
}
