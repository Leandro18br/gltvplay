import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipForward, ListVideo, Settings2, Loader2, RotateCcw, RotateCw, Radio,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser, getProgress, saveProgress } from "@/lib/user-data";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type PKind = "movie" | "episode" | "channel";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = supabase;

export const Route = createFileRoute("/_authenticated/assistir/$kind/$id")({
  head: () => ({ meta: [{ title: "Assistindo — Streaming" }, { name: "robots", content: "noindex" }] }),
  component: PlayerPage,
});

type Ep = { id: string; episode_number: number; title: string; thumbnail_url: string | null; season_number: number };

function usePlaybackInfo(kind: PKind, id: string) {
  return useQuery({
    queryKey: ["player", kind, id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const urlRes = await sb.rpc("get_playback_url", { _kind: kind, _content_id: id });
      if (urlRes.error) throw new Error(urlRes.error.message.includes("inactive") ? "Sua conta está inativa." : "Não foi possível autorizar a reprodução.");
      let title = "", subtitle: string | null = null, back: { to: string; slug?: string } = { to: "/" }, episodes: Ep[] = [], poster: string | null = null;
      if (kind === "movie") {
        const { data } = await sb.from("movies").select("title,slug,backdrop_url").eq("id", id).maybeSingle();
        if (!data) throw new Error("Conteúdo indisponível.");
        title = data.title; poster = data.backdrop_url; back = { to: "/filme/$slug", slug: data.slug || id };
      } else if (kind === "channel") {
        const { data } = await sb.from("channels").select("name,slug,logo_url").eq("id", id).maybeSingle();
        if (!data) throw new Error("Canal indisponível.");
        title = data.name; subtitle = "Ao vivo"; back = { to: "/canal/$slug", slug: data.slug || id };
      } else {
        const { data } = await sb.from("episodes").select("title,episode_number,thumbnail_url,seasons!inner(season_number,series_id,series!inner(id,slug,title))").eq("id", id).maybeSingle();
        if (!data) throw new Error("Episódio indisponível.");
        const s = data.seasons.series;
        title = s.title; subtitle = `T${data.seasons.season_number}:E${data.episode_number} · ${data.title}`; poster = data.thumbnail_url;
        back = { to: "/serie/$slug", slug: s.slug || s.id };
        const all = await sb.from("seasons").select("season_number,episodes(id,episode_number,title,thumbnail_url,status)").eq("series_id", s.id).order("season_number");
        episodes = (all.data ?? []).flatMap((se: { season_number: number; episodes: (Ep & { status: string })[] }) =>
          se.episodes.filter((e) => e.status === "published").sort((a, b) => a.episode_number - b.episode_number).map((e) => ({ ...e, season_number: se.season_number })));
      }
      return { url: urlRes.data as string | null, title, subtitle, back, episodes, poster };
    },
  });
}

const fmt = (s: number) => {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const isEmbed = (u: string) => /youtube\.com|youtu\.be|vimeo\.com/.test(u);

function PlayerPage() {
  const { kind: rawKind, id } = Route.useParams();
  const kind = (["movie", "episode", "channel"].includes(rawKind) ? rawKind : "movie") as PKind;
  const info = usePlaybackInfo(kind, id);
  const router = useRouter();

  if (info.isPending) return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="size-10 animate-spin text-primary" /></div>;
  if (info.isError || !info.data?.url) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <h1 className="text-2xl font-semibold">Reprodução indisponível</h1>
        <p className="max-w-md text-muted-foreground">{info.error instanceof Error ? info.error.message : "Este conteúdo ainda não possui uma fonte de reprodução autorizada."}</p>
        <Button variant="secondary" onClick={() => router.history.back()}><ArrowLeft /> Voltar</Button>
      </div>
    );
  }
  return <Player key={`${kind}-${id}`} kind={kind} id={id} data={info.data} />;
}

function Player({ kind, id, data }: { kind: PKind; id: string; data: NonNullable<ReturnType<typeof usePlaybackInfo>["data"]> }) {
  const { user } = useAuthUser();
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fs, setFs] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [ui, setUi] = useState(true);
  const [levels, setLevels] = useState<{ i: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [epOpen, setEpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState<number | null>(null);
  const live = kind === "channel";
  const url = data.url!;
  const idx = data.episodes.findIndex((e) => e.id === id);
  const next = idx >= 0 ? data.episodes[idx + 1] : undefined;

  // Load source (HLS via hls.js when not natively supported)
  useEffect(() => {
    const v = video.current;
    if (!v || isEmbed(url)) return;
    let cancelled = false;
    const isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls && !v.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) { setError("Seu navegador não suporta este formato."); return; }
        const hls = new Hls({ enableWorker: true, lowLatencyMode: live });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e: unknown, d: { levels: { height: number; bitrate: number }[] }) => {
          setLevels(d.levels.map((l, i) => ({ i, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps` })).reverse());
        });
        hls.on(Hls.Events.ERROR, (_e: unknown, d: { fatal: boolean }) => { if (d.fatal) setError("Falha ao carregar a transmissão."); });
      });
    } else {
      v.src = url;
    }
    return () => { cancelled = true; hlsRef.current?.destroy(); hlsRef.current = null; };
  }, [url, live]);

  // Resume from history
  useEffect(() => {
    if (!user || live) return;
    getProgress(user.id, kind, id).then((p) => {
      if (p && p.position_seconds > 5 && p.progress_percent < 95) setResumed(p.position_seconds);
    });
  }, [user, kind, id, live]);
  useEffect(() => {
    const v = video.current;
    if (!v || resumed == null) return;
    const apply = () => { v.currentTime = resumed; };
    if (v.readyState >= 1) apply(); else v.addEventListener("loadedmetadata", apply, { once: true });
  }, [resumed]);

  // Save progress periodically + on leave
  const persist = useCallback(() => {
    const v = video.current;
    if (!user || !v || live || !v.duration || v.currentTime < 1) return;
    saveProgress(user.id, kind, id, v.currentTime, v.duration);
  }, [user, kind, id, live]);
  useEffect(() => {
    const t = setInterval(() => { if (!video.current?.paused) persist(); }, 10_000);
    const onHide = () => persist();
    window.addEventListener("pagehide", onHide);
    return () => { clearInterval(t); window.removeEventListener("pagehide", onHide); persist(); };
  }, [persist]);
  useEffect(() => {
    if (live && user) saveProgress(user.id, "channel", id, 1, 0);
  }, [live, user, id]);

  // Auto-hide controls
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!video.current?.paused) setUi(false); }, 3000);
  }, []);

  const toggle = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }, []);
  const seekBy = (d: number) => { const v = video.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const toggleFs = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrap.current?.requestFullscreen?.().catch(() => {});
  };
  const goNext = () => { if (next) { persist(); navigate({ to: "/assistir/$kind/$id", params: { kind: "episode", id: next.id }, replace: true }); } };

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") seekBy(10);
      else if (e.key === "ArrowLeft") seekBy(-10);
      else if (e.key === "f") toggleFs();
      else if (e.key === "m") setMuted((m) => !m);
      poke();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); };
  }, [toggle, poke]);

  useEffect(() => { if (video.current) { video.current.volume = vol; video.current.muted = muted; } }, [vol, muted]);

  const backLink = data.back.slug
    ? <Link to={data.back.to as "/filme/$slug"} params={{ slug: data.back.slug }} aria-label="Voltar" className="rounded-full p-2 hover:bg-foreground/10"><ArrowLeft /></Link>
    : <Link to="/" aria-label="Voltar" className="rounded-full p-2 hover:bg-foreground/10"><ArrowLeft /></Link>;

  if (isEmbed(url)) {
    const yt = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
    const src = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1` : url.replace("vimeo.com/", "player.vimeo.com/video/");
    return (
      <div className="fixed inset-0 bg-background">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-3">{backLink}<p className="font-semibold">{data.title}</p></div>
        <iframe src={src} title={data.title} allow="autoplay; encrypted-media; fullscreen" allowFullScreen className="h-full w-full" />
      </div>
    );
  }

  return (
    <div ref={wrap} onMouseMove={poke} onTouchStart={poke} className={`fixed inset-0 select-none bg-background ${ui ? "" : "cursor-none"}`}>
      <video
        ref={video}
        className="h-full w-full bg-background object-contain"
        poster={data.poster ?? undefined}
        autoPlay
        playsInline
        onClick={toggle}
        onDoubleClick={toggleFs}
        onPlay={() => { setPlaying(true); poke(); }}
        onPause={() => { setPlaying(false); setUi(true); persist(); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuffered(b.end(b.length - 1)); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => { persist(); if (next) goNext(); }}
        onError={() => setError("Não foi possível reproduzir este conteúdo.")}
      />

      {waiting && !error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 className="size-12 animate-spin text-primary" /></div>}
      {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-center"><p className="text-lg font-semibold">{error}</p><Button variant="secondary" onClick={() => location.reload()}>Tentar novamente</Button></div>}

      <div className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${ui ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <div className="flex items-center gap-3 bg-gradient-to-b from-background/90 to-transparent p-4 md:p-6">
          {backLink}
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">{data.title}</p>
            {data.subtitle && <p className="truncate text-sm text-muted-foreground">{data.subtitle}</p>}
          </div>
        </div>

        <div className="space-y-3 bg-gradient-to-t from-background/95 via-background/60 to-transparent p-4 pt-16 md:p-6">
          {!live && (
            <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
              <span>{fmt(time)}</span>
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 my-auto h-1 rounded-full bg-foreground/25" style={{ width: dur ? `${(buffered / dur) * 100}%` : 0 }} />
                <Slider aria-label="Progresso" value={[time]} max={dur || 1} step={1}
                  onValueChange={([v = 0]) => { if (video.current) video.current.currentTime = v; setTime(v); }} />
              </div>
              <span>{fmt(dur)}</span>
            </div>
          )}
          <div className="flex items-center gap-1 md:gap-2">
            <Ctrl label={playing ? "Pausar" : "Reproduzir"} onClick={toggle}>{playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}</Ctrl>
            {!live && <><Ctrl label="Voltar 10s" onClick={() => seekBy(-10)}><RotateCcw /></Ctrl><Ctrl label="Avançar 10s" onClick={() => seekBy(10)}><RotateCw /></Ctrl></>}
            <div className="group/vol flex items-center">
              <Ctrl label={muted ? "Ativar som" : "Silenciar"} onClick={() => setMuted((m) => !m)}>{muted || vol === 0 ? <VolumeX /> : <Volume2 />}</Ctrl>
              <div className="hidden w-24 md:block"><Slider aria-label="Volume" value={[muted ? 0 : vol]} max={1} step={0.05} onValueChange={([v = 0]) => { setVol(v); setMuted(v === 0); }} /></div>
            </div>
            {live && <span className="ml-2 flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold uppercase text-destructive-foreground"><Radio className="size-3" /> Ao vivo</span>}
            <div className="ml-auto flex items-center gap-1 md:gap-2">
              {next && <Button variant="secondary" size="sm" className="rounded-full" onClick={goNext}><SkipForward /> <span className="hidden sm:inline">Próximo episódio</span></Button>}
              {data.episodes.length > 0 && <Ctrl label="Episódios" onClick={() => setEpOpen(true)}><ListVideo /></Ctrl>}
              {levels.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button aria-label="Qualidade" className="rounded-full p-2 hover:bg-foreground/10"><Settings2 /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    <DropdownMenuRadioGroup value={String(level)} onValueChange={(v) => { const n = Number(v); setLevel(n); if (hlsRef.current) hlsRef.current.currentLevel = n; }}>
                      <DropdownMenuRadioItem value="-1">Automática</DropdownMenuRadioItem>
                      {levels.map((l) => <DropdownMenuRadioItem key={l.i} value={String(l.i)}>{l.label}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Ctrl label={fs ? "Sair da tela cheia" : "Tela cheia"} onClick={toggleFs}>{fs ? <Minimize /> : <Maximize />}</Ctrl>
            </div>
          </div>
        </div>
      </div>

      <Sheet open={epOpen} onOpenChange={setEpOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle>Episódios</SheetTitle>
          <ol className="mt-4 space-y-2">
            {data.episodes.map((e) => (
              <li key={e.id}>
                <Link to="/assistir/$kind/$id" params={{ kind: "episode", id: e.id }} replace onClick={() => { persist(); setEpOpen(false); }}
                  className={`flex items-center gap-3 rounded-xl p-2 transition hover:bg-accent ${e.id === id ? "bg-accent ring-1 ring-primary/50" : ""}`}>
                  <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted">{e.thumbnail_url && <img src={e.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0">
                    <p className="text-xs text-primary">T{e.season_number}:E{e.episode_number}</p>
                    <p className="truncate text-sm font-medium">{e.title}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Ctrl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-full p-2 transition hover:bg-foreground/10 [&_svg]:size-6">{children}</button>;
}
