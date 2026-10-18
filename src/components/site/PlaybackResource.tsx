import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { probePlayerUrl } from "@/lib/playback/playback.functions";
import type { ProbeResult } from "@/lib/playback/script-url";

/** One bounded resource decision for both inline and full-page playback. No media relay. */
export function PlaybackResource({ url, children }: { url: string; children: (result: ProbeResult) => ReactNode }) {
  const probe = useServerFn(probePlayerUrl);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setResult(null);
    const fail = (message: string) => { if (!disposed) setResult({ kind: "error", status: null, contentType: null, embeddable: false, playUrl: null, message }); };
    const timer = setTimeout(() => { fail("O servidor do player demorou demais para responder. Tente novamente."); disposed = true; }, 15000);
    probe({ data: { url } }).then(value => { if (!disposed) setResult(value); }).catch(() => fail("Não foi possível verificar o player. Verifique sua conexão e tente novamente.")).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); };
  }, [url, probe, attempt]);
  if (result?.playUrl) return children(result);
  return <div data-remote-player className="relative flex aspect-video w-full flex-col items-center justify-center gap-3 bg-player px-4 text-center text-player-foreground">
    {!result ? <Loader2 aria-label="Verificando player" className="size-8 animate-spin text-primary" /> : <><AlertTriangle className="size-7 text-primary" /><p role="alert" className="max-w-lg text-sm">{result.message}</p><Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button></>}
  </div>;
}