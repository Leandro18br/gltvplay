import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { directionalTarget, isEditing, navigable, remoteKey, type Direction } from "@/lib/navigation/spatial";

type SavedFocus = { key: string; index: number; x: number; y: number; rows: number[] };
const excluded = (path: string) => /^\/(admin|revenda|revendedor|reset-password)(\/|$)/.test(path);
const widget = '[role="menu"], [role="listbox"], [role="slider"], [role="tablist"], video[controls], [data-remote-native]';
const overlay = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

// DOM measurements are made only on a keypress, so live catalog updates never reposition an existing focus.
export function RemoteNavigation() {
  const router = useRouter();
  useEffect(() => {
    let remote = false, route = location.pathname + location.search;
    let last: HTMLElement | null = null, pending: SavedFocus | undefined;
    const saved = new Map<string, SavedFocus>();
    const publicArea = () => !excluded(location.pathname);
    const keyFor = (element: HTMLElement) => {
      const section = element.closest('section')?.getAttribute('aria-label') ?? "";
      if (element.dataset['remoteId']) return `${section}|${element.dataset['remoteId']}`;
      return `${section}|${element.dataset['remoteId'] ?? element.getAttribute('href') ?? element.id ?? ""}|${element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ""}`;
    };
    const scope = (): ParentNode => {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(overlay)).filter(el => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== 'hidden');
      const top = overlays[overlays.length - 1];
      if (top) return top;
      const fs = document.fullscreenElement;
      if (fs && fs !== document.documentElement) return fs;
      if (fs) return document.querySelector('[data-remote-player]') ?? document;
      return document;
    };
    const focus = (element: HTMLElement) => {
      try { element.focus({ preventScroll: true }); } catch { element.focus(); }
      last = element;
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    };
    const recover = () => {
      if (!remote || !publicArea()) return;
      const items = navigable(scope());
      if (!items.length) return;
      if (pending) {
        const target = items.find(el => keyFor(el) === pending?.key);
        if (!target && !document.querySelector('main h1, main [data-remote-row]')) return;
        document.querySelectorAll<HTMLElement>('[data-remote-row]').forEach((row, i) => { row.scrollLeft = pending?.rows[i] ?? 0; });
        window.scrollTo(pending.x, pending.y);
        const fallback = items[Math.max(0, Math.min(pending.index, items.length - 1))];
        pending = undefined;
        const restored = target ?? fallback;
        if (restored) focus(restored);
      } else if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected || document.activeElement.matches(':disabled')) {
        const player = document.querySelector('[data-remote-player]');
        const primary = player ? items.find(el => player.contains(el) && /Reproduzir|Pausar/.test(el.getAttribute('aria-label') ?? '')) : undefined;
        const target = primary ?? items.find(el => el.closest('main')) ?? items[0];
        if (target) focus(target);
      }
    };
    const onFocus = (event: FocusEvent) => { if (event.target instanceof HTMLElement) last = event.target; };
    const enable = () => { remote = true; document.documentElement.dataset['remoteNavigation'] = 'true'; };
    const pointer = () => { pending = undefined; remote = false; delete document.documentElement.dataset['remoteNavigation']; };
    const back = (event: KeyboardEvent) => {
      if (event.repeat) { event.preventDefault(); return; }
      const active = document.activeElement;
      const player = active?.closest('[data-remote-player]') ?? document.querySelector('[data-remote-player]');
      if (player && !player.dispatchEvent(new CustomEvent('gltv:remote-back', { bubbles: true, cancelable: true }))) { event.preventDefault(); return; }
      const link = document.querySelector<HTMLAnchorElement>('[data-remote-back], a[aria-label="Voltar"]');
      if (link) { event.preventDefault(); link.click(); return; }
      // A single back action, with no history interception or permanent browser lock.
      if (router.history.canGoBack()) { event.preventDefault(); router.history.back(); }
    };
    const normalize = (event: KeyboardEvent) => {
      if (!publicArea() || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const key = remoteKey(event);
      if (isEditing(event.target instanceof Element ? event.target : null)) {
        if (key === 'Escape' && !event.repeat) {
          event.preventDefault(); event.stopPropagation(); enable();
          const target = navigable(scope()).find(element => !isEditing(element) && element.closest('main')) ?? navigable(scope()).find(element => !isEditing(element));
          if (target) focus(target);
        }
        return;
      }
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Backspace'].includes(key)) return;
      enable();
      // Enter finishes editing a slider; its arrow keys continue to change its native value.
      if (key === 'Enter' && document.activeElement?.matches('[role="slider"]')) {
        const items = navigable(scope()), index = items.indexOf(document.activeElement as HTMLElement);
        const next = items.slice(index + 1).find(item => !item.matches('[role="slider"]'));
        if (next) { event.preventDefault(); event.stopPropagation(); focus(next); }
        return;
      }
      // Radix retains its own focus management, selection and dismissal.
      if ((key === 'Backspace' || key === 'Escape') && document.querySelector(overlay)) {
        if (event.repeat) { event.preventDefault(); event.stopPropagation(); return; }
        if (event.key !== 'Escape') { event.preventDefault(); event.stopPropagation(); (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }
        return;
      }
      if (key !== event.key && key !== 'Escape') {
        event.preventDefault(); event.stopPropagation();
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        if (key === 'Enter' && !event.repeat && !document.activeElement?.closest(widget)) (document.activeElement as HTMLElement | null)?.click();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (!publicArea() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditing(event.target instanceof Element ? event.target : null)) return;
      const key = remoteKey(event);
      if (key === 'Escape' || key === 'Backspace') { if (!document.querySelector(overlay)) back(event); return; }
      const directions: Record<string, Direction> = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
      const direction = directions[key];
      if (!direction) return;
      if (document.activeElement?.closest(widget)) return;
      enable();
      const items = navigable(scope());
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      event.preventDefault();
      if (!current || !items.includes(current)) { recover(); return; }
      const next = directionalTarget(current, items, direction);
      if (next) focus(next);
    };
    const before = router.subscribe('onBeforeNavigate', () => {
      if (!remote || !last || !publicArea()) return;
      saved.set(route, { key: keyFor(last), index: navigable(document).indexOf(last), x: window.scrollX, y: window.scrollY, rows: Array.from(document.querySelectorAll<HTMLElement>('[data-remote-row]')).map(row => row.scrollLeft) });
      if (saved.size > 40) { const oldest = saved.keys().next().value; if (oldest) saved.delete(oldest); }
    });
    const resolved = router.subscribe('onResolved', () => {
      const next = location.pathname + location.search;
      if (next === route) return;
      route = next;
      if (remote && publicArea() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      last = null;
      pending = saved.get(route);
      requestAnimationFrame(recover);
    });
    const observer = new MutationObserver(() => { if (remote) requestAnimationFrame(recover); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('keydown', normalize, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', pointer, true);
    return () => { before(); resolved(); observer.disconnect(); document.removeEventListener('keydown', normalize, true); document.removeEventListener('keydown', onKey); document.removeEventListener('focusin', onFocus); document.removeEventListener('pointerdown', pointer, true); delete document.documentElement.dataset['remoteNavigation']; };
  }, [router]);
  return null;
}