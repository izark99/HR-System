/**
 * Validity ranges of published versions (spec §14.1, §14.4): `[effective_from, effective_to)`,
 * dates as YYYY-MM-DD strings (compared as strings), `effective_to = null` = open-ended.
 * Pure functions for the timeline, gap warnings, the publish preview and overlap messages.
 */

export type VersionStatus = 'draft' | 'published' | 'retired';

export interface RangeVersion {
  id: string;
  versionNo: number;
  status: VersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** A period without any published version: `[from, to)`, `to = null` = from then on. */
export interface Gap {
  from: string;
  to: string | null;
}

/** Published versions with a start date, oldest first. */
export function publishedRanges<T extends RangeVersion>(versions: readonly T[]): T[] {
  return versions
    .filter((v) => v.status === 'published' && v.effectiveFrom)
    .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!));
}

export function isEffectiveOn(v: RangeVersion, day: string): boolean {
  return (
    v.status === 'published' &&
    v.effectiveFrom !== null &&
    v.effectiveFrom <= day &&
    (v.effectiveTo === null || v.effectiveTo > day)
  );
}

/**
 * Gaps between consecutive published ranges, and after the last one when it has an end date.
 * (Before the first version is not a gap: the flow simply did not exist yet.)
 */
export function findGaps(versions: readonly RangeVersion[]): Gap[] {
  const list = publishedRanges(versions);
  const gaps: Gap[] = [];
  let reach: string | null | undefined; // furthest covered end so far; null = open-ended
  for (const v of list) {
    if (reach !== undefined && reach !== null && reach < v.effectiveFrom!) {
      gaps.push({ from: reach, to: v.effectiveFrom! });
    }
    if (reach === undefined) reach = v.effectiveTo;
    else if (reach !== null)
      reach = v.effectiveTo === null || v.effectiveTo > reach ? v.effectiveTo : reach;
  }
  if (reach !== undefined && reach !== null) gaps.push({ from: reach, to: null });
  return gaps;
}

const gapKey = (g: Gap) => `${g.from}/${g.to ?? ''}`;

/** Versions after publishing `draftId` with the given range (and closing the open version). */
export function simulatePublish<T extends RangeVersion>(
  versions: readonly T[],
  draftId: string,
  from: string,
  to: string | null,
  closePrevious: boolean,
): T[] {
  return versions.map((v) => {
    if (v.id === draftId)
      return { ...v, status: 'published', effectiveFrom: from, effectiveTo: to };
    if (
      closePrevious &&
      v.status === 'published' &&
      v.effectiveTo === null &&
      v.effectiveFrom !== null &&
      v.effectiveFrom < from
    ) {
      return { ...v, effectiveTo: from };
    }
    return v;
  });
}

/** Gaps that exist after `next` but not in `current` (what a publish / date change creates). */
export function newGaps(current: readonly RangeVersion[], next: readonly RangeVersion[]): Gap[] {
  const before = new Set(findGaps(current).map(gapKey));
  return findGaps(next).filter((g) => !before.has(gapKey(g)));
}

/** The open-ended published version a publish from `from` would close (spec §14.1). */
export function openPreviousVersion<T extends RangeVersion>(
  versions: readonly T[],
  from: string,
): T | undefined {
  return versions.find(
    (v) =>
      v.status === 'published' &&
      v.effectiveTo === null &&
      v.effectiveFrom !== null &&
      (from === '' || v.effectiveFrom < from),
  );
}

/** First published version (other than `exceptId`) whose range overlaps `[from, to)`. */
export function findOverlap<T extends RangeVersion>(
  versions: readonly T[],
  from: string,
  to: string | null,
  exceptId?: string,
): T | undefined {
  return publishedRanges(versions).find(
    (v) =>
      v.id !== exceptId &&
      (to === null || v.effectiveFrom! < to) &&
      (v.effectiveTo === null || v.effectiveTo > from),
  );
}

/** YYYY-MM-DD minus one day (the last day of a gap, for "đến dd/MM/yyyy"). */
export function previousDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}
