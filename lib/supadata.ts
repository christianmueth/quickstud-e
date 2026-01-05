export type SupadataTranscriptSuccess = {
  ok: true;
  transcript: string;
  lang?: string;
  availableLangs?: string[];
  raw: unknown;
};

export type SupadataTranscriptFailure = {
  ok: false;
  reason: "NOT_CONFIGURED" | "HTTP_ERROR" | "INVALID_RESPONSE" | "EXCEPTION";
  message: string;
  httpStatus?: number;
  raw?: unknown;
};

export type SupadataTranscriptResult = SupadataTranscriptSuccess | SupadataTranscriptFailure;

export function hasSupadataConfigured(): boolean {
  return !!(process.env.SUPADATA_API_KEY || "").trim();
}

export function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

export async function fetchSupadataTranscript(args: {
  youtubeUrl: string;
  language?: string;
}): Promise<SupadataTranscriptResult> {
  const apiKey = (process.env.SUPADATA_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "Missing env var: SUPADATA_API_KEY",
    };
  }

  try {
    const u = new URL("https://api.supadata.ai/v1/transcript");
    u.searchParams.set("url", args.youtubeUrl);
    u.searchParams.set("text", "true");
    u.searchParams.set("mode", "auto");
    if (args.language) u.searchParams.set("lang", String(args.language));

    const r = await fetch(u.toString(), {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return {
        ok: false,
        reason: "HTTP_ERROR",
        message: `Supadata failed (HTTP ${r.status})`,
        httpStatus: r.status,
        raw: data,
      };
    }

    const transcript = typeof (data as any)?.content === "string" ? (data as any).content : "";
    if (!transcript.trim()) {
      return {
        ok: false,
        reason: "INVALID_RESPONSE",
        message: "Transcript missing in Supadata response",
        raw: data,
      };
    }

    return {
      ok: true,
      transcript,
      lang: typeof (data as any)?.lang === "string" ? (data as any).lang : undefined,
      availableLangs: Array.isArray((data as any)?.availableLangs)
        ? (data as any).availableLangs.filter((x: any) => typeof x === "string")
        : undefined,
      raw: data,
    };
  } catch (e: any) {
    return {
      ok: false,
      reason: "EXCEPTION",
      message: String(e?.message || e || "SUPADATA_EXCEPTION"),
      raw: e,
    };
  }
}
