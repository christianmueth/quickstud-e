/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Client for text generation using the OpenAI Chat Completions API.
 * Audio transcription remains on the separate ASR path.
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
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
  timeoutMs?: number;
  disableOpenAICompat?: boolean;
};

function normalizeOpenAIBaseUrl(baseUrl: string | undefined) {
  const trimmed = String(baseUrl || "https://api.openai.com/v1").trim();
  return trimmed.replace(/\/+$/, "");
}

function extractTextFromOpenAIOutput(output: any): string | null {
  const root = Array.isArray(output) ? output?.[0] : output;
  const content = root?.choices?.[0]?.message?.content ?? root?.choices?.[0]?.text ?? root;

  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") return item.text;
        return "";
      })
      .join("")
      .trim();
    return text || null;
  }

  const coerced = coerceToString(content);
  return coerced?.trim() || null;
}

export async function callLLMResult(
  messages: Message[],
  maxTokens = 4000,
  temperature = 0.7,
  options?: CallLLMOptions
): Promise<CallLLMResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const endpoint = `${normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL)}/chat/completions`;

  if (!apiKey) {
    console.error("[aiClient] OPENAI_API_KEY missing");
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  const authHeaderValue = apiKey.trim().toLowerCase().startsWith("bearer ")
    ? apiKey.trim()
    : `Bearer ${apiKey.trim()}`;
  const apiKeyFp = fingerprintSecret(apiKey.trim().replace(/^bearer\s+/i, ""));
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(1_000, Math.min(300_000, Math.floor(options.timeoutMs)))
      : Math.max(1_000, Math.min(300_000, Number(process.env.OPENAI_TIMEOUT_MS || 90_000)));

  const responseFormat =
    options?.responseFormat ??
    (options?.guidedJson != null
      ? {
          type: "json_schema",
          json_schema: {
            name: "output",
            schema: options.guidedJson,
          },
        }
      : undefined);

  try {
    console.log(`[aiClient] Calling OpenAI chat completions at ${safeEndpointLabel(endpoint)} (model=${model})`);
    console.log(`[aiClient] OpenAI key fingerprint: ${apiKeyFp}`);

    const body = JSON.stringify({
      model,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
      ...(typeof options?.topP === "number" ? { top_p: options.topP } : {}),
      ...(Array.isArray(options?.stop) && options.stop.length > 0 ? { stop: options.stop } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(options?.extraBody || {}),
    });

    const resp = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: authHeaderValue,
          "Content-Type": "application/json",
        },
        body,
      },
      timeoutMs
    );

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error(
        `[aiClient] OpenAI API error: ${resp.status} ${String(errorText || "").slice(0, 500)}`
      );
      return {
        ok: false,
        reason: "HTTP_ERROR",
        httpStatus: resp.status,
        message: String(errorText || "").slice(0, 500),
      };
    }

    const data = await resp.json();
    const content = extractTextFromOpenAIOutput(data);
    if (!content) {
      console.error("[aiClient] Empty response from OpenAI");
      return { ok: false, reason: "EMPTY_OUTPUT" };
    }

    console.log(`[aiClient] Generated ${content.length} characters`);
    return { ok: true, content };
  } catch (err: any) {
    if (String(err?.name || "") === "AbortError") {
      console.error("[aiClient] LLM request timed out (AbortError)");
      return { ok: false, reason: "TIMEOUT", message: "LLM request timed out" };
    }
    console.error("[aiClient] OpenAI error:", err.message);
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
