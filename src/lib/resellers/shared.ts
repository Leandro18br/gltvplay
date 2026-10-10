import { errMsg } from "@/lib/admin/db";

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

export function resellerErr(e: unknown) {
  const raw = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (/insufficient credits/i.test(raw)) return "Saldo insuficiente: a retirada deixaria o saldo negativo.";
  if (/order not pending/i.test(raw)) return "Este pedido já foi decidido.";
  if (/reason required/i.test(raw)) return "Informe o motivo (mínimo 3 caracteres).";
  if (/invalid quantity/i.test(raw)) return "Quantidade inválida.";
  if (/staff accounts/i.test(raw)) return "Contas da equipe do painel não podem ser revendedoras.";
  if (/^forbidden$/i.test(raw)) return "Somente o administrador principal pode fazer isso.";
  return errMsg(e);
}

export const TX_REASON: Record<string, string> = {
  access_created: "Acesso criado", admin_adjust: "Ajuste manual", order_approved: "Pedido aprovado",
};
export const ORDER_STATUS: Record<string, string> = {
  pending: "Pendente", approved: "Aprovado", rejected: "Recusado", cancelled: "Cancelado",
};
export const CONTENT_STATUS: Record<string, string> = {
  pending: "Pendente", in_progress: "Em andamento", completed: "Concluído", rejected: "Recusado",
};
