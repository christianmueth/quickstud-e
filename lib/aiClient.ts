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

function stripThinkBlocks(text: string): string {
  // DeepSeek-style reasoning blocks can break JSON parsing downstream.
  // Remove <think>...</think> and also any stray closing tags.
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<\/think>\s*/gi, "")
    .trim();
}

function extractTextFromRunpodOutput(output: any): string | null {
  const root = Array.isArray(output) ? output?.[0] : output;

  const tokens: unknown = root?.choices?.[0]?.tokens;
  if (Array.isArray(tokens)) {
    const raw = tokens.map((t) => (typeof t === "string" ? t : "")).join("");
    const cleaned = stripThinkBlocks(raw);
    return cleaned || null;
  }

  const maybeText =
    root?.choices?.[0]?.message?.content ??
    root?.choices?.[0]?.text ??
    root?.output_text ??
    root?.generated_text ??
    root;

  if (typeof maybeText === "string") {
    const cleaned = stripThinkBlocks(maybeText);
    return cleaned || null;
  }

  const coerced = coerceToString(maybeText);
  if (!coerced) return null;
  const cleaned = stripThinkBlocks(coerced);
  return cleaned || null;
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

export type CallLLMOptions = {
  topP?: number;
  stop?: string[];
  guidedJson?: unknown;
  responseFormat?: unknown;
  extraBody?: Record<string, unknown>;
};

function buildRunpodOpenAICompatChatUrl(endpoint: string): string | null {
  // RunPod vLLM workers typically expose an OpenAI-compatible server at:
  // https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1/chat/completions
  try {
    const url = new URL(endpoint);
    const parts = url.pathname.split("/").filter(Boolean);
    // Expect: ["v2", "<id>", "run"] or ["v2", "<id>", "runsync"]
    if (parts.length >= 2 && parts[0] === "v2") {
      const endpointId = parts[1];
      url.pathname = `/v2/${endpointId}/openai/v1/chat/completions`;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Calls the RunPod serverless endpoint with DeepSeek vLLM model
 * @param messages - Array of chat messages in OpenAI format
 * @param maxTokens - Maximum tokens to generate (optional, defaults to 4000)
 * @returns The generated text content or null on error
 */
export async function callLLMResult(
  messages: Message[],
  maxTokens = 4000,
  temperature = 0.7,
  options?: CallLLMOptions
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
  const useOpenAICompat = process.env.RUNPOD_OPENAI_COMPAT === "1";

  try {
    console.log(
      `[aiClient] Calling RunPod ${isAsyncRun ? "/run" : "/runsync"} at ${safeEndpointLabel(endpoint)} (model=${model})`
    );
    console.log(`[aiClient] RunPod key fingerprint: ${apiKeyFp}`);

    if (useOpenAICompat) {
      const chatUrl = buildRunpodOpenAICompatChatUrl(endpoint);
      if (!chatUrl) {
        console.warn("[aiClient] RUNPOD_OPENAI_COMPAT=1 but could not derive OpenAI-compatible URL from RUNPOD_ENDPOINT; falling back");
      } else {
        console.log(`[aiClient] Using OpenAI-compatible endpoint: ${safeEndpointLabel(chatUrl)}`);

        // vLLM OpenAI-compatible: allow structured output via response_format / json_schema.
        const responseFormat =
          options?.responseFormat ??
          (options?.guidedJson
            ? {
                type: "json_schema",
                json_schema: {
                  name: "flashcards",
                  schema: options.guidedJson,
                },
              }
            : undefined);

        const extraBody: Record<string, unknown> = {
          ...(options?.extraBody || {}),
        };

        // Some servers accept guided decoding controls only via an extra body.
        if (options?.guidedJson != null && extraBody.guided_json == null) extraBody.guided_json = options.guidedJson;
        if (process.env.RUNPOD_GUIDED_DECODING_BACKEND && extraBody.guided_decoding_backend == null) {
          extraBody.guided_decoding_backend = process.env.RUNPOD_GUIDED_DECODING_BACKEND;
        }

        const body = JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          ...(typeof options?.topP === "number" ? { top_p: options.topP } : {}),
          ...(Array.isArray(options?.stop) && options.stop.length ? { stop: options.stop } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...(Object.keys(extraBody).length ? { extra_body: extraBody } : {}),
        });

        const resp = await fetch(chatUrl, {
          method: "POST",
          headers: {
            Authorization: bearerAuthHeaderValue,
            "Content-Type": "application/json",
          },
          body,
        });

        if (resp.ok) {
          const data = await resp.json();
          const content = extractTextFromRunpodOutput(data);
          if (!content) return { ok: false, reason: "EMPTY_OUTPUT" };
          console.log(`[aiClient] Generated ${content.length} characters (openai-compat)`);
          return { ok: true, content };
        }

        // If the template doesn't support the OpenAI-compatible server, fall back to /run.
        const errorText = await resp.text().catch(() => "");
        console.warn(
          `[aiClient] OpenAI-compatible call failed (${resp.status}); falling back to /run. Body: ${String(errorText || "").slice(0, 300)}`
        );
      }
    }

    const input: any = {
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
    };

    if (typeof options?.topP === "number") input.top_p = options.topP;
    if (Array.isArray(options?.stop) && options!.stop!.length > 0) input.stop = options!.stop;

    // Some vLLM servers support JSON-schema/grammar guidance via a `guided_json` field.
    // This is optional and template-dependent; leave it unset unless the caller explicitly passes it.
    // Prefer passing raw JSON (object/array) rather than a stringified schema.
    if (options?.guidedJson != null) {
      input.guided_json = options.guidedJson;
    }

    if (options?.responseFormat != null) {
      input.response_format = options.responseFormat;
    }

    if (options?.extraBody && Object.keys(options.extraBody).length) {
      input.extra_body = options.extraBody;
    }

    const body = JSON.stringify({ input });

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

      const content = extractTextFromRunpodOutput(resolved?.output);
      if (!content) {
        console.error("[aiClient] Empty response from RunPod");
        return { ok: false, reason: "EMPTY_OUTPUT", jobId: String(jobId) };
      }

      console.log(`[aiClient] Generated ${content.length} characters`);
      return { ok: true, content, jobId: String(jobId) };
    }

    const content = extractTextFromRunpodOutput(resolved?.output);
    if (!content) {
      console.error("[aiClient] Empty response from RunPod");
      return { ok: false, reason: "EMPTY_OUTPUT" };
    }

    console.log(`[aiClient] Generated ${content.length} characters`);
    return { ok: true, content };
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
