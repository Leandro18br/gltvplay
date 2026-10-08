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
export function normalizeEmbed(input: string, policy: EmbedPolicy): string {
  let value = z.string().trim().min(1, "Informe a fonte").max(8192).parse(input);
  if (value.startsWith("<")) {
    if (!policy.allowIframe) throw new Error("Código iframe desabilitado; informe uma URL autorizada");
    const fragment = parseFragment(value);
    const nodes = fragment.childNodes.filter(n => n.nodeName !== "#text" || ("value" in n && n.value.trim() !== ""));
    const frame = nodes[0];
    if (nodes.length !== 1 || !frame || !("tagName" in frame) || frame.tagName !== "iframe") throw new Error("Insira somente um iframe, sem outros elementos");
    if (frame.childNodes.some(n => n.nodeName !== "#text" || ("value" in n && n.value.trim() !== ""))) throw new Error("Conteúdo interno do iframe não permitido");
    const allowed = new Set(["src","title","width","height","allow","allowfullscreen","frameborder","loading","referrerpolicy","sandbox","style","class"]);
    if (frame.attrs.some(a => !allowed.has(a.name))) throw new Error("Atributos não permitidos no iframe");
    value = frame.attrs.find(a => a.name === "src")?.value ?? "";
  }
  const url = new URL(z.string().max(2048).parse(value));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || /[\s<>]/.test(value)) throw new Error("Use uma URL HTTPS sem credenciais ou portas personalizadas");
  domainSchema.parse(host);
  if (!policy.domains.includes(host)) throw new Error(`Domínio não autorizado: ${host}`);
  url.hash = "";
  return url.href;
}
export function normalizePlayback(value: PlaybackValue, policy: EmbedPolicy): string | null {
  const v = playbackSchema.parse(value);
  if (v.type === "none") return null;
  if (v.type === "embed") return normalizeEmbed(v.input, policy);
  const url = new URL(z.string().trim().min(1,"Informe a URL de reprodução").max(2048).parse(v.input));
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("URL de reprodução inválida");
  return url.href;
}