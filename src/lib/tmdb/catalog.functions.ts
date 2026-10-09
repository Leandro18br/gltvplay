/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff, tmdbGet, movieMeta, resolveCompletion, applyCompletion } from "./tmdb.functions";
import { CATALOG_YEAR, CATALOG_BATCH_SIZE, yearSegment, splitSegment, inCatalogYear, type DateSegment } from "./catalog-batch";

function checked<T extends {error: any; data: any}>(r: T): NonNullable<T["data"]> { if(r.error) throw new Error("Não foi possível salvar o lote do catálogo."); return r.data; }
async function report(ctx: any, job: any) {
  const totals = checked(await ctx.supabase.rpc("tmdb_catalog_report",{_job:job.id}));
  const errors = checked(await ctx.supabase.from("tmdb_catalog_job_items").select("item_key,error,outcome").eq("job_id",job.id).or("state.eq.error,outcome.eq.ambiguous").limit(50));
  return {id:job.id as string,phase:job.phase as string,discovered:Number(job.discovered),lastError:job.last_error as string|null,totals:totals as {total:number;pending:number;created:number;completed:number;exists:number;ambiguous:number;errors:number;fields:number},errors:errors as {item_key:string;error:string|null;outcome:string|null}[]};
}
export const tmdbCatalogStatus = createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  await assertStaff(context);
  const job=checked(await context.supabase.from("tmdb_catalog_jobs").select("*").eq("year",CATALOG_YEAR).order("created_at",{ascending:false}).limit(1).maybeSingle());
  return job ? report(context,job) : null;
});
export const tmdbCatalogStart = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  await assertStaff(context);
  const {supabaseAdmin:db}=await import("@/integrations/supabase/client.server");
  const existing=checked(await db.from("tmdb_catalog_jobs").select("*").eq("year",CATALOG_YEAR).neq("phase","done").order("created_at",{ascending:false}).limit(1).maybeSingle());
  if(existing) return report(context,existing);
  const job=checked(await db.from("tmdb_catalog_jobs").insert({year:CATALOG_YEAR,segments:[yearSegment()],actor_id:context.userId}).select("*").single());
  // Preserve local 2026 rows even when TMDB discovery does not return their identifier.
  let offset=0;
  while(true) {
    const rows=checked(await context.supabase.from("movies").select("id,tmdb_id").eq("release_year",CATALOG_YEAR).order("id").range(offset,offset+499));
    if(rows.length) checked(await db.from("tmdb_catalog_job_items").upsert(rows.map(r=>({job_id:job.id,item_key:`local:${r.id}`,content_id:r.id,tmdb_id:r.tmdb_id})),{onConflict:"job_id,item_key",ignoreDuplicates:true}));
    if(rows.length<500) break; offset+=500;
  }
  return report(context,job);
});
export const tmdbCatalogStep = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({id:z.string().uuid()})).handler(async({data,context})=>{
    await assertStaff(context);
    const {supabaseAdmin:db}=await import("@/integrations/supabase/client.server");
    const now=new Date().toISOString();
    const job=checked(await db.from("tmdb_catalog_jobs").update({lease_until:new Date(Date.now()+120000).toISOString()}).eq("id",data.id).or(`lease_until.is.null,lease_until.lt.${now}`).select("*").maybeSingle());
    if(!job) throw new Error("Este lote já está em execução. Aguarde e tente novamente.");
    try {
      if(job.phase==="discover") {
        const segments=job.segments as unknown as DateSegment[];
        const segment=segments[job.segment_index];
        if(!segment) throw new Error("Checkpoint de descoberta inválido.");
        const r=await tmdbGet("/discover/movie",{language:"pt-BR",include_adult:"false",include_video:"false",sort_by:"primary_release_date.asc","primary_release_date.gte":segment.from,"primary_release_date.lte":segment.to,page:job.page},{ttl:86400});
        if(r.total_pages>500) {
          segments.splice(job.segment_index,1,...splitSegment(segment)); job.segments=segments; job.page=1;
        } else {
          const rows=(r.results??[]).filter((m:any)=>inCatalogYear(m.release_date)).map((m:any)=>({job_id:job.id,item_key:`tmdb:${m.id}`,tmdb_id:m.id}));
          if(rows.length) {
            const saved=checked(await db.from("tmdb_catalog_job_items").upsert(rows,{onConflict:"job_id,item_key",ignoreDuplicates:true}).select("item_key"));
            job.discovered+=saved.length;
          }
          job.total_reported+=job.page===1 ? (r.total_results??0) : 0;
          if(job.page>=Math.max(r.total_pages,1)) {job.segment_index++;job.page=1;} else job.page++;
          if(job.segment_index>=segments.length) job.phase="import";
        }
        checked(await db.from("tmdb_catalog_jobs").update({segments:job.segments,segment_index:job.segment_index,page:job.page,phase:job.phase,discovered:job.discovered,total_reported:job.total_reported,last_error:null,updated_at:now}).eq("id",job.id));
      } else if(job.phase==="import") {
        const items=checked(await db.from("tmdb_catalog_job_items").select("*").eq("job_id",job.id).eq("state","pending").order("item_key").limit(CATALOG_BATCH_SIZE));
        await Promise.all(items.map(async item => {
          try {
            let tmdbId=item.tmdb_id;
            let row:any=null;
            if(item.content_id) {
              row=checked(await context.supabase.from("movies").select("*").eq("id",item.content_id).single());
              tmdbId=(await resolveCompletion("movie",row)).tmdbId;
              if(!tmdbId) {
                checked(await db.from("tmdb_catalog_job_items").update({state:"done",outcome:"ambiguous",error:"Correspondência não confiável; conteúdo preservado.",attempts:item.attempts+1}).eq("job_id",job.id).eq("item_key",item.item_key)); return;
              }
            }
            if(!tmdbId) throw new Error("TMDB ID ausente; conteúdo preservado.");
            const meta=await movieMeta(tmdbId,false);
            if(!inCatalogYear(meta.fields.release_date)) {
              checked(await db.from("tmdb_catalog_job_items").update({state:"done",outcome:"outside_year",error:"Data principal no TMDB não pertence a 2026; conteúdo preservado."}).eq("job_id",job.id).eq("item_key",item.item_key));return;
            }
            let result:any;
            if(row) { result=await applyCompletion(context,"movie",row.id,row,meta.fields,meta.genres);result={...result,id:row.id,outcome:result.filled||result.genres?"completed":"exists"}; }
            else result=checked(await context.supabase.rpc("import_tmdb_movie_metadata",{_patch:meta.fields,_genre_ids:meta.genres.map((g:any)=>g.id)}));
            checked(await db.from("tmdb_catalog_job_items").update({state:"done",outcome:result.outcome,content_id:result.id??null,filled:result.filled??0,error:result.outcome==="ambiguous"?"Mais de um registro corresponde ao título e ano; revisão necessária.":null,attempts:item.attempts+1}).eq("job_id",job.id).eq("item_key",item.item_key));
          } catch(e) {
            checked(await db.from("tmdb_catalog_job_items").update({state:"error",error:e instanceof Error?e.message:"Erro ao atualizar metadados.",attempts:item.attempts+1}).eq("job_id",job.id).eq("item_key",item.item_key));
          }
        }));
        if(!items.length) {job.phase="done";checked(await db.from("tmdb_catalog_jobs").update({phase:"done",updated_at:now,last_error:null}).eq("id",job.id));}
      }
      return report(context,job);
    } catch(e) {
      const message=e instanceof Error?e.message:"Falha ao processar lote.";
      checked(await db.from("tmdb_catalog_jobs").update({last_error:message}).eq("id",job.id));
      throw new Error(message);
    } finally { await db.from("tmdb_catalog_jobs").update({lease_until:null}).eq("id",job.id); }
  });
export const tmdbCatalogRetry = createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(z.object({id:z.string().uuid()})).handler(async({context,data})=>{
  await assertStaff(context); const {supabaseAdmin:db}=await import("@/integrations/supabase/client.server");
  checked(await db.from("tmdb_catalog_job_items").update({state:"pending",error:null}).eq("job_id",data.id).eq("state","error"));
  checked(await db.from("tmdb_catalog_jobs").update({phase:"import",last_error:null}).eq("id",data.id)); return {ok:true};
});