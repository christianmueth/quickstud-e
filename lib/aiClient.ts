/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Client for text generation using RunPod serverless endpoint with DeepSeek vLLM
 * This replaces OpenAI for text generation while keeping Whisper for audio transcription
 */

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Calls the RunPod serverless endpoint with DeepSeek vLLM model
 * @param messages - Array of chat messages in OpenAI format
 * @param maxTokens - Maximum tokens to generate (optional, defaults to 4000)
 * @returns The generated text content or null on error
 */
export async function callLLM(
  messages: Message[],
  maxTokens = 4000
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
          temperature: 0.7,
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[aiClient] RunPod API error: ${resp.status} ${errorText}`);
      return null;
    }

    const data = await resp.json();
    
    // RunPod response format: data.output.choices[0].message.content or data.output
    const content = 
      data.output?.choices?.[0]?.message?.content || 
      data.output;

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
