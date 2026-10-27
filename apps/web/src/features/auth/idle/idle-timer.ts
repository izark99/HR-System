/**
 * Auto sign-out after 8 hours without interaction (spec §6.1, MEMORY 2026-10-26 22:52).
 *
 * Pure state machine on an injectable clock and timer, so it is tested with fake timers and has
 * no DOM dependency (the React component wires the browser events to it):
 * - `activity()`: pointer / key / wheel / scroll / touch in this tab, throttled to one record per
 *   30 s; ignored while the warning is open (only "Tiếp tục làm việc" extends then).
 * - `beginBusy()`: engine work (file check, run, node preview, export) pauses the countdown;
 *   when the last task ends the countdown restarts from that moment.
 * - wall clock: every check compares `now()` with the last activity, so a timer that fires late
 *   (tab in background, laptop asleep) or `check()` on `visibilitychange` signs out at once when
 *   8 hours have passed, without showing the 5-minute warning first.
 * Nothing is persisted: the last activity time lives in memory only.
 */

export const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000;
export const WARNING_BEFORE_MS = 5 * 60 * 1000;
export const ACTIVITY_THROTTLE_MS = 30 * 1000;

export type IdlePhase = 'active' | 'warning' | 'busy' | 'signedOut';

export interface IdleSnapshot {
  phase: IdlePhase;
  /** Epoch ms at which the session ends if nothing happens (null while busy / signed out). */
  deadline: number | null;
}

export interface IdleTimerDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Called once, when the limit is reached. */
  onSignOut: () => void;
}

export class IdleTimer {
  private lastActivity: number;
  private lastRecorded = Number.NEGATIVE_INFINITY;
  private busy = 0;
  private phase: IdlePhase = 'active';
  private timer: unknown = null;
  private snapshot: IdleSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: IdleTimerDeps) {
    this.lastActivity = deps.now();
    this.snapshot = { phase: 'active', deadline: this.lastActivity + IDLE_LIMIT_MS };
    this.schedule();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): IdleSnapshot => this.snapshot;

  /** User interaction in this tab. */
  activity(): void {
    if (this.phase !== 'active') return;
    const now = this.deps.now();
    if (now - this.lastRecorded < ACTIVITY_THROTTLE_MS) return;
    // The wall clock may already be past the limit (event right after waking up).
    if (now - this.lastActivity >= IDLE_LIMIT_MS) {
      this.check();
      return;
    }
    this.lastRecorded = now;
    this.restartFrom(now);
  }

  /** "Tiếp tục làm việc" in the warning dialog. */
  extend(): void {
    if (this.phase !== 'warning') return;
    const now = this.deps.now();
    if (now - this.lastActivity >= IDLE_LIMIT_MS) {
      this.check();
      return;
    }
    this.lastRecorded = now;
    this.restartFrom(now);
  }

  /**
   * Engine work started; call the returned function when it ends (idempotent). Pauses the
   * countdown (and closes an open warning: nobody is idle while their flow runs).
   */
  beginBusy(): () => void {
    if (this.phase === 'signedOut') return () => undefined;
    this.busy++;
    if (this.busy === 1) {
      this.clear();
      this.setPhase('busy');
    }
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.busy--;
      if (this.busy === 0 && this.phase === 'busy') this.restartFrom(this.deps.now());
    };
  }

  /** Re-evaluate against the wall clock (timer fired, tab visible again). */
  check(): void {
    if (this.phase === 'signedOut' || this.phase === 'busy') return;
    const idle = this.deps.now() - this.lastActivity;
    if (idle >= IDLE_LIMIT_MS) {
      this.clear();
      this.setPhase('signedOut');
      this.deps.onSignOut();
      return;
    }
    if (idle >= IDLE_LIMIT_MS - WARNING_BEFORE_MS) this.setPhase('warning');
    this.schedule();
  }

  /** Stop all timers (component unmounted / signed out by other means). */
  dispose(): void {
    this.clear();
    this.listeners.clear();
  }

  private restartFrom(at: number): void {
    this.lastActivity = at;
    this.phase = 'active';
    this.publish();
    this.schedule();
  }

  private schedule(): void {
    this.clear();
    if (this.phase === 'busy' || this.phase === 'signedOut') return;
    const milestone =
      this.phase === 'warning'
        ? this.lastActivity + IDLE_LIMIT_MS
        : this.lastActivity + IDLE_LIMIT_MS - WARNING_BEFORE_MS;
    const wait = Math.max(0, milestone - this.deps.now());
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.check();
    }, wait);
  }

  private clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private setPhase(phase: IdlePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.publish();
  }

  private publish(): void {
    const deadline =
      this.phase === 'active' || this.phase === 'warning'
        ? this.lastActivity + IDLE_LIMIT_MS
        : null;
    if (this.snapshot.phase === this.phase && this.snapshot.deadline === deadline) return;
    this.snapshot = { phase: this.phase, deadline };
    for (const l of this.listeners) l();
  }
}
