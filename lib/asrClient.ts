/* eslint-disable @typescript-eslint/no-explicit-any */

export type ASRResult =
  | { ok: true; transcript: string; segments?: unknown; detectedLanguage?: string; raw?: unknown }
  | {
      ok: false;
      code: "NOT_CONFIGURED" | "HTTP_ERROR" | "RUNPOD_ERROR" | "BAD_OUTPUT" | "TIMEOUT" | "EXCEPTION";
      message: string;
      status?: number;
      id?: string;
      raw?: unknown;
    };

let loggedRunpodASRKeys = false;

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

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/api[-_]?key|token|authorization|bearer|secret/i.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSecrets(v, depth + 1);
    }
  }
  return out;
}

function extractASROutput(data: any): { transcript: string; segments?: unknown; detectedLanguage?: string } {
  const out = data?.output;
  const transcript =
    (typeof out?.transcription === "string" && out.transcription) ||
    (typeof out?.text === "string" && out.text) ||
    (typeof data?.transcription === "string" && data.transcription) ||
    "";

  const segments = out?.segments;
  const detectedLanguage =
    (typeof out?.detected_language === "string" && out.detected_language) ||
    (typeof out?.detectedLanguage === "string" && out.detectedLanguage) ||
    undefined;

  return {
    transcript: String(transcript || "").trim(),
    segments,
    detectedLanguage,
  };
}

/**
 * Calls a RunPod ASR (Whisper-like) endpoint that accepts: { input: { audio: "<url>" } }
 * and returns { output: { transcription: "..." } }
 */
export async function transcribeAudioUrlWithRunpod(
  audioUrl: string,
  opts?: { timeoutMs?: number } & Record<string, unknown>
): Promise<ASRResult> {
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
    const configuredTimeout = Number(process.env.RUNPOD_ASR_TIMEOUT_MS || 90_000);
    const requestedTimeout = Number((opts as any)?.timeoutMs ?? configuredTimeout);
    // RunPod cold starts can be slow; allow 60–120s.
    const timeoutMs = Math.max(60_000, Math.min(120_000, requestedTimeout || 90_000));

    const inputOpts: Record<string, unknown> = { ...(opts || {}) };
    delete (inputOpts as any).timeoutMs;

    const payload: any = {
      input: {
        audio: audioUrl,
        ...inputOpts,
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

    if (!loggedRunpodASRKeys && data && typeof data === "object") {
      loggedRunpodASRKeys = true;
      const topKeys = Object.keys(data || {});
      const outputKeys = data?.output && typeof data.output === "object" ? Object.keys(data.output) : [];
      console.log("[ASR] RunPod response keys:", topKeys);
      console.log("[ASR] RunPod output keys:", outputKeys);
    }

    const id = (typeof data?.id === "string" && data.id) || (typeof data?.output?.id === "string" && data.output.id) || undefined;

    if (!rpRes.ok) {
      return {
        ok: false,
        code: "HTTP_ERROR",
        message: `RunPod ASR request failed (HTTP ${rpRes.status})${id ? ` id=${id}` : ""}`,
        status: rpRes.status,
        id,
        raw: redactSecrets(data),
      };
    }

    if (data?.Error) {
      return {
        ok: false,
        code: "RUNPOD_ERROR",
        message: String(data.Error) + (id ? ` id=${id}` : ""),
        id,
        raw: redactSecrets(data),
      };
    }

    const { transcript, segments, detectedLanguage } = extractASROutput(data);
    if (!transcript) {
      return {
        ok: false,
        code: "BAD_OUTPUT",
        message: "RunPod ASR returned no transcript in expected fields (output.transcription, output.text, transcription).",
        id,
        raw: redactSecrets(data),
      };
    }

    return { ok: true, transcript, segments, detectedLanguage, raw: data };
  } catch (e: any) {
    return {
      ok: false,
      code: e?.name === "AbortError" ? "TIMEOUT" : "EXCEPTION",
      message:
        e?.name === "AbortError"
          ? "RunPod ASR request timed out (AbortController)"
          : String(e?.message || e),
    };
  }
}
