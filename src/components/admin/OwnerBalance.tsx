import { useQuery } from "@tanstack/react-query";
import { Infinity as InfinityIcon, Loader2 } from "lucide-react";
import { db } from "@/lib/admin/db";

/** Shows the caller's balance as reported by the backend (super admin = unlimited). */
export function OwnerBalance() {
  const q = useQuery({
    queryKey: ["admin", "my-balance"],
    queryFn: async () => {
      const { data, error } = await db.rpc("my_credit_balance");
      if (error) throw error;
      return data as { unlimited: boolean; credits: number | null };
    },
  });
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><InfinityIcon /></div>
      <div>
        <p className="text-xs text-muted-foreground">Seu saldo</p>
        {q.isLoading ? <Loader2 className="size-4 animate-spin" /> : q.error ? <p className="text-sm text-destructive">Não foi possível verificar o saldo.</p>
          : <p className="text-lg font-bold">{q.data?.unlimited ? "∞ Créditos ilimitados" : `${q.data?.credits ?? 0} créditos`}</p>}
      </div>
    </div>
  );
}
