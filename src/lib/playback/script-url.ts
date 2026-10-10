/** Player endpoints like `player.php?type=..&id=..&ext=mp4` may return video, HLS, an HTML player or an error. */
export function isScriptEndpoint(url: string): boolean {
  try { return /\.(php|aspx?|jsp|cgi)$/i.test(new URL(url).pathname); } catch { return false; }
}

export type ProbeKind = "video" | "hls" | "html" | "auth" | "blocked" | "error";
export type ProbeResult = { kind: ProbeKind; status: number | null; contentType: string | null; embeddable: boolean; playUrl: string | null; message: string | null };

/** Classifies the endpoint's actual response; never treats HTML as a video file. */
export function classifyResponse(r: { status: number; contentType: string | null; xfo: string | null; csp: string | null; body: string; finalUrl: string; originalUrl: string }): ProbeResult {
  const ct = (r.contentType ?? "").toLowerCase();
  const base = { status: r.status, contentType: r.contentType };
  if (r.status === 401 || r.status === 407) return { ...base, kind: "auth", embeddable: false, playUrl: null, message: "O servidor do vídeo exige autorização." };
  if (r.status === 403 || /website access blocked|access denied/i.test(r.body)) return { ...base, kind: "blocked", embeddable: false, playUrl: null, message: "O servidor do vídeo bloqueou o acesso (HTTP " + r.status + ")." };
  if (r.status >= 400) return { ...base, kind: "error", embeddable: false, playUrl: null, message: `O servidor do vídeo respondeu com erro HTTP ${r.status}.` };
  const head = r.body.trimStart();
  // Media keeps the stored URL unchanged (the browser follows redirects itself).
  if (/mpegurl/.test(ct) || head.startsWith("#EXTM3U")) return { ...base, kind: "hls", embeddable: false, playUrl: r.originalUrl, message: null };
  if (/^(video|audio)\//.test(ct) || ct === "application/octet-stream" && !/^\s*</.test(head)) return { ...base, kind: "video", embeddable: false, playUrl: r.originalUrl, message: null };
  if (/html/.test(ct) || /^<(!doctype|html)/i.test(head)) {
    const xfo = (r.xfo ?? "").toLowerCase();
    const fa = /frame-ancestors([^;]*)/i.exec(r.csp ?? "")?.[1]?.trim() ?? null;
    const embeddable = !/deny|sameorigin/.test(xfo) && !(fa != null && /'none'|'self'/.test(fa) && !fa.includes("*"));
    // An HTTP page that redirected to HTTPS is used via its confirmed HTTPS address (iframes over HTTP are blocked on HTTPS sites).
    const playUrl = r.originalUrl.startsWith("https:") ? r.originalUrl : r.finalUrl.startsWith("https:") ? r.finalUrl : null;
    if (!embeddable) return { ...base, kind: "html", embeddable, playUrl: null, message: "O provedor não permite exibir este player dentro de outro site." };
    if (!playUrl) return { ...base, kind: "html", embeddable, playUrl: null, message: "O player do provedor só está disponível por HTTP; o site seguro não pode exibi-lo (conteúdo misto)." };
    return { ...base, kind: "html", embeddable, playUrl, message: null };
  }
  return { ...base, kind: "error", embeddable: false, playUrl: null, message: `Formato de resposta não reconhecido (${r.contentType ?? "sem tipo"}).` };
}
