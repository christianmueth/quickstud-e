/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Client for text generation using RunPod serverless endpoint with DeepSeek vLLM
 * This replaces OpenAI for text generation while keeping Whisper for audio transcription
 */

import { createHash } from "crypto";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

function safeEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

function parseEndpoint(endpoint: string): {
  url: URL | null;
  normalizedPathname: string | null;
} {
  try {
    const url = new URL(endpoint);
    const normalizedPathname = url.pathname.replace(/\/+$/, "");
    return { url, normalizedPathname };
  } catch {
    return { url: null, normalizedPathname: null };
  }
}

function buildRunpodStatusUrl(endpoint: string, jobId: string): string {
  const { url, normalizedPathname } = parseEndpoint(endpoint);
  if (!url || !normalizedPathname) {
    // Best-effort fallback matching prior behavior.
    return endpoint.replace(/\/run\/?($|\?)/, `/status/${jobId}$1`);
  }

  if (!normalizedPathname.endsWith("/run")) {
    return endpoint;
  }

  url.pathname = normalizedPathname.replace(/\/run$/, `/status/${jobId}`);
  // Status endpoints typically do not take the same query params as /run.
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coerceToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;

  // Some providers return a plain object (e.g., { choices: [...] })
  // If we can't find a known text field, avoid returning "[object Object]".
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function fingerprintSecret(value: string): string {
  // Non-reversible fingerprint for debugging env mismatches across deployments.
  // Safe to log (does not reveal the secret).
  try {
    return createHash("sha256").update(value).digest("hex").slice(0, 10);
  } catch {
    return "unknown";
  }
}

export type LLMFailureReason =
  | "NOT_CONFIGURED"
  | "HTTP_ERROR"
  | "STATUS_HTTP_ERROR"
  | "JOB_FAILED"
  | "TIMEOUT"
  | "EMPTY_OUTPUT"
  | "EXCEPTION";

export type CallLLMResult =
  | {
      ok: true;
      content: string;
      jobId?: string;
    }
  | {
      ok: false;
      reason: LLMFailureReason;
      httpStatus?: number;
      jobId?: string;
      lastStatus?: string;
      message?: string;
    };

/**
 * Calls the RunPod serverless endpoint with DeepSeek vLLM model
 * @param messages - Array of chat messages in OpenAI format
 * @param maxTokens - Maximum tokens to generate (optional, defaults to 4000)
 * @returns The generated text content or null on error
 */
export async function callLLMResult(
  messages: Message[],
  maxTokens = 4000,
  temperature = 0.7
): Promise<CallLLMResult> {
  const endpoint = process.env.RUNPOD_ENDPOINT;
  const apiKey = process.env.RUNPOD_API_KEY;
  const model = process.env.RUNPOD_MODEL || "deepseek-r1";

  if (!endpoint || !apiKey) {
    console.error("[aiClient] RUNPOD_ENDPOINT or RUNPOD_API_KEY missing");
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  const rawAuth = apiKey.trim();
  const bearerAuthHeaderValue = rawAuth.toLowerCase().startsWith("bearer ") ? rawAuth : `Bearer ${rawAuth}`;
  const rawAuthHeaderValue = rawAuth.replace(/^bearer\s+/i, "");

  const apiKeyFp = fingerprintSecret(rawAuthHeaderValue);

  const { normalizedPathname } = parseEndpoint(endpoint);
  const isAsyncRun = (normalizedPathname ?? endpoint).replace(/\/+$/, "").endsWith("/run");

  try {
    console.log(
      `[aiClient] Calling RunPod ${isAsyncRun ? "/run" : "/runsync"} at ${safeEndpointLabel(endpoint)} (model=${model})`
    );
    console.log(`[aiClient] RunPod key fingerprint: ${apiKeyFp}`);

    const body = JSON.stringify({
      input: {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature,
      },
    });

    const doPost = async (authorizationValue: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: authorizationValue,
          "Content-Type": "application/json",
        },
        body,
      });

    // RunPod generally expects Bearer auth, but some users paste tokens in different formats.
    // If we get a 401, retry once with the alternate format to rule out header formatting.
    let authUsed = bearerAuthHeaderValue;
    let resp = await doPost(authUsed);
    if (resp.status === 401) {
      const alternate = authUsed === bearerAuthHeaderValue ? rawAuthHeaderValue : bearerAuthHeaderValue;
      console.warn("[aiClient] RunPod returned 401; retrying once with alternate Authorization format");
      authUsed = alternate;
      resp = await doPost(authUsed);
    }

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error(
        `[aiClient] RunPod API error: ${resp.status} ${String(errorText || "").slice(0, 500)}`
      );
      return {
        ok: false,
        reason: "HTTP_ERROR",
        httpStatus: resp.status,
        message: String(errorText || "").slice(0, 500),
      };
    }

    const data = await resp.json();

    // If using /run (async), poll /status/<id> until completion.
    let resolved = data as any;
    if (isAsyncRun) {
      const jobId = resolved?.id;
      if (!jobId) {
        console.error("[aiClient] RunPod /run response missing job id");
        return { ok: false, reason: "HTTP_ERROR", message: "RunPod /run response missing job id" };
      }

      console.log(`[aiClient] RunPod async job started (id=${jobId})`);

      const statusUrl = buildRunpodStatusUrl(endpoint, String(jobId));
      const startedAt = Date.now();
      const timeoutMs = 55_000;
      const intervalMs = 1500;
      let pollCount = 0;
      let lastStatus = "";

      while (Date.now() - startedAt < timeoutMs) {
        pollCount++;
        const statusResp = await fetch(statusUrl, {
          method: "GET",
          headers: { Authorization: authUsed },
        });

        if (!statusResp.ok) {
          const statusText = await statusResp.text().catch(() => "");
          console.error(
            `[aiClient] RunPod status error: ${statusResp.status} ${String(statusText || "").slice(0, 500)}`
          );
          return {
            ok: false,
            reason: "STATUS_HTTP_ERROR",
            httpStatus: statusResp.status,
            jobId: String(jobId),
            message: String(statusText || "").slice(0, 500),
          };
        }

        resolved = await statusResp.json();
        const status = String(resolved?.status || "").toUpperCase();
        lastStatus = status;

        if (pollCount % 5 === 0 && status && status !== "COMPLETED") {
          console.log(
            `[aiClient] RunPod async job status (id=${jobId}, poll=${pollCount}, ms=${Date.now() - startedAt}): ${status}`
          );
        }

        if (status === "COMPLETED") break;
        if (status === "FAILED" || status === "CANCELLED") {
          console.error("[aiClient] RunPod job failed:", coerceToString(resolved?.error) || "unknown error");
          return {
            ok: false,
            reason: "JOB_FAILED",
            jobId: String(jobId),
            lastStatus: status,
            message: coerceToString(resolved?.error) || "unknown error",
          };
        }

        await sleep(intervalMs);
      }

      if (String(resolved?.status || "").toUpperCase() !== "COMPLETED") {
        console.error("[aiClient] RunPod job timed out waiting for completion");
        return {
          ok: false,
          reason: "TIMEOUT",
          jobId: String(jobId),
          lastStatus: lastStatus || String(resolved?.status || ""),
          message: "RunPod job timed out waiting for completion",
        };
      }

      console.log(
        `[aiClient] RunPod async job completed (id=${jobId}, polls=${pollCount}, ms=${Date.now() - startedAt})`
      );
    }

    // RunPod output shapes vary by template. Handle common variants:
    // - data.output.choices[0].message.content (OpenAI-like)
    // - data.output.choices[0].text
    // - data.output (string)
    // - data.output.output_text / generated_text
    const output = resolved?.output;
    const maybeText =
      output?.choices?.[0]?.message?.content ??
      output?.choices?.[0]?.text ??
      output?.output_text ??
      output?.generated_text ??
      output;

    const content = coerceToString(maybeText);
    if (!content) {
      console.error("[aiClient] Empty response from RunPod");
      return { ok: false, reason: "EMPTY_OUTPUT" };
    }

    console.log(`[aiClient] Generated ${content.length} characters`);
    return { ok: true, content, jobId: isAsyncRun ? String((resolved as any)?.id || "") || undefined : undefined };
  } catch (err: any) {
    console.error("[aiClient] RunPod error:", err.message);
    return { ok: false, reason: "EXCEPTION", message: String(err?.message || err) };
  }
}

export async function callLLM(
  messages: Message[],
  maxTokens = 4000,
  temperature = 0.7
): Promise<string | null> {
  const result = await callLLMResult(messages, maxTokens, temperature);
  return result.ok ? result.content : null;
}
