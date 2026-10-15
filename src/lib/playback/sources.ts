/** Normalize the JSON returned by get_playback_sources without modifying provider URLs. */
export type PlaybackSource = {
  id: string;
  url: string;
  type: "url" | "embed" | "hls";
  label: string | null;
};

type RawSource = Record<string, unknown>;

function isRecord(value: unknown): value is RawSource {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPlaybackUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Supports the public RPC's array response and wrapped { sources: [...] } response.
 * The database table calls this field source_type; older RPC payloads may alias it to type.
 */
export function normalizePlaybackSources(data: unknown): PlaybackSource[] {
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sources)
      ? data.sources
      : [];

  return rows.flatMap((value): PlaybackSource[] => {
    if (!isRecord(value) || !validPlaybackUrl(value.url) || typeof value.id !== "string" || !value.id) return [];
    const rawType = typeof value.type === "string" ? value.type : value.source_type;
    const typeText = typeof rawType === "string" ? rawType.toLowerCase() : "";
    const type: PlaybackSource["type"] =
      typeText === "embed" || typeText === "iframe"
        ? "embed"
        : typeText === "hls" || typeText === "m3u8" || /\.m3u8(?:$|\?)/i.test(value.url)
          ? "hls"
          : "url";
    return [{
      id: value.id,
      url: value.url,
      type,
      label: typeof value.label === "string" ? value.label : null,
    }];
  });
}
