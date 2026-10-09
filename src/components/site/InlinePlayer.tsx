import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmbedPlayer } from "./EmbedPlayer";
import { Button } from "@/components/ui/button";
import { VideoPlayerFrame } from "./VideoPlayerFrame";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = supabase;

type Src = { id: string; url: string; type: "url" | "embed" | "hls"; label: string | null };

/**
 * Compact public player block: cover + centered Play; nothing external loads
 * until the viewer clicks. On click, loads the primary configured source
 * (embed/iframe, direct URL or HLS) in the same space. Requires sign-in,
 * exactly like the full watch page.
 */
export function InlinePlayer({ kind, id, title, poster }: { kind: "movie" | "episode"; id: string; title: string; poster: string | null }) {
  const navigate = useNavigate();
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Src[]>([]);
  const [server, setServer] = useState(0);

  useEffect(() => { setStarted(false); setLoading(false); setError(null); setSources([]); setServer(0); }, [kind, id]);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      const res = await sb.rpc("get_playback_sources", { _kind: kind, _content_id: id });
      if (res.error) throw new Error(res.error.message);
      const list = (res.data ?? []) as Src[];
      if (list.length === 0) throw new Error("empty");
      setSources(list);
      setStarted(true);
    } catch {
      setError("Não foi possível carregar o player. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const source = sources[Math.min(server, sources.length - 1)];
  const isHls = source?.type === "hls" || /\.m3u8(\?|$)/i.test(source?.url ?? "");

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className={`relative w-full ${started ? "" : "aspect-video overflow-hidden rounded-xl bg-card ring-1 ring-border"}`}>
        {!started ? (
          <Button type="button" variant="ghost" onClick={start} disabled={loading} aria-label={`Reproduzir ${title}`} className="group relative block h-full w-full rounded-none p-0 [&_svg]:size-9">
            {poster && <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
            <span className="absolute inset-0 bg-background/55 transition group-hover:bg-background/40" />
            <span className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-foreground shadow-glow transition duration-300 group-hover:scale-110 group-active:scale-95">
              {loading ? <Loader2 className="size-9 animate-spin" /> : <Play className="ml-1 size-9 fill-current" />}
            </span>
            {error && <span className="absolute inset-x-3 bottom-3 rounded-lg bg-background/85 px-3 py-2 text-center text-xs text-muted-foreground">{error}</span>}
          </Button>
        ) : !source ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">Não foi possível carregar o player. Tente novamente.</div>
        ) : source.type === "embed" ? (
          <EmbedPlayer url={source.url} title={title} />
        ) : isHls ? (
          <InlineHls key={source.id} url={source.url} title={title} poster={poster} servers={sources} selectedServer={source.id} onServerChange={setServer} />
        ) : (
          <VideoPlayerFrame key={source.id} title={title} servers={sources} selectedServer={source.id} onServerChange={setServer}>
            <video src={source.url} autoPlay playsInline className="h-full w-full bg-player" />
          </VideoPlayerFrame>
        )}
      </div>
      {started && source?.type === "embed" && sources.length > 1 && (
        <div role="group" aria-label="Servidores" className="flex flex-wrap items-center gap-2">
          {sources.map((s, n) => (
            <Button key={s.id} size="sm" variant={s.id === source?.id ? "default" : "secondary"} className="rounded-full" aria-pressed={s.id === source?.id} onClick={() => setServer(n)}>
              Servidor {n + 1}{s.label && !/^Servidor \d+$/i.test(s.label) ? ` · ${s.label}` : ""}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Minimal HLS playback inside the compact block (hls.js when needed). */
function InlineHls({ url, title, servers, selectedServer, onServerChange }: { url: string; title: string; poster: string | null; servers: Src[]; selectedServer: string; onServerChange: (index: number) => void }) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null;
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = url;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) { setFailed(true); return; }
        hls = new Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e: unknown, data: { levels: { height: number; bitrate: number }[] }) => {
          setLevels(data.levels.map((item, i) => ({ i, label: item.height ? `${item.height}p` : `${Math.round(item.bitrate / 1000)} kbps` })));
        });
        setEngine(hls);
        hls.on(Hls.Events.ERROR, (_e: unknown, d: { fatal: boolean }) => { if (d.fatal) setFailed(true); });
      });
    }
    return () => { cancelled = true; hls?.destroy(); };
  }, [el, url]);

  const [levels, setLevels] = useState<{ i: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [engine, setEngine] = useState<{ currentLevel: number } | null>(null);
  return <VideoPlayerFrame title={title} servers={servers} selectedServer={selectedServer} onServerChange={onServerChange} error={failed ? "HLS" : null} qualities={levels} quality={level} onQualityChange={value => { setLevel(value); if (engine) engine.currentLevel = value; }}>
    <video ref={setEl} title={title} autoPlay playsInline className="h-full w-full bg-player" />
  </VideoPlayerFrame>;
}
