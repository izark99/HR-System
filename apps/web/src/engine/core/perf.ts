/**
 * Stage timings of a run (spec §31, AC-PF-01): recorded as User Timing measures named
 * `hrflow:<stage>` in the worker, so the opt-in perf E2E can read them (CDP / worker.evaluate).
 * Only stage names and durations: never data, file names or counts.
 */
export type PerfStage = 'read' | 'upload' | 'sql' | 'write' | 'run';

export const PERF_PREFIX = 'hrflow:';

const STAGES: readonly PerfStage[] = ['read', 'upload', 'sql', 'write', 'run'];

function timeline(): Performance | null {
  return typeof performance !== 'undefined' && typeof performance.measure === 'function'
    ? performance
    : null;
}

export function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Record `[start, now]` as one measure of `stage`. */
export function perfMeasure(stage: PerfStage, start: number): void {
  const p = timeline();
  if (!p) return;
  try {
    p.measure(PERF_PREFIX + stage, { start, end: p.now() });
  } catch {
    // Timing is best effort; it never fails a run.
  }
}

/** Forget the measures of earlier runs / reads (bounded buffer). */
export function perfClear(stages: readonly PerfStage[] = STAGES): void {
  const p = timeline();
  if (!p || typeof p.clearMeasures !== 'function') return;
  for (const s of stages) p.clearMeasures(PERF_PREFIX + s);
}
