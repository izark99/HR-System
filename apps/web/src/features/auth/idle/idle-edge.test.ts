/** Edge cases of the auto sign-out state machine (spec §6.1) beyond idle-timer.test.ts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_LIMIT_MS, IdleTimer } from './idle-timer';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function make() {
  const onSignOut = vi.fn();
  const timer = new IdleTimer({
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onSignOut,
  });
  return { timer, onSignOut };
}

describe('IdleTimer edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T01:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the warning appears exactly at 7h55, not one millisecond before', () => {
    const { timer } = make();
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN - 1);
    expect(timer.getSnapshot().phase).toBe('active');
    vi.advanceTimersByTime(1);
    expect(timer.getSnapshot().phase).toBe('warning');
    expect(IDLE_LIMIT_MS).toBe(8 * HOUR);
  });

  it('sign-out fires exactly at 8h, once, even if check() is called again afterwards', () => {
    const { timer, onSignOut } = make();
    vi.advanceTimersByTime(8 * HOUR - 1);
    expect(onSignOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    timer.check();
    timer.activity();
    timer.extend();
    vi.advanceTimersByTime(24 * HOUR);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(timer.getSnapshot()).toEqual({ phase: 'signedOut', deadline: null });
  });

  it('"Tiếp tục làm việc" one second before the deadline still extends; one second after signs out', () => {
    const a = make();
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    vi.setSystemTime(Date.now() + 5 * MIN - 1000);
    a.timer.extend();
    expect(a.onSignOut).not.toHaveBeenCalled();
    expect(a.timer.getSnapshot().phase).toBe('active');

    const b = make();
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    vi.setSystemTime(Date.now() + 5 * MIN + 1000);
    b.timer.extend();
    expect(b.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('visibility check inside the warning window shows the warning with the REAL remaining time', () => {
    const { timer } = make();
    const start = Date.now();
    vi.setSystemTime(start + 7 * HOUR + 56 * MIN);
    timer.check();
    expect(timer.getSnapshot()).toEqual({ phase: 'warning', deadline: start + 8 * HOUR });
  });

  it('busy for 9 hours starting inside the warning window: no sign-out, fresh 8 hours afterwards', () => {
    const { timer, onSignOut } = make();
    vi.advanceTimersByTime(7 * HOUR + 58 * MIN);
    expect(timer.getSnapshot().phase).toBe('warning');
    const end = timer.beginBusy();
    vi.advanceTimersByTime(9 * HOUR);
    timer.check(); // visibilitychange while busy
    expect(onSignOut).not.toHaveBeenCalled();
    end();
    const done = Date.now();
    expect(timer.getSnapshot()).toEqual({ phase: 'active', deadline: done + 8 * HOUR });
    vi.advanceTimersByTime(7 * HOUR + 54 * MIN);
    expect(timer.getSnapshot().phase).toBe('active');
  });

  it('activity while busy is ignored but does not shorten the restart: the countdown restarts at the END of the work', () => {
    const { timer } = make();
    const end = timer.beginBusy();
    vi.advanceTimersByTime(HOUR);
    timer.activity();
    vi.advanceTimersByTime(HOUR);
    end();
    expect(timer.getSnapshot().deadline).toBe(Date.now() + 8 * HOUR);
  });

  it('a second task started right after the first ended keeps the countdown paused', () => {
    const { timer, onSignOut } = make();
    const first = timer.beginBusy();
    first();
    const second = timer.beginBusy();
    vi.advanceTimersByTime(10 * HOUR);
    expect(onSignOut).not.toHaveBeenCalled();
    second();
    expect(timer.getSnapshot().phase).toBe('active');
  });

  it('work that ends after sign-out (late worker answer) does not revive the session', () => {
    const { timer, onSignOut } = make();
    const end = timer.beginBusy();
    end();
    vi.advanceTimersByTime(8 * HOUR);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    const late = timer.beginBusy();
    late();
    expect(timer.getSnapshot().phase).toBe('signedOut');
  });

  it('the snapshot object is stable between changes (required by useSyncExternalStore)', () => {
    const { timer } = make();
    const first = timer.getSnapshot();
    expect(timer.getSnapshot()).toBe(first);
    const listener = vi.fn();
    const off = timer.subscribe(listener);
    vi.advanceTimersByTime(HOUR);
    timer.check();
    expect(timer.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('listeners hear every phase change in order and unsubscribe works', () => {
    const { timer } = make();
    const phases: string[] = [];
    const off = timer.subscribe(() => phases.push(timer.getSnapshot().phase));
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    timer.extend();
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    off();
    vi.advanceTimersByTime(5 * MIN);
    expect(phases).toEqual(['warning', 'active', 'warning']);
  });

  it('a wall clock that goes backwards never signs out early', () => {
    const { timer, onSignOut } = make();
    vi.setSystemTime(Date.now() - 3 * HOUR);
    timer.check();
    timer.activity();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(timer.getSnapshot().phase).toBe('active');
  });

  it('many activity events within 30 s cause one restart; the deadline moves only on recorded ones', () => {
    const { timer } = make();
    vi.advanceTimersByTime(HOUR);
    timer.activity();
    const d1 = timer.getSnapshot().deadline;
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(1000);
      timer.activity();
    }
    expect(timer.getSnapshot().deadline).toBe(d1);
    vi.advanceTimersByTime(11 * 1000);
    timer.activity();
    expect(timer.getSnapshot().deadline).toBeGreaterThan(d1!);
  });
});
