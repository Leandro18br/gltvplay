/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/lib/auth/area-client";

// Untyped handle for config-driven admin screens (table names come from config).
export const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type Row = any;

export const STATUS_OPTIONS = [
  { value: "published", label: "Publicado" },
  { value: "draft", label: "Rascunho" },
  { value: "archived", label: "Arquivado" },
];

export const KIND_OPTIONS = [
  { value: "movie", label: "Filme" },
  { value: "series", label: "Série" },
  { value: "channel", label: "Canal" },
];

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Uploads to the private media bucket and returns a long-lived signed URL. */
export async function uploadMedia(file: File, folder: string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Envie um arquivo de imagem");
  if (file.size > 10 * 1024 * 1024) throw new Error("Imagem maior que 10MB");
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw error;
  const { data, error: e2 } = await supabase.storage.from("media").createSignedUrl(path, TEN_YEARS);
  if (e2 || !data) throw e2 ?? new Error("Falha ao gerar link da imagem");
  return data.signedUrl;
}

export type StaffRole = "super_admin" | "admin" | "editor";
export const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", admin: "Administrador", editor: "Editor", user: "Usuário" };
export const isAdminRole = (r: string | null | undefined) => r === "admin" || r === "super_admin";

export function errMsg(e: unknown) {
  const raw = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (!raw) return "Ocorreu um erro";
  if (/row-level security|permission denied|forbidden|violates row/i.test(raw)) return "Você não tem permissão para esta ação.";
  if (/rate limit/i.test(raw)) return "Muitas ações em pouco tempo. Aguarde um minuto e tente de novo.";
  if (/duplicate key|already exists/i.test(raw)) return "Já existe um registro com esses dados (slug ou identificador duplicado).";
  if (/check constraint/i.test(raw)) return "Algum campo está fora do formato permitido (título, ano, duração, slug ou URL).";
  if (/cannot remove your own/i.test(raw)) return "Você não pode remover a sua própria permissão.";
  if (/Failed to fetch|NetworkError|timeout/i.test(raw)) return "Sem conexão com o servidor. Tente novamente.";
  return raw;
}
