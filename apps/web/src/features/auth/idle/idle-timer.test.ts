/** Auto sign-out state machine (spec §6.1, AC-B3-80..87) on fake timers and a fake wall clock. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginEngineWork,
  hasUnsavedChanges,
  isEngineBusy,
  releaseUnsavedChangesGuard,
  resetActivityForTests,
  setUnsavedChanges,
  subscribeEngineWork,
} from './activity';
import { ACTIVITY_THROTTLE_MS, IdleTimer } from './idle-timer';

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

describe('IdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T01:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns at 7h55 with the deadline 5 minutes later (AC-B3-80)', () => {
    const { timer, onSignOut } = make();
    const start = Date.now();
    vi.advanceTimersByTime(7 * HOUR + 54 * MIN);
    expect(timer.getSnapshot().phase).toBe('active');
    vi.advanceTimersByTime(MIN);
    expect(timer.getSnapshot()).toEqual({ phase: 'warning', deadline: start + 8 * HOUR });
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('"Tiếp tục làm việc" restarts the full 8 hours; moving the mouse during the warning does not (AC-B3-81)', () => {
    const { timer, onSignOut } = make();
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    timer.activity(); // pointermove while the dialog is open
    expect(timer.getSnapshot().phase).toBe('warning');
    vi.advanceTimersByTime(MIN);
    timer.extend();
    expect(timer.getSnapshot().phase).toBe('active');
    vi.advanceTimersByTime(7 * HOUR + 54 * MIN);
    expect(timer.getSnapshot().phase).toBe('active');
    vi.advanceTimersByTime(MIN);
    expect(timer.getSnapshot().phase).toBe('warning');
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('signs out once at 8h without a click (AC-B3-82)', () => {
    const { timer, onSignOut } = make();
    vi.advanceTimersByTime(8 * HOUR - 1);
    expect(onSignOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(timer.getSnapshot()).toEqual({ phase: 'signedOut', deadline: null });
    timer.activity();
    timer.extend();
    timer.check();
    vi.advanceTimersByTime(10 * HOUR);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('activity at 7h restarts the countdown: no warning at 7h55 (AC-B3-83)', () => {
    const { timer } = make();
    vi.advanceTimersByTime(7 * HOUR);
    timer.activity();
    vi.advanceTimersByTime(55 * MIN);
    expect(timer.getSnapshot().phase).toBe('active');
    vi.advanceTimersByTime(7 * HOUR);
    expect(timer.getSnapshot().phase).toBe('warning');
  });

  it('activity is recorded at most once per 30 seconds', () => {
    const { timer } = make();
    const start = Date.now();
    timer.activity();
    vi.advanceTimersByTime(ACTIVITY_THROTTLE_MS - 1000);
    timer.activity(); // throttled: deadline unchanged
    expect(timer.getSnapshot().deadline).toBe(start + 8 * HOUR);
    vi.advanceTimersByTime(1000);
    timer.activity();
    expect(timer.getSnapshot().deadline).toBe(start + ACTIVITY_THROTTLE_MS + 8 * HOUR);
  });

  it('engine work pauses the countdown; it restarts when the work ends (AC-B3-84)', () => {
    const { timer, onSignOut } = make();
    vi.advanceTimersByTime(HOUR);
    const end = timer.beginBusy();
    const endPreview = timer.beginBusy(); // overlapping work (e.g. a preview)
    expect(timer.getSnapshot().phase).toBe('busy');
    vi.advanceTimersByTime(9 * HOUR);
    expect(onSignOut).not.toHaveBeenCalled();
    end();
    end(); // idempotent
    expect(timer.getSnapshot().phase).toBe('busy');
    endPreview();
    const finished = Date.now();
    expect(timer.getSnapshot()).toEqual({ phase: 'active', deadline: finished + 8 * HOUR });
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN);
    expect(timer.getSnapshot().phase).toBe('warning');
    vi.advanceTimersByTime(5 * MIN);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('engine work starting while the warning is open closes it', () => {
    const { timer } = make();
    vi.advanceTimersByTime(7 * HOUR + 56 * MIN);
    expect(timer.getSnapshot().phase).toBe('warning');
    const end = timer.beginBusy();
    vi.advanceTimersByTime(HOUR);
    end();
    expect(timer.getSnapshot().phase).toBe('active');
  });

  it('asleep / hidden for 9 hours: signs out on the first check, without a warning (AC-B3-86)', () => {
    const { timer, onSignOut } = make();
    const phases: string[] = [];
    timer.subscribe(() => phases.push(timer.getSnapshot().phase));
    // Wall clock jumps; the pending timer has not fired yet (suspended machine).
    vi.setSystemTime(Date.now() + 9 * HOUR);
    timer.check(); // visibilitychange → visible
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['signedOut']);
  });

  it('a late timer (throttled background tab) also signs out directly', () => {
    const { onSignOut, timer } = make();
    const phases: string[] = [];
    timer.subscribe(() => phases.push(timer.getSnapshot().phase));
    vi.setSystemTime(Date.now() + 9 * HOUR);
    vi.advanceTimersByTime(7 * HOUR + 55 * MIN); // the 7h55 timer fires, 9h+ later in real time
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['signedOut']);
  });

  it('an interaction after waking up past 8 hours does not revive the session', () => {
    const { timer, onSignOut } = make();
    vi.setSystemTime(Date.now() + 8 * HOUR + MIN);
    timer.activity();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('two tabs have independent timers (AC-B3-87)', () => {
    const a = make();
    const b = make();
    vi.advanceTimersByTime(7 * HOUR);
    a.timer.activity();
    vi.advanceTimersByTime(HOUR);
    expect(a.onSignOut).not.toHaveBeenCalled();
    expect(b.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('dispose stops every timer', () => {
    const { timer, onSignOut } = make();
    timer.dispose();
    vi.advanceTimersByTime(24 * HOUR);
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe('activity signals', () => {
  afterEach(() => resetActivityForTests());

  it('engine work counts overlapping calls and notifies on idle/busy transitions only', () => {
    const changes: boolean[] = [];
    subscribeEngineWork(() => changes.push(isEngineBusy()));
    const a = beginEngineWork();
    const b = beginEngineWork();
    a();
    a();
    expect(isEngineBusy()).toBe(true);
    b();
    expect(isEngineBusy()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('unsaved changes install a beforeunload prompt that a forced sign-out releases (AC-B3-85)', () => {
    // Node test environment: a bare EventTarget stands in for window.
    vi.stubGlobal('window', new EventTarget());
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    setUnsavedChanges('designer', true);
    setUnsavedChanges('designer', true);
    expect(hasUnsavedChanges()).toBe(true);
    expect(add.mock.calls.filter(([t]) => t === 'beforeunload')).toHaveLength(1);
    const handler = add.mock.calls.find(([t]) => t === 'beforeunload')![1] as (e: Event) => void;

    const prompt = new Event('beforeunload', { cancelable: true });
    handler(prompt);
    expect(prompt.defaultPrevented).toBe(true);

    releaseUnsavedChangesGuard();
    expect(remove.mock.calls.some(([t]) => t === 'beforeunload')).toBe(true);
    const after = new Event('beforeunload', { cancelable: true });
    handler(after);
    expect(after.defaultPrevented).toBe(false);
    // The idle warning still knows about the unsaved work.
    expect(hasUnsavedChanges()).toBe(true);
    add.mockRestore();
    remove.mockRestore();
    vi.unstubAllGlobals();
  });
});
