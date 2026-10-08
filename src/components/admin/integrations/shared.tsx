import { Badge } from "@/components/ui/badge";

export type Integration = {
  id: string; name: string; description: string | null; kind: "catalog" | "movie_player" | "episode_player"; base_url: string;
  auth_method: "none" | "query_key" | "header_key" | "bearer" | "custom_header"; auth_param: string | null;
  headers: Record<string, string>; params: Record<string, string>; default_method: "GET" | "POST"; priority: number; is_active: boolean;
  rate_limit_per_minute: number; cache_ttl_seconds: number; auto_fetch_player: boolean; key_hint: string | null; token_hint: string | null;
  last_tested_at: string | null; last_status: "never" | "ok" | "error"; last_error: string | null; request_count: number;
};
export type Endpoint = {
  id: string; integration_id: string; name: string; description: string | null; kind: string; method: "GET" | "POST"; path: string;
  headers: Record<string, string>; query: Record<string, string>; body: string | null; mapping: Record<string, unknown>; is_active: boolean; sort_order: number;
};

/** "chave=valor" per line <-> object. */
export const kvToText = (o: Record<string, string> | null | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
export function textToKv(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of t.split("\n")) { const i = line.indexOf("="); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}

export function StatusBadge({ i }: { i: Pick<Integration, "is_active" | "last_status"> }) {
  const s = !i.is_active ? ["Inativa", "bg-muted-foreground"] : i.last_status === "ok" ? ["Conectada", "bg-primary"] : i.last_status === "error" ? ["Erro", "bg-destructive"] : ["Nunca testada", "bg-muted-foreground/50"];
  return <Badge variant="outline" className="gap-1.5 rounded-full"><span className={`size-2 rounded-full ${s[1]}`} />{s[0]}</Badge>;
}

export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
