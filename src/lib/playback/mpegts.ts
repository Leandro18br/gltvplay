/** Direct MPEG-TS (".ts") stream detection and browser playback via mpegts.js (MSE). */
export function isMpegTsUrl(url: string): boolean {
  try { return /\.ts$/i.test(new URL(url).pathname); } catch { return /\.ts(\?|$)/i.test(url); }
}

export function mpegTsErrorMessage(url: string, detail?: string): string {
  if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http:"))
    return "Esta transmissão usa HTTP e o navegador bloqueia conteúdo HTTP em páginas seguras (HTTPS). O provedor precisa oferecer HTTPS.";
  if (detail === "codec") return "O navegador não suporta o codec de áudio ou vídeo desta transmissão.";
  if (detail === "unsupported") return "Seu navegador não suporta reprodução de transmissões MPEG-TS.";
  return "Não foi possível ler a transmissão. O servidor pode estar indisponível, exigir autenticação ou bloquear o acesso pelo navegador (CORS).";
}

/** Attaches a live MPEG-TS stream to the element; returns a cleanup that destroys the player. URL is used unchanged. */
export function attachMpegTs(el: HTMLVideoElement, url: string, live: boolean, onError: (message: string) => void): () => void {
  let cancelled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let player: any = null;
  import("mpegts.js").then(({ default: mpegts }) => {
    if (cancelled) return;
    if (!mpegts.isSupported()) { onError(mpegTsErrorMessage(url, "unsupported")); return; }
    player = mpegts.createPlayer({ type: "mpegts", isLive: live, url }, { enableWorker: true, liveBufferLatencyChasing: live, lazyLoad: !live });
    player.attachMediaElement(el);
    player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
      onError(mpegTsErrorMessage(url, type === mpegts.ErrorTypes.MEDIA_ERROR && /Codec|Format/i.test(detail) ? "codec" : undefined));
    });
    player.load();
    const p = player.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }).catch(() => onError(mpegTsErrorMessage(url, "unsupported")));
  return () => {
    cancelled = true;
    if (player) { try { player.pause(); player.unload(); player.detachMediaElement(); player.destroy(); } catch { /* already released */ } player = null; }
  };
}

/** True when the page is HTTPS and the source is HTTP (browser blocks it as mixed content). */
export function isMixedContent(url: string): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:" && /^http:\/\//i.test(url);
}

/**
 * For HTTP sources on an HTTPS page, probes the HTTPS variant once (8s, CORS, body aborted after headers).
 * Returns the HTTPS URL only if it answers 2xx without redirecting back to HTTP; the stored URL is never changed.
 * Returns null when no working HTTPS alternative exists.
 */
export async function resolveSecureUrl(url: string): Promise<string | null> {
  if (!isMixedContent(url)) return url;
  const candidate = url.replace(/^http:\/\/([^/?#:]+)(?::80)?(?=[/?#]|$)/i, "https://$1");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(candidate, { mode: "cors", redirect: "follow", signal: ctrl.signal, cache: "no-store" });
    ctrl.abort();
    return r.ok && r.url.startsWith("https:") ? candidate : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export const MIXED_CONTENT_MESSAGE = "Esta transmissão usa HTTP e o servidor não oferece uma versão HTTPS funcional. Para assistir neste site seguro, o provedor precisa oferecer HTTPS ou é necessária uma retransmissão HTTPS autorizada.";
