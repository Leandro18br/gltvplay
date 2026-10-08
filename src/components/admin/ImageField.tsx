import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { uploadMedia, errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ImageField({
  value,
  onChange,
  folder,
  aspect = "aspect-video",
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  folder: string;
  aspect?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      onChange(await uploadMedia(f, folder));
      toast.success("Imagem enviada");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className={`relative ${aspect} max-h-48 w-full overflow-hidden rounded-xl border border-dashed border-border bg-muted`}>
        {value ? (
          <>
            <img src={value} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => onChange(null)} className="absolute right-2 top-2 rounded-full bg-background/80 p-1 hover:bg-background" aria-label="Remover imagem">
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => ref.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {busy ? "Enviando…" : "Enviar imagem"}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Input placeholder="ou cole uma URL" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
          Upload
        </Button>
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
