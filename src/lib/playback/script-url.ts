/** Player endpoints like `player.php?type=..&id=..&ext=mp4` may return video, HLS, an HTML player or an error. */
/** BugouMods VIP player.php must be embedded directly: server-side probes can be blocked by the provider even when its browser player works. */
export function isDirectEmbedEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.toLowerCase() === "cinema.bugoumods.com" && /\.php$/i.test(u.pathname);
  } catch { return false; }
}

export function isScriptEndpoint(url: string): boolean {
  try { return /\.(php|aspx?|jsp|cgi)$/i.test(new URL(url).pathname); } catch { return false; }
}

/** A provider /play/ page is not a media file merely because its fragment says .mp4.
 * Keep existing file/stream paths and BugouMods browser endpoints on their original path. */
export function needsResourceProbe(url: string): boolean {
  if (isDirectEmbedEndpoint(url)) return false;
  try {
    const u = new URL(url);
    return isScriptEndpoint(url) || (u.protocol === "https:" && /\/play\//i.test(u.pathname) && !/\.(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd|ts)$/i.test(u.pathname));
  } catch { return false; }
}

/** Browser frame-ancestors checks are origin-specific, not a substring heuristic. */
export function frameAllowed(xfo: string | null, csp: string | null, pageUrl: string, appOrigin?: string): boolean {
  const origin = new URL(pageUrl).origin;
  if (/deny/i.test(xfo ?? "")) return false;
  if (/sameorigin/i.test(xfo ?? "") && origin !== appOrigin) return false;
  const policies = (csp ?? "").split(",");
  return policies.every(policy => {
    const directive = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(policy)?.[1];
    if (!directive) return true;
    return directive.trim().split(/\s+/).some(source => {
      if (source === "*") return true;
      if (source === "'self'") return origin === appOrigin;
      if (source === "'none'" || !appOrigin) return false;
      const app = new URL(appOrigin);
      if (source === `${app.protocol}`) return true;
      try {
        const pattern = new URL(source.includes("://") ? source : `${new URL(pageUrl).protocol}//${source}`);
        const host = pattern.hostname;
        return pattern.protocol === app.protocol && pattern.port === app.port && (host === app.hostname || host.startsWith("*.") && app.hostname.endsWith(host.slice(1)));
      } catch { return false; }
    });
  });
}

export type ProbeKind = "video" | "hls" | "html" | "auth" | "blocked" | "error";
export type ProbeResult = { kind: ProbeKind; status: number | null; contentType: string | null; embeddable: boolean; playUrl: string | null; message: string | null };

/** Classifies the endpoint's actual response; never treats HTML as a video file. */
export function classifyResponse(r: { status: number; contentType: string | null; xfo: string | null; csp: string | null; body: string; finalUrl: string; originalUrl: string; appOrigin?: string }): ProbeResult {
  const ct = (r.contentType ?? "").toLowerCase();
  const base = { status: r.status, contentType: r.contentType };
  if (r.status === 401 || r.status === 407) return { ...base, kind: "auth", embeddable: false, playUrl: null, message: "O servidor do vídeo exige autorização." };
  if (r.status === 403 || /website access blocked|access denied/i.test(r.body)) return { ...base, kind: "blocked", embeddable: false, playUrl: null, message: "O servidor do vídeo bloqueou o acesso (HTTP " + r.status + ")." };
  if (r.status >= 400) return { ...base, kind: "error", embeddable: false, playUrl: null, message: `O servidor do vídeo respondeu com erro HTTP ${r.status}.` };
  const head = r.body.trimStart();
  // Media keeps the stored URL unchanged (the browser follows redirects itself).
  if (/mpegurl/.test(ct) || head.startsWith("#EXTM3U")) return { ...base, kind: "hls", embeddable: false, playUrl: r.originalUrl, message: null };
  if (/^(video|audio)\//.test(ct) || ct.split(";")[0] === "application/octet-stream" && !/^\s*</.test(head)) return { ...base, kind: "video", embeddable: false, playUrl: r.originalUrl, message: null };
  if (/html/.test(ct) || /^<(!doctype|html)/i.test(head)) {
    const embeddable = frameAllowed(r.xfo, r.csp, r.finalUrl, r.appOrigin);
    // An HTTP page that redirected to HTTPS is used via its confirmed HTTPS address (iframes over HTTP are blocked on HTTPS sites).
    const playUrl = r.originalUrl.startsWith("https:") ? r.originalUrl : r.finalUrl.startsWith("https:") ? r.finalUrl : null;
    if (!embeddable) return { ...base, kind: "html", embeddable, playUrl: null, message: "O provedor não permite exibir este player dentro de outro site." };
    if (!playUrl) return { ...base, kind: "html", embeddable, playUrl: null, message: "O player do provedor só está disponível por HTTP; o site seguro não pode exibi-lo (conteúdo misto)." };
    return { ...base, kind: "html", embeddable, playUrl, message: null };
  }
  return { ...base, kind: "error", embeddable: false, playUrl: null, message: `Formato de resposta não reconhecido (${r.contentType ?? "sem tipo"}).` };
}
