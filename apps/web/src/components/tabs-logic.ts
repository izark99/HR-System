/**
 * Keyboard of a horizontal tab list (WAI-ARIA APG tabs, automatic activation): the index of the tab
 * that a key selects and focuses, or `null` when the key is not handled. ArrowRight / ArrowLeft
 * wrap around; Home / End jump to the first / last tab. Disabled tabs are skipped.
 */
export function tabKeyTarget(
  key: string,
  current: number,
  count: number,
  disabled: (index: number) => boolean = () => false,
): number | null {
  if (count <= 0) return null;
  const enabled = Array.from({ length: count }, (_, i) => i).filter((i) => !disabled(i));
  if (enabled.length === 0) return null;
  const step = (from: number, delta: 1 | -1): number => {
    let i = from;
    for (let n = 0; n < count; n++) {
      i = (i + delta + count) % count;
      if (!disabled(i)) return i;
    }
    return from;
  };
  switch (key) {
    case 'ArrowRight':
      return step(current, 1);
    case 'ArrowLeft':
      return step(current, -1);
    case 'Home':
      return enabled[0]!;
    case 'End':
      return enabled[enabled.length - 1]!;
    default:
      return null;
  }
}

/** ids tying a tab to its panel (`aria-controls` / `aria-labelledby`). */
export function tabIds(base: string, item: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${item}`, panel: `${base}-panel-${item}` };
}
