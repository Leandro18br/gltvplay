export type Direction = "up" | "down" | "left" | "right";
export type FocusRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function remoteKey(event: Pick<KeyboardEvent, "key" | "keyCode">) {
  const aliases: Record<string, string> = { Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Select: "Enter", OK: "Enter", GoBack: "Escape", BrowserBack: "Escape", Back: "Escape" };
  const codes: Record<number, string> = { 19: "ArrowUp", 20: "ArrowDown", 21: "ArrowLeft", 22: "ArrowRight", 23: "Enter", 461: "Escape", 10009: "Escape" };
  return aliases[event.key] ?? (event.key && event.key !== "Unidentified" ? event.key : codes[event.keyCode] ?? event.key);
}

export function directionScore(from: FocusRect, to: FocusRect, direction: Direction) {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const x = (from.left + from.right) / 2, y = (from.top + from.bottom) / 2;
  const dx = (to.left + to.right) / 2 - x, dy = (to.top + to.bottom) / 2 - y;
  const forward = (horizontal ? dx : dy) * sign;
  if (forward <= 2) return Infinity;
  const cross = horizontal ? Math.max(0, from.top - to.bottom, to.top - from.bottom) : Math.max(0, from.left - to.right, to.left - from.right);
  // Prefer overlap in the perpendicular axis; then distance. No wrapping at row edges.
  return forward + cross * 5 + Math.abs(horizontal ? dy : dx) * 0.2;
}

export function isEditing(element: Element | null) {
  return !!element?.closest('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export const FOCUSABLE = 'a[href], button, input, select, textarea, video[controls], iframe, [tabindex="0"], [role="slider"], [role="menuitem"], [role="option"]';

export function navigable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => {
    if (element.tabIndex < 0 || element.matches(':disabled, [aria-disabled="true"]') || element.closest('[hidden], [inert], [aria-hidden="true"], [data-remote-skip]')) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export function directionalTarget(current: HTMLElement, candidates: HTMLElement[], direction: Direction) {
  const row = current.closest('[data-remote-row]');
  const horizontal = direction === "left" || direction === "right";
  const pool = row && horizontal ? candidates.filter(item => row.contains(item) && (current.matches('a[data-remote-id]') ? item.matches('a[data-remote-id]') : true)) : candidates;
  let best: HTMLElement | undefined, score = Infinity;
  for (const item of pool) {
    if (item === current || current.contains(item) || item.contains(current)) continue;
    const next = directionScore(current.getBoundingClientRect(), item.getBoundingClientRect(), direction);
    if (next < score) { best = item; score = next; }
  }
  return best;
}