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
    const r=await context.supabase.from("playback_sources").update({is_active:false}).eq("content_kind",data.kind).eq("content_id",data.contentId);
    if(r.error) throw new Error("Não foi possível desativar as fontes"); return {id:null};
  }
  if(!url) throw new Error("Fonte inválida");
  const payload={url,source_type:data.value.type,is_active:data.value.active,is_primary:data.value.primary};
  const r=data.value.id ? await context.supabase.from("playback_sources").update(payload).eq("id",data.value.id).eq("content_kind",data.kind).eq("content_id",data.contentId).select("id").single() : await context.supabase.from("playback_sources").insert({...payload,content_kind:data.kind,content_id:data.contentId}).select("id").single();
  if(r.error) throw new Error("Não foi possível salvar a fonte de reprodução");
  if(data.value.primary){const p=await context.supabase.rpc("set_primary_playback",{_source_id:r.data.id});if(p.error)throw new Error("Não foi possível definir a fonte principal");}
  return {id:r.data.id};
});