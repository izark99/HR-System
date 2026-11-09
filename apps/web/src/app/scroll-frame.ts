/**
 * Keyboard scrolling of the page's scroll frame (spec §32 AC-SB-07/08). From 768px the window no
 * longer scrolls: the area below the top bar (`[data-scroll-frame]`) does. Browsers scroll with
 * Space / PageDown / Home / End… from the focused element; with nothing focused (the body, e.g.
 * right after a page load) they try the window and nothing moves. On such a key the content
 * (`main#main`, focusable with tabindex -1) takes the focus first, without moving, so the
 * browser's own scrolling then applies to the frame around it (same steps and smoothness).
 */

/** Keys a browser uses to scroll the page when nothing is focused. */
export const SCROLL_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  'ArrowDown',
  'ArrowUp',
]);

interface FrameLike {
  scrollHeight: number;
  clientHeight: number;
}

interface KeyLike {
  key: string;
  target: unknown;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Whether the key should scroll the frame: a scroll key without a modifier (Shift + Space scrolls
 * up and is kept), sent to the body (nothing focused), while the frame has more content than it
 * shows. `isFrame`: the frame is a scroll area at this width (below 768px the page scrolls).
 */
export function shouldFocusContent(
  e: KeyLike,
  body: unknown,
  frame: FrameLike | null,
  isFrame: boolean,
): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false;
  if (!SCROLL_KEYS.has(e.key) || e.target !== body) return false;
  return frame !== null && isFrame && frame.scrollHeight > frame.clientHeight;
}

/** Installs the handler on `doc`; returns the clean-up. */
export function installFrameKeyScroll(doc: Document): () => void {
  const onKey = (e: KeyboardEvent) => {
    const frame = doc.querySelector<HTMLElement>('[data-scroll-frame]');
    const isFrame = frame !== null && /(auto|scroll)/.test(getComputedStyle(frame).overflowY);
    if (!shouldFocusContent(e, doc.body, frame, isFrame)) return;
    frame?.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}
