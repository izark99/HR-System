/**
 * Roving focus inside a menu (WAI-ARIA APG menu pattern): the index the focus moves to for a key,
 * or `null` when the key does not move it. Arrows wrap; Home / End jump to the ends.
 */
export function menuKeyTarget(key: string, active: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return active >= last ? 0 : active + 1;
    case 'ArrowUp':
      return active <= 0 ? last : active - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** Destructive items last (spec §25.3), keeping the given order inside each part. */
export function orderMenuItems<T extends { danger?: boolean }>(items: readonly T[]): T[] {
  return [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
}
