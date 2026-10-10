import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { playbackSchema, normalizePlayback, isIframeCode } from "./embed";
import { getRequest } from "@tanstack/react-start/server";

export const validatePlayback = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(playbackSchema).handler(async ({context,data}) => {
  const role = await context.supabase.rpc("is_staff",{_user_id:context.userId});
  if (role.error || !role.data) throw new Error("Acesso negado");
  const [domains,settings] = await Promise.all([context.supabase.from("embed_domains").select("hostname"),context.supabase.from("site_settings").select("embed_allow_iframe").eq("id",1).single()]);
  if (domains.error || settings.error) throw new Error("Não foi possível consultar as regras de embed");
  const url=normalizePlayback(data,{domains:domains.data.map(d=>d.hostname),allowIframe:true});
  if((data.type==="embed"||isIframeCode(data.input)) && url && new URL(url).origin===new URL(getRequest().url).origin)throw new Error("Não incorpore a própria plataforma");
  return {url};
});
export const savePlayback = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({kind:z.enum(["movie","episode","channel"]),contentId:z.string().uuid(),value:playbackSchema})).handler(async ({context,data})=>{
  const role=await context.supabase.rpc("is_staff",{_user_id:context.userId});
  if(role.error || !role.data) throw new Error("Acesso negado");
  const [domains,settings]=await Promise.all([context.supabase.from("embed_domains").select("hostname"),context.supabase.from("site_settings").select("embed_allow_iframe").eq("id",1).single()]);
  if(domains.error || settings.error) throw new Error("Não foi possível consultar as regras");
  const url=normalizePlayback(data.value,{domains:domains.data.map(d=>d.hostname),allowIframe:true});
  if((data.value.type==="embed"||isIframeCode(data.value.input)) && url && new URL(url).origin===new URL(getRequest().url).origin)throw new Error("Não incorpore a própria plataforma");
  if(data.value.type==="none") {
    // Only the source shown in this form is turned off; alternative players (e.g. found by an API) stay untouched.
    if(!data.value.id) return {id:null};
    const r=await context.supabase.from("playback_sources").update({is_active:false}).eq("id",data.value.id).eq("content_kind",data.kind).eq("content_id",data.contentId);
    if(r.error) throw new Error("Não foi possível desativar as fontes"); return {id:null};
  }
  if(!url) throw new Error("Fonte inválida");
  const payload={url,source_type:isIframeCode(data.value.input)?"embed":data.value.type,is_active:data.value.active,is_primary:data.value.primary};
  const r=data.value.id ? await context.supabase.from("playback_sources").update(payload).eq("id",data.value.id).eq("content_kind",data.kind).eq("content_id",data.contentId).select("id").single() : await context.supabase.from("playback_sources").insert({...payload,content_kind:data.kind,content_id:data.contentId}).select("id").single();
  if(r.error) throw new Error("Não foi possível salvar a fonte de reprodução");
  if(data.value.primary){const p=await context.supabase.rpc("set_primary_playback",{_source_id:r.data.id});if(p.error)throw new Error("Não foi possível definir a fonte principal");}
  return {id:r.data.id};
});
/** Classifies a player endpoint (e.g. player.php?...) for signed-in viewers. Reads only headers + first bytes; never relays content. */
export const probePlayerUrl = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({url:z.string().url().max(2000)})).handler(async ({data}) => {
  const { classifyResponse, isScriptEndpoint } = await import("./script-url");
  const { isBlockedHost } = await import("@/lib/integrations/engine");
  if (!isScriptEndpoint(data.url)) throw new Error("Endereço não suportado");
  let cur = data.url;
  try {
    for (let hop = 0; hop < 6; hop++) {
      const u = new URL(cur);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || isBlockedHost(u.hostname)) throw new Error("blocked-host");
      const res = await fetch(u.href, { redirect: "manual", headers: { Range: "bytes=0-2047", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); cur = new URL(loc, u).href; continue; }
      let body = "";
      const reader = res.body?.getReader();
      if (reader) { const { value } = await reader.read(); await reader.cancel().catch(() => {}); body = new TextDecoder().decode(value?.slice(0, 2048) ?? new Uint8Array()); }
      return classifyResponse({ status: res.status, contentType: res.headers.get("content-type"), xfo: res.headers.get("x-frame-options"), csp: res.headers.get("content-security-policy"), body, finalUrl: cur, originalUrl: data.url });
    }
    return { kind: "error" as const, status: null, contentType: null, embeddable: false, playUrl: null, message: "Redirecionamentos demais no endereço do player." };
  } catch (e) {
    console.error("probePlayerUrl", e);
    return { kind: "error" as const, status: null, contentType: null, embeddable: false, playUrl: null, message: "Não foi possível conectar ao servidor do player." };
  }
});
