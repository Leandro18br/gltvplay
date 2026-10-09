/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Removes credentials/paths from URLs before anything is sent to the model. */
export const redact = (s: string) =>
  s.replace(/\b(https?|rtmp|rtsp):\/\/[^\s"'<>]+/gi, (u) => {
    try { return `${new URL(u).protocol}//${new URL(u).host}/…`; } catch { return "[url]"; }
  }).replace(/(user(name)?|pass(word)?|token|key)=[^&\s]+/gi, "$1=***");

const SYSTEM = `Você é um engenheiro de suporte de uma plataforma de streaming que importa listas M3U/IPTV para um catálogo (filmes, séries, episódios, canais) e enriquece com TMDB. Analise os registros de falha da sincronização/importação fornecidos.
Responda em português do Brasil, em markdown curto, com as seções:
1. Resumo (1-2 frases)
2. Causas prováveis — agrupe as falhas por causa, com contagem aproximada e nível de confiança (alta/média/baixa)
3. Ações corretivas — passos concretos para o administrador, em ordem de prioridade
4. Itens que exigem verificação manual
Não invente dados que não estejam nos registros. Se a evidência for insuficiente, diga isso. Nunca sugira contornar DRM, CORS, restrições de provedores ou criar proxies não autorizados.`;

export const diagnoseSyncFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ listId: z.string().uuid(), notes: z.string().max(20000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = (context as any).supabase;
    const { data: ok } = await sb.rpc("is_staff", { _user_id: (context as any).userId });
    if (!ok) throw new Error("Acesso negado");
    const [list, errs, items] = await Promise.all([
      sb.from("m3u_lists").select("name,sync_state,last_error,total_items,index_entries,last_synced_at").eq("id", data.listId).maybeSingle(),
      sb.from("m3u_import_errors").select("error,attempt,created_at,m3u_items(kind,title,season,episode,stream_type)").eq("list_id", data.listId).order("created_at", { ascending: false }).limit(150),
      sb.from("m3u_items").select("kind,title,season,episode,import_error,import_attempts").eq("list_id", data.listId).not("import_error", "is", null).limit(150),
    ]);
    if (!list.data) throw new Error("Lista não encontrada.");
    const lines = [
      `Lista: ${list.data.name} · estado: ${list.data.sync_state} · itens: ${list.data.total_items} · última sync: ${list.data.last_synced_at ?? "nunca"}`,
      list.data.last_error ? `Último erro da sincronização: ${list.data.last_error}` : "",
      "\nRegistros de falha recentes:",
      ...(errs.data ?? []).map((e: any) => `- [${e.created_at}] tentativa ${e.attempt} · ${e.m3u_items ? `${e.m3u_items.kind} "${e.m3u_items.title}"${e.m3u_items.season != null ? ` T${e.m3u_items.season}E${e.m3u_items.episode}` : ""} ` : ""}: ${e.error}`),
      "\nItens atualmente com erro:",
      ...(items.data ?? []).map((i: any) => `- ${i.kind} "${i.title}"${i.season != null ? ` T${i.season}E${i.episode}` : ""} (${i.import_attempts} tentativas): ${i.import_error}`),
      data.notes?.trim() ? `\nRegistros adicionais fornecidos pelo administrador:\n${data.notes.trim()}` : "",
    ].filter(Boolean);
    const count = (errs.data?.length ?? 0) + (items.data?.length ?? 0);
    if (!count && !list.data.last_error && !data.notes?.trim()) return { text: "Não há falhas registradas para esta lista. Cole registros adicionais para análise, se houver.", count: 0 };
    const input = redact(lines.join("\n")).slice(0, 60000);

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Serviço de IA não configurado.");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({ model: "openai/gpt-6-astra", instructions: SYSTEM, input, stream: true, store: false, reasoning: { effort: "low" } }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      let m = ""; try { m = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? ""; } catch { /* ignore */ }
      if (res.status === 402) throw new Error(m || "Créditos de IA esgotados. Adicione créditos em Configurações → Planos e créditos.");
      if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente novamente em alguns instantes.");
      if (res.status === 403) throw new Error(m || "Acesso à IA negado para este workspace.");
      throw new Error(m || `Falha no serviço de IA (${res.status}).`);
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = "", text = "";
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n"); buf = parts.pop() ?? "";
      for (const l of parts) {
        if (!l.startsWith("data:")) continue;
        const p = l.slice(5).trim(); if (!p || p === "[DONE]") continue;
        try {
          const ev = JSON.parse(p);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          else if (ev.type === "error" || ev.type === "response.failed") throw new Error(ev.error?.message ?? ev.response?.error?.message ?? "Falha na análise da IA.");
        } catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; }
      }
    }
    if (!text.trim()) throw new Error("A IA não retornou uma análise. Tente novamente mais tarde.");
    return { text, count };
  });
