export type YouTubeParse =
  | { ok: true; videoId: string; canonicalUrl: string }
  | { ok: false; reason: string };

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function normalizeHost(hostname: string): string {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

export function parseYouTube(input: string): YouTubeParse {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, reason: "Empty input" };

  // Allow passing videoId directly
  if (YT_ID_RE.test(raw)) {
    return { ok: true, videoId: raw, canonicalUrl: `https://www.youtube.com/watch?v=${raw}` };
  }

  let url: URL;
  try {
    // tolerate missing scheme
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: "Not a valid URL or video id" };
  }

  const host = normalizeHost(url.hostname);
  const path = url.pathname || "";
  let id: string | null = null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const maybe = path.split("/").filter(Boolean)[0] || "";
    if (YT_ID_RE.test(maybe)) id = maybe;
  }

  // youtube.com/watch?v=<id>
  if (
    !id &&
    (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com")
  ) {
    if (path === "/watch") {
      const v = url.searchParams.get("v") || "";
      if (YT_ID_RE.test(v)) id = v;
    }

    // /shorts/<id>
    if (!id && path.startsWith("/shorts/")) {
      const maybe = path.split("/")[2] || "";
      if (YT_ID_RE.test(maybe)) id = maybe;
    }

    // /embed/<id>
    if (!id && path.startsWith("/embed/")) {
      const maybe = path.split("/")[2] || "";
      if (YT_ID_RE.test(maybe)) id = maybe;
    }
  }

  // Fallback: sometimes v exists even on odd hosts/paths
  if (!id) {
    const v = url.searchParams.get("v") || "";
    if (YT_ID_RE.test(v)) id = v;
  }

  if (!id) return { ok: false, reason: "Could not extract YouTube video id" };
  return { ok: true, videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
}

// Back-compat: keep the prior helper, now stricter.
export function extractYouTubeId(url: string): string | null {
  const parsed = parseYouTube(url);
  return parsed.ok ? parsed.videoId : null;
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