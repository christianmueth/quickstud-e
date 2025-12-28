/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Client for text generation using RunPod serverless endpoint with DeepSeek vLLM
 * This replaces OpenAI for text generation while keeping Whisper for audio transcription
 */

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
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

/**
 * Calls the RunPod serverless endpoint with DeepSeek vLLM model
 * @param messages - Array of chat messages in OpenAI format
 * @param maxTokens - Maximum tokens to generate (optional, defaults to 4000)
 * @returns The generated text content or null on error
 */
export async function callLLM(
  messages: Message[],
  maxTokens = 4000,
  temperature = 0.7
): Promise<string | null> {
  const endpoint = process.env.RUNPOD_ENDPOINT;
  const apiKey = process.env.RUNPOD_API_KEY;
  const model = process.env.RUNPOD_MODEL || "deepseek-r1";

  if (!endpoint || !apiKey) {
    console.error("[aiClient] RUNPOD_ENDPOINT or RUNPOD_API_KEY missing");
    return null;
  }

  try {
    console.log(`[aiClient] Calling RunPod endpoint with model: ${model}`);
    
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          model: model,
          messages: messages,
          max_tokens: maxTokens,
          temperature,
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[aiClient] RunPod API error: ${resp.status} ${errorText}`);
      return null;
    }

    const data = await resp.json();

    // RunPod output shapes vary by template. Handle common variants:
    // - data.output.choices[0].message.content (OpenAI-like)
    // - data.output.choices[0].text
    // - data.output (string)
    // - data.output.output_text / generated_text
    const output = data?.output;
    const maybeText =
      output?.choices?.[0]?.message?.content ??
      output?.choices?.[0]?.text ??
      output?.output_text ??
      output?.generated_text ??
      output;

    const content = coerceToString(maybeText);
    if (!content) {
      console.error("[aiClient] Empty response from RunPod");
      return null;
    }

    console.log(`[aiClient] Generated ${content.length} characters`);
    return content;
  } catch (err: any) {
    console.error("[aiClient] RunPod error:", err.message);
    return null;
  }
}
