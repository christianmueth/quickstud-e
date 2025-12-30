import { auth } from "@clerk/nextjs/server";
import { callLLMResult } from "@/lib/aiClient";

export type ChatV1Role = "system" | "user" | "assistant";

export type ChatV1Message = {
  role: ChatV1Role;
  content: string;
};

export type ChatV1StructuredOutput =
  | {
      type: "json_schema";
      schema: unknown;
      name?: string;
    }
  | {
      type: "none";
    };

export type ChatV1Request = {
  model?: string;
  messages: ChatV1Message[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  structured_output?: ChatV1StructuredOutput;
};

export type ChatV1Response = {
  id: string;
  model: string;
  provider: "runpod-vllm";
  output_text: string;
  output_json?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function safeJsonParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractBalancedJsonArray(text: string): string | null {
  const s = String(text || "");
  const start = s.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }

  return null;
}

function bestEffortExtractJson(outputText: string): unknown | undefined {
  const direct = safeJsonParse(outputText.trim());
  if (direct !== undefined) return direct;

  const arr = extractBalancedJsonArray(outputText);
  if (!arr) return undefined;
  return safeJsonParse(arr);
}

export async function chatV1(req: ChatV1Request): Promise<ChatV1Response> {
  const { userId } = await auth();
  if (!userId) {
    const err: any = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const model = req.model || process.env.RUNPOD_MODEL || "deepseek-r1";
  const maxTokens = typeof req.max_output_tokens === "number" ? req.max_output_tokens : 1200;
  const temperature = typeof req.temperature === "number" ? req.temperature : 0.7;

  const structured = req.structured_output;

  const result = await callLLMResult(
    req.messages,
    maxTokens,
    temperature,
    {
      topP: typeof req.top_p === "number" ? req.top_p : undefined,
      stop: Array.isArray(req.stop) ? req.stop : undefined,
      guidedJson: structured?.type === "json_schema" ? structured.schema : undefined,
      responseFormat:
        structured?.type === "json_schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: structured.name || "output",
                schema: structured.schema,
              },
            }
          : undefined,
    }
  );

  if (!result.ok) {
    const err: any = new Error(result.message || "LLM call failed");
    err.code = result.reason;
    err.httpStatus = result.httpStatus;
    err.jobId = result.jobId;
    err.lastStatus = result.lastStatus;
    throw err;
  }

  const outputText = result.content;

  const outputJson =
    structured?.type === "json_schema" ? bestEffortExtractJson(outputText) : undefined;

  return {
    id: result.jobId || `req_${Date.now()}`,
    model,
    provider: "runpod-vllm",
    output_text: outputText,
    ...(outputJson !== undefined ? { output_json: outputJson } : {}),
  };
}
