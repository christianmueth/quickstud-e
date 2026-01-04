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

type RunpodAsrMode = "runsync" | "run";

function parseModeFromEndpoint(endpoint: string): RunpodAsrMode | null {
  const p = endpoint.replace(/\/+$/, "");
  if (p.endsWith("/runsync")) return "runsync";
  if (p.endsWith("/run")) return "run";
  return null;
}

function buildRunpodAsrUrls(): { mode: RunpodAsrMode; runUrl: string; statusBaseUrl: string } | null {
  const explicit = (process.env.RUNPOD_ASR_ENDPOINT || "").trim();
  const endpointId = (process.env.RUNPOD_ASR_ENDPOINT_ID || "").trim();
  if (!explicit && !endpointId) return null;

  const useRunEnv = process.env.RUNPOD_ASR_USE_RUN === "1";

  if (explicit) {
    const normalized = explicit.replace(/\/+$/, "");
    const mode = parseModeFromEndpoint(normalized) ?? (useRunEnv ? "run" : "runsync");
    if (mode === "run") {
      const runUrl = normalized.endsWith("/run") ? normalized : `${normalized}/run`;
      const statusBaseUrl = runUrl.replace(/\/+run$/, "");
      return { mode, runUrl, statusBaseUrl };
    }
    const runUrl = normalized.endsWith("/runsync") ? normalized : `${normalized}/runsync`;
    const statusBaseUrl = runUrl.replace(/\/+runsync$/, "");
    return { mode, runUrl, statusBaseUrl };
  }

  const mode: RunpodAsrMode = useRunEnv ? "run" : "runsync";
  const base = `https://api.runpod.ai/v2/${endpointId}`;
  return { mode, runUrl: `${base}/${mode}`, statusBaseUrl: base };
}

function buildRunpodStatusUrl(statusBaseUrl: string, jobId: string): string {
  const base = statusBaseUrl.replace(/\/+$/, "");
  return `${base}/status/${encodeURIComponent(jobId)}`;
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
  const urls = buildRunpodAsrUrls();
  const auth = getAuthHeader();
  if (!urls || !auth) {
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

    async function parseJsonOrText(res: Response): Promise<any> {
      try {
        return await res.json();
      } catch {
        return await res.text().catch(() => null);
      }
    }

    async function runsyncCall(runsyncUrl: string): Promise<ASRResult> {
      const rpRes = await fetchWithTimeout(
        runsyncUrl,
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

      const data = await parseJsonOrText(rpRes);
      if (!loggedRunpodASRKeys && data && typeof data === "object") {
        loggedRunpodASRKeys = true;
        const topKeys = Object.keys(data || {});
        const outputKeys = data?.output && typeof data.output === "object" ? Object.keys(data.output) : [];
        console.log("[ASR] RunPod response keys:", topKeys);
        console.log("[ASR] RunPod output keys:", outputKeys);
      }

      const id = (typeof (data as any)?.id === "string" && (data as any).id) || (typeof (data as any)?.output?.id === "string" && (data as any).output.id) || undefined;

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

      if ((data as any)?.Error) {
        return {
          ok: false,
          code: "RUNPOD_ERROR",
          message: String((data as any).Error) + (id ? ` id=${id}` : ""),
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
    }

    async function runAndPoll(runUrl: string, statusBaseUrl: string): Promise<ASRResult> {
      const startedAt = Date.now();
      const pollMs = Math.max(250, Number(process.env.RUNPOD_ASR_POLL_MS || 1500));

      const submitResp = await fetchWithTimeout(
        runUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: auth,
          },
          body: JSON.stringify(payload),
        },
        Math.min(timeoutMs, 30_000)
      );

      const submitData = await parseJsonOrText(submitResp);
      if (!submitResp.ok) {
        return {
          ok: false,
          code: "HTTP_ERROR",
          message: `RunPod ASR /run failed (HTTP ${submitResp.status})`,
          status: submitResp.status,
          raw: redactSecrets(submitData),
        };
      }

      const jobId = String((submitData as any)?.id || (submitData as any)?.jobId || "").trim();
      if (!jobId) {
        return {
          ok: false,
          code: "BAD_OUTPUT",
          message: "RunPod ASR /run did not return a job id",
          raw: redactSecrets(submitData),
        };
      }

      while (true) {
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) {
          return {
            ok: false,
            code: "TIMEOUT",
            message: "RunPod ASR job timed out",
            id: jobId,
          };
        }

        const statusUrl = buildRunpodStatusUrl(statusBaseUrl, jobId);
        const statusResp = await fetchWithTimeout(
          statusUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: auth,
            },
          },
          Math.min(remaining, 30_000)
        );

        const statusData = await parseJsonOrText(statusResp);
        if (!statusResp.ok) {
          return {
            ok: false,
            code: "HTTP_ERROR",
            message: `RunPod ASR /status failed (HTTP ${statusResp.status})`,
            status: statusResp.status,
            id: jobId,
            raw: redactSecrets(statusData),
          };
        }

        const st = String((statusData as any)?.status || (statusData as any)?.state || "").toUpperCase();
        if (st === "COMPLETED") {
          if ((statusData as any)?.Error) {
            return {
              ok: false,
              code: "RUNPOD_ERROR",
              message: String((statusData as any).Error),
              id: jobId,
              raw: redactSecrets(statusData),
            };
          }

          const outRoot = (statusData as any)?.output ?? (statusData as any)?.outputs ?? statusData;
          const { transcript, segments, detectedLanguage } = extractASROutput({ output: outRoot, ...statusData });
          if (!transcript) {
            return {
              ok: false,
              code: "BAD_OUTPUT",
              message: "RunPod ASR job completed but returned no transcript",
              id: jobId,
              raw: redactSecrets(statusData),
            };
          }

          return { ok: true, transcript, segments, detectedLanguage, raw: statusData };
        }

        if (st === "FAILED" || st === "CANCELLED") {
          return {
            ok: false,
            code: "RUNPOD_ERROR",
            message: `RunPod ASR job ${st}`,
            id: jobId,
            raw: redactSecrets(statusData),
          };
        }

        await new Promise((r) => setTimeout(r, pollMs));
      }
    }

    // Prefer configured mode, but fall back if the endpoint doesn't support it.
    if (urls.mode === "run") {
      const primary = await runAndPoll(urls.runUrl, urls.statusBaseUrl);
      if (!primary.ok && primary.code === "HTTP_ERROR" && primary.status === 404) {
        const altRunsyncUrl = `${urls.statusBaseUrl.replace(/\/+$/, "")}/runsync`;
        return await runsyncCall(altRunsyncUrl);
      }
      return primary;
    }

    const primary = await runsyncCall(urls.runUrl);
    if (!primary.ok && primary.code === "HTTP_ERROR" && primary.status === 404) {
      const altRunUrl = `${urls.statusBaseUrl.replace(/\/+$/, "")}/run`;
      return await runAndPoll(altRunUrl, urls.statusBaseUrl);
    }
    return primary;
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
