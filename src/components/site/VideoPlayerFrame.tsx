import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Cast, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings2, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CONTROLS_IDLE_MS, PLAYBACK_RATES, isTextEntry, playbackTime, seekTarget } from "@/lib/playback/controls";

export type PlayerServer = { id: string; label: string | null };
type RemoteVideo = HTMLVideoElement & {
  remote?: { watchAvailability: (callback: (available: boolean) => void) => Promise<number>; cancelWatchAvailability: (id: number) => Promise<void>; prompt: () => Promise<void> };
  webkitShowPlaybackTargetPicker?: () => void;
  webkitEnterFullscreen?: () => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
};
type Props = {
  children: ReactNode;
  title: string;
  header?: ReactNode;
  actions?: ReactNode;
  servers?: PlayerServer[];
  selectedServer?: string;
  onServerChange?: (index: number) => void;
  qualities?: { i: number; label: string }[];
  quality?: number;
  onQualityChange?: (index: number) => void;
  error?: string | null;
  onRetry?: () => void;
  fullPage?: boolean;
};

// Only native media controls. This frame never resolves or changes a playback URL.
export function VideoPlayerFrame({ children, title, header, actions, servers = [], selectedServer, onServerChange, qualities = [], quality = -1, onQualityChange, error, onRetry, fullPage = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const media = useRef<RemoteVideo | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOpen = useRef(false);
  const [visible, setVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [cast, setCast] = useState<"remote" | "airplay" | null>(null);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canSeek = Number.isFinite(duration) && duration > 0;
  const hasError = failed || !!error;

  const reveal = useCallback(() => {
    setVisible(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      const video = media.current;
      const focused = document.activeElement;
      if (video && !video.paused && !video.ended && !menuOpen.current && !(focused && wrap.current?.contains(focused) && focused.matches(':focus-visible'))) setVisible(false);
    }, CONTROLS_IDLE_MS);
  }, []);
  const flash = (value: string) => {
    setFeedback(value);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 650);
    reveal();
  };
  const toggle = () => {
    const video = media.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => flash("play")).catch(() => { setNotice("Toque em Reproduzir para iniciar."); });
    } else { video.pause(); flash("pause"); }
  };
  const skip = (delta: number) => {
    const video = media.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = seekTarget(video.currentTime, delta, video.duration);
    setTime(video.currentTime);
    flash(delta > 0 ? "+10s" : "−10s");
  };
  const mute = () => {
    const video = media.current;
    if (!video) return;
    video.muted = !video.muted;
    flash(video.muted ? "muted" : "sound");
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === wrap.current) await document.exitFullscreen();
      else if (wrap.current?.requestFullscreen && document.fullscreenEnabled) await wrap.current.requestFullscreen();
      else media.current?.webkitEnterFullscreen?.();
    } catch { setNotice("Não foi possível abrir a tela cheia neste navegador."); }
    reveal();
  };

  useEffect(() => {
    const video = wrap.current?.querySelector("video") as RemoteVideo | null;
    if (!video) return;
    media.current = video;
    try {
      const preferences = JSON.parse(sessionStorage.getItem("gltv-player-volume") ?? "null") as { volume?: number; muted?: boolean } | null;
      if (preferences && typeof preferences.volume === "number" && Number.isFinite(preferences.volume)) video.volume = Math.max(0, Math.min(1, preferences.volume));
      if (preferences && typeof preferences.muted === "boolean") video.muted = preferences.muted;
    } catch { /* Device may prohibit setting volume or storage. Keep native defaults. */ }
    const update = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
      setRate(video.playbackRate);
    };
    const onPlay = () => { setNotice(null); update(); reveal(); };
    const onPause = () => { update(); setVisible(true); clearTimeout(idle.current); };
    const onWaiting = () => setWaiting(true);
    const onReady = () => { setWaiting(false); update(); };
    const onError = () => { setFailed(true); setWaiting(false); setVisible(true); };
    const onVolume = () => {
      update();
      try { sessionStorage.setItem("gltv-player-volume", JSON.stringify({ volume: video.volume, muted: video.muted })); } catch { /* Optional preference. */ }
    };
    const events: [string, EventListener][] = [["timeupdate", update], ["durationchange", update], ["loadedmetadata", update], ["ratechange", update], ["play", onPlay], ["pause", onPause], ["ended", onPause], ["waiting", onWaiting], ["playing", onReady], ["canplay", onReady], ["error", onError], ["volumechange", onVolume]];
    events.forEach(([name, fn]) => video.addEventListener(name, fn));
    const onFs = () => setFullscreen(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onFs);
    let disposed = false;
    let availabilityId: number | undefined;
    if (video.remote?.watchAvailability) {
      video.remote.watchAvailability(available => { if (!disposed) setCast(available ? "remote" : null); })
        .then(id => { availabilityId = id; if (disposed) video.remote?.cancelWatchAvailability(id).catch(() => {}); }).catch(() => {});
    }
    const onAirplay = (event: Event) => {
      if (video.webkitShowPlaybackTargetPicker) setCast((event as Event & { availability?: string }).availability === "available" ? "airplay" : null);
    };
    video.addEventListener("webkitplaybacktargetavailabilitychanged", onAirplay);
    update();
    setWaiting(video.readyState < 3);
    setFailed(!!video.error);
    reveal();
    return () => {
      disposed = true;
      events.forEach(([name, fn]) => video.removeEventListener(name, fn));
      document.removeEventListener("fullscreenchange", onFs);
      video.removeEventListener("webkitplaybacktargetavailabilitychanged", onAirplay);
      if (availabilityId !== undefined) video.remote?.cancelWatchAvailability(availabilityId).catch(() => {});
      clearTimeout(idle.current);
      clearTimeout(feedbackTimer.current);
      media.current = null;
    };
  }, [reveal]);

  // Scoped to this player: keyboard commands never hijack other page controls or text entry.
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.key === " " || event.key === "Enter") && (event.target as HTMLElement).closest("button, a")) return;
    const key = event.key.toLowerCase();
    if ([" ", "arrowleft", "arrowright", "m", "f"].includes(key)) event.preventDefault();
    if (key === " ") toggle();
    else if (key === "arrowleft") skip(-10);
    else if (key === "arrowright") skip(10);
    else if (key === "m") mute();
    else if (key === "f") void toggleFullscreen();
    reveal();
  };
  const iconButton = (label: string, icon: ReactNode, click: () => void, disabled = false) => (
    <Button type="button" variant="ghost" size="icon" title={label} aria-label={label} disabled={disabled} onClick={click} className="size-11 shrink-0 rounded-full text-player-foreground hover:bg-player-foreground/15 hover:text-player-foreground [&_svg]:size-5">{icon}</Button>
  );

  return <div ref={wrap} role="region" aria-label={`Player de ${title}`} tabIndex={0} onKeyDown={onKey} onPointerMove={reveal} onPointerDown={reveal} onFocus={reveal} onBlur={reveal}
    className={`group/player relative isolate min-w-0 bg-player text-player-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary ${fullPage ? "fixed inset-0" : "aspect-video w-full rounded-lg"} ${visible || !playing ? "" : "cursor-none"} [&:fullscreen]:h-dvh [&:fullscreen]:w-full [&:fullscreen]:rounded-none [&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:rounded-[inherit] [&_video]:object-contain`}>
    {children}
    <div onClick={() => { if (!visible) reveal(); else toggle(); }} className="absolute inset-0" aria-hidden="true" />
    {waiting && !hasError && <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2"><Loader2 className="size-6 animate-spin text-primary" /></div>}
    <div className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${visible || !playing || hasError ? "opacity-100" : "opacity-0"}`}>
      {(header || fullPage) && <div className="pointer-events-auto absolute inset-x-0 top-0 flex min-w-0 items-center gap-3 bg-player/70 p-3 md:p-5">{header ?? <p className="truncate text-sm font-semibold">{title}</p>}</div>}
      {!hasError && <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 sm:gap-7">
        <div className="pointer-events-auto">{iconButton("Voltar 10 segundos", <span className="relative"><RotateCcw className="size-7" /><span className="absolute inset-0 flex items-center justify-center pt-1 text-[9px] font-bold">10</span></span>, () => skip(-10), !canSeek)}</div>
        <Button type="button" variant="ghost" aria-label={playing ? "Pausar" : "Reproduzir"} title={playing ? "Pausar" : "Reproduzir"} onClick={toggle} className="pointer-events-auto size-14 shrink-0 rounded-full border border-player-foreground/20 bg-player/65 text-player-foreground backdrop-blur-sm transition hover:scale-105 hover:bg-primary hover:text-primary-foreground sm:size-20 [&_svg]:size-7 sm:[&_svg]:size-9">{playing ? <Pause className="fill-current" /> : <Play className="ml-1 fill-current" />}</Button>
        <div className="pointer-events-auto">{iconButton("Avançar 10 segundos", <span className="relative"><RotateCw className="size-7" /><span className="absolute inset-0 flex items-center justify-center pt-1 text-[9px] font-bold">10</span></span>, () => skip(10), !canSeek)}</div>
      </div>}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 space-y-0 bg-player/75 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-4 sm:pb-2">
        <Slider aria-label="Progresso" value={[canSeek ? Math.min(time, duration) : 0]} max={canSeek ? duration : 1} step={0.1} disabled={!canSeek || hasError} className="h-6" onValueChange={([value = 0]) => { if (media.current && canSeek) { media.current.currentTime = seekTarget(0, value, duration); setTime(value); reveal(); } }} />
        <div className="flex min-w-0 items-center gap-0 sm:gap-2">
          <span className="mr-auto whitespace-nowrap text-[10px] tabular-nums sm:text-xs">{playbackTime(time)} / {playbackTime(duration)}</span>
          {iconButton(muted || volume === 0 ? "Ativar som" : "Silenciar", muted || volume === 0 ? <VolumeX /> : <Volume2 />, mute)}
          <Slider aria-label="Volume" value={[muted ? 0 : volume]} max={1} step={0.05} className="mr-3 hidden h-11 max-w-20 md:flex" onValueChange={([value = 0]) => { if (media.current) { media.current.volume = value; media.current.muted = value === 0; reveal(); } }} />
          <div className="hidden sm:flex">{actions}</div>
          <DropdownMenu onOpenChange={open => { menuOpen.current = open; reveal(); }}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" title="Configurações" aria-label="Configurações" className="size-11 shrink-0 rounded-full text-player-foreground hover:bg-player-foreground/15 hover:text-player-foreground"><Settings2 className="size-5" /></Button></DropdownMenuTrigger>
            <Menu.Portal container={fullscreen ? wrap.current : undefined}>
              <Menu.Content align="end" side="top" sideOffset={6} collisionPadding={8} className="z-50 max-h-[min(65dvh,var(--radix-dropdown-menu-content-available-height))] w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                <DropdownMenuLabel>Velocidade</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(rate)} onValueChange={value => { const video = media.current; if (video) { try { video.playbackRate = Number(value); } catch { setNotice("Esta mídia mantém a velocidade nativa."); } } }}>
                  {PLAYBACK_RATES.map(value => <DropdownMenuRadioItem key={value} value={String(value)} className="min-h-9">{value}x</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                {qualities.length > 1 && onQualityChange && <><DropdownMenuSeparator /><DropdownMenuLabel>Qualidade</DropdownMenuLabel><DropdownMenuRadioGroup value={String(quality)} onValueChange={value => onQualityChange(Number(value))}><DropdownMenuRadioItem value="-1">Auto</DropdownMenuRadioItem>{qualities.map(item => <DropdownMenuRadioItem key={item.i} value={String(item.i)}>{item.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></>}
                {servers.length > 1 && onServerChange && <><DropdownMenuSeparator /><DropdownMenuLabel>Servidores</DropdownMenuLabel><DropdownMenuRadioGroup value={selectedServer ?? ""} onValueChange={value => { const index = servers.findIndex(server => server.id === value); if (index >= 0) onServerChange(index); }}>{servers.map((server, index) => <DropdownMenuRadioItem key={server.id} value={server.id} className="min-h-10 break-words">Servidor {index + 1}{server.label && !/^Servidor \d+$/i.test(server.label) ? ` · ${server.label}` : ""}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></>}
                {actions && <div className="flex flex-wrap gap-1 p-1 sm:hidden">{actions}</div>}
              </Menu.Content>
            </Menu.Portal>
          </DropdownMenu>
          {cast && iconButton("Transmitir", <Cast />, () => { const video = media.current; if (cast === "remote") video?.remote?.prompt().catch(() => setNotice("Transmissão cancelada ou indisponível.")); else video?.webkitShowPlaybackTargetPicker?.(); })}
          {iconButton(fullscreen ? "Sair da tela cheia" : "Tela cheia", fullscreen ? <Minimize /> : <Maximize />, () => void toggleFullscreen())}
        </div>
      </div>
    </div>
    {feedback && <div key={feedback} role="status" className="pointer-events-none absolute left-1/2 top-[28%] flex -translate-x-1/2 items-center justify-center rounded-full bg-player/75 px-4 py-2 text-sm font-semibold text-primary motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">{feedback === "play" ? <Play className="size-5" /> : feedback === "pause" ? <Pause className="size-5" /> : feedback === "muted" ? <VolumeX className="size-5" /> : feedback === "sound" ? <Volume2 className="size-5" /> : feedback}</div>}
    {notice && !hasError && <p role="status" className="pointer-events-none absolute inset-x-3 top-3 rounded bg-player/85 px-3 py-1 text-center text-xs">{notice}</p>}
    {hasError && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto rounded-[inherit] bg-player/95 px-3 py-2 text-center">
      <AlertTriangle className="hidden size-6 text-primary sm:block" /><p className="text-sm font-semibold sm:text-lg">Não foi possível reproduzir este vídeo.</p>
      {servers.length > 1 && onServerChange ? <><p className="text-xs text-player-foreground/70">Tentar outro servidor</p><div className="flex max-w-full flex-wrap justify-center gap-2">{servers.map((server, index) => <Button key={server.id} variant={server.id === selectedServer ? "default" : "secondary"} size="sm" aria-pressed={server.id === selectedServer} onClick={() => onServerChange(index)}>Servidor {index + 1}</Button>)}</div></> : <Button variant="secondary" size="sm" onClick={() => { if (onRetry) onRetry(); else { const video = media.current; if (video) { setFailed(false); setWaiting(true); video.load(); video.play().catch(() => {}); } } }}>Tentar novamente</Button>}
    </div>}
  </div>;
}