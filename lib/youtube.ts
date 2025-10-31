// Robust extractor for youtu.be and youtube.com/* variants
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);

    // Handle youtu.be/<id>
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).trim();
      return id ? id : null;
    }

    // Handle youtube.com/watch?v=<id> (ignore playlist/time/etc.)
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // Shorts sometimes appear as /shorts/<id>
      const m = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
      if (m?.[1]) return m[1];
    }

    // Fallback: try generic 11-char pattern
    const m = url.match(/([a-zA-Z0-9_-]{11})/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export type OEmbed =
  | { title?: string; author_name?: string; thumbnail_url?: string }
  | {};

export async function fetchYouTubeOEmbed(url: string): Promise<OEmbed> {
  // https://www.youtube.com/oembed?url=<video-url>&format=json
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("format", "json");
    const res = await fetch(endpoint.toString());
    if (!res.ok) return {};
    return (await res.json()) as OEmbed;
  } catch {
    return {};
  }
}