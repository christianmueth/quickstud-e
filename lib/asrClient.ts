/* eslint-disable @typescript-eslint/no-explicit-any */

export type ASRResult =
  | { ok: true; transcript: string; raw?: unknown }
  | { ok: false; code: "NOT_CONFIGURED" | "HTTP_ERROR" | "RUNPOD_ERROR" | "EXCEPTION"; message: string; raw?: unknown };

function buildRunsyncUrl(): string | null {
  const explicit = process.env.RUNPOD_ASR_ENDPOINT?.trim();
  if (explicit) return explicit;

  const id = process.env.RUNPOD_ASR_ENDPOINT_ID?.trim();
  if (!id) return null;
  return `https://api.runpod.ai/v2/${id}/runsync`;
}

function getAuthHeader(): string | null {
  const key = (process.env.RUNPOD_ASR_API_KEY || process.env.RUNPOD_API_KEY || "").trim();
  if (!key) return null;
  return key.toLowerCase().startsWith("bearer ") ? key : `Bearer ${key}`;
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

function extractTranscript(data: any): string {
  const out = data?.output;
  const t =
    (typeof out?.transcription === "string" && out.transcription) ||
    (typeof out?.text === "string" && out.text) ||
    (typeof out === "string" && out) ||
    "";
  return String(t || "").trim();
}

/**
 * Calls a RunPod ASR (Whisper-like) endpoint that accepts: { input: { audio: "<url>" } }
 * and returns { output: { transcription: "..." } }
 */
export async function transcribeAudioUrlWithRunpod(audioUrl: string, opts?: { timeoutMs?: number; language?: string }): Promise<ASRResult> {
  const url = buildRunsyncUrl();
  const auth = getAuthHeader();
  if (!url || !auth) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Missing RUNPOD_ASR_ENDPOINT(_ID) or RUNPOD_ASR_API_KEY/RUNPOD_API_KEY",
    };
  }

  try {
    const timeoutMs = Math.max(5_000, Math.min(55_000, Number(opts?.timeoutMs || 45_000)));

    const payload: any = {
      input: {
        audio: audioUrl,
        ...(opts?.language ? { language: opts.language } : {}),
      },
    };

    const rpRes = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs
    );

    let data: any = null;
    try {
      data = await rpRes.json();
    } catch {
      data = await rpRes.text().catch(() => null);
    }

    if (!rpRes.ok) {
      return {
        ok: false,
        code: "HTTP_ERROR",
        message: `RunPod ASR request failed (HTTP ${rpRes.status})`,
        raw: data,
      };
    }

    if (data?.Error) {
      return {
        ok: false,
        code: "RUNPOD_ERROR",
        message: String(data.Error),
        raw: data,
      };
    }

    const transcript = extractTranscript(data);
    return { ok: true, transcript, raw: data };
  } catch (e: any) {
    return {
      ok: false,
      code: "EXCEPTION",
      message: e?.name === "AbortError" ? "RunPod ASR request timed out" : String(e?.message || e),
    };
  }
}
