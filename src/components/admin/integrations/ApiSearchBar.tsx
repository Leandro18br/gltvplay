import { useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Shared search box for the "Buscar … pela API" dialogs.
 * The text lives here (never reset by results/refreshes), the field and the button are never disabled
 * (a disabled submit button silently blocks the Android keyboard's "search" key), and a new search
 * simply supersedes the previous one in the caller.
 */
export function ApiSearchBar({ label, placeholder, source, busy, onSearch, children }: {
  label: string; placeholder: string; source: string; busy: boolean;
  onSearch: (q: string) => void; children?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState(false);
  function submit() {
    const q = value.trim();
    if (!q) { setHint(true); ref.current?.focus(); return; }
    setHint(false); onSearch(q);
  }
  return (
    <div className="space-y-1">
      <form role="search" className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="relative min-w-0 flex-1 basis-56">
          <Input ref={ref} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            aria-label={label} placeholder={placeholder} className="h-10 pr-9 text-base"
            value={value} onChange={e => { setValue(e.target.value); if (hint) setHint(false); }} />
          {value && <button type="button" aria-label="Apagar texto" className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground"
            onPointerDown={e => e.preventDefault()} onClick={() => { setValue(""); ref.current?.focus(); }}><X className="size-4" /></button>}
        </div>
        <Button type="submit" className="h-10">{busy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
        {children}
      </form>
      <p className={`text-xs ${hint ? "text-destructive" : "text-muted-foreground"}`}>{hint ? "Digite um nome (pode ser só parte dele) para pesquisar." : source}</p>
    </div>
  );
}
