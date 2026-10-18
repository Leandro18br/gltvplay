import { z } from "zod";
import { parseFragment } from "parse5";

export const domainSchema = z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/, "Informe apenas o domínio, sem protocolo ou caminho").refine(v => !/^[\d.]+$/.test(v) && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(v), "Domínio inválido");
export const playbackSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(["url", "embed", "hls", "none"]),
  input: z.string().trim().max(8192),
  active: z.boolean(),
  primary: z.boolean(),
});
export type PlaybackValue = z.infer<typeof playbackSchema>;
export const emptyPlayback: PlaybackValue = {type:"none",input:"",active:true,primary:true};
export type EmbedPolicy = { domains: string[]; allowIframe: boolean };
/** Exact host or a subdomain of an authorized domain. */
export function embedDomainAllowed(host: string, domains: string[]): boolean {
  return domains.some(d => host === d || host.endsWith(`.${d}`));
}
export function isIframeCode(input: string): boolean { return /^<iframe[\s>]/i.test(input.trim()); }
export function normalizeEmbed(input: string, policy: EmbedPolicy): string {
  let value = z.string().trim().min(1, "Informe a fonte").max(8192).parse(input);
  if (value.startsWith("<")) {
    if (!policy.allowIframe) throw new Error("Código iframe desabilitado; informe uma URL autorizada");
    const fragment = parseFragment(value);
    const nodes = fragment.childNodes.filter(n => n.nodeName !== "#text" || ("value" in n && n.value.trim() !== ""));
    const frame = nodes[0];
    if (nodes.length !== 1 || !frame || !("tagName" in frame) || frame.tagName !== "iframe") throw new Error("Insira somente um iframe, sem outros elementos");
    if (frame.childNodes.some(n => n.nodeName !== "#text" || ("value" in n && n.value.trim() !== ""))) throw new Error("Conteúdo interno do iframe não permitido");
    // Only src is kept; every other attribute (width, allow, frameborder, handlers…) is discarded and the
    // player regenerates its own iframe, so nothing admin-provided runs in the main document.
    if (frame.attrs.some(a => /^on/i.test(a.name) || a.name === "srcdoc")) throw new Error("Atributos não permitidos no iframe");
    value = frame.attrs.find(a => a.name === "src")?.value ?? "";
  }
  const url = new URL(z.string().max(2048).parse(value));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || /[\s<>]/.test(value)) throw new Error("Use uma URL HTTPS sem credenciais ou portas personalizadas");
  domainSchema.parse(host);
  if (!embedDomainAllowed(host, policy.domains)) throw new Error(`Domínio não autorizado: ${host}`);
  // Provider fragments may configure its browser player. They are not sent by HTTP,
  // but must survive validation and iframe rendering unchanged.
  return url.href;
}
/** Best-effort hostname of an embed URL or iframe code, for admin hints only (not a security check). */
export function embedHost(input: string): string | null {
  const raw = input.trim().startsWith("<") ? /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(input)?.[1] ?? "" : input.trim();
  try { const u = new URL(raw); return u.protocol === "https:" ? u.hostname.toLowerCase() : null; } catch { return null; }
}
/** Heuristic: a "Vídeo/URL" value that is a web page rather than a media file. */
export function looksLikePlayerPage(input: string): boolean {
  try { const u = new URL(input.trim()); return !/\.(mp4|m4v|webm|ogv|ogg|mov|m3u8|mpd)$/i.test(u.pathname); } catch { return false; }
}
export function normalizePlayback(value: PlaybackValue, policy: EmbedPolicy): string | null {
  const v = playbackSchema.parse(value);
  if (v.type === "none") return null;
  // Pasted iframe code is always an embed, never a video URL.
  if (v.type === "embed" || isIframeCode(v.input)) return normalizeEmbed(v.input, policy);
  const url = new URL(z.string().trim().min(1,"Informe a URL de reprodução").max(2048).parse(v.input));
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("URL de reprodução inválida");
  return url.href;
}