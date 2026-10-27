import { useEffect, useId } from 'react';

/**
 * Process-wide signals for the auto sign-out (spec §6.1), usable outside React:
 *
 * 1. Engine work: `beginEngineWork()` around every call into the engine worker (file check, run,
 *    node preview, export). While any is pending the idle countdown is paused. EngineClient does
 *    this for every call, so callers normally need nothing else.
 *
 * 2. Unsaved changes (for the Flow Designer): `useUnsavedChanges(dirty)` / `setUnsavedChanges`.
 *    While anything is dirty the idle warning adds the "unsaved changes will be lost" line and a
 *    `beforeunload` prompt guards closing/reloading the tab. Do not add another `beforeunload`
 *    handler in the Designer: the idle sign-out calls `releaseUnsavedChangesGuard()` so that its
 *    reload is never blocked (AC-B3-85). In-app navigation blocking stays with the Designer.
 *
 * Only counters and flags live here: never data, never timestamps of user actions.
 */

type Listener = () => void;

// ---- engine work -------------------------------------------------------------------------------

let engineWork = 0;
const engineListeners = new Set<Listener>();

export function beginEngineWork(): () => void {
  engineWork++;
  if (engineWork === 1) for (const l of engineListeners) l();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    engineWork--;
    if (engineWork === 0) for (const l of engineListeners) l();
  };
}

export function isEngineBusy(): boolean {
  return engineWork > 0;
}

/** Called when the engine goes from idle to busy or back. */
export function subscribeEngineWork(listener: Listener): () => void {
  engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

// ---- unsaved changes -------------------------------------------------------------------------

const dirtySources = new Set<string>();
const unsavedListeners = new Set<Listener>();
let guardReleased = false;

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (guardReleased || dirtySources.size === 0) return;
  e.preventDefault();
  // Older browsers need returnValue set to show the prompt.
  e.returnValue = '';
}

/** Mark a source (e.g. "designer") as having (or no longer having) unsaved changes. */
export function setUnsavedChanges(source: string, dirty: boolean): void {
  const before = dirtySources.size;
  if (dirty) dirtySources.add(source);
  else dirtySources.delete(source);
  if (typeof window !== 'undefined') {
    if (before === 0 && dirtySources.size > 0) {
      window.addEventListener('beforeunload', onBeforeUnload);
    } else if (before > 0 && dirtySources.size === 0) {
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
  }
  if (before !== dirtySources.size) for (const l of unsavedListeners) l();
}

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0;
}

export function subscribeUnsavedChanges(listener: Listener): () => void {
  unsavedListeners.add(listener);
  return () => unsavedListeners.delete(listener);
}

/** Forced sign-out: the following page load must not be held up by the unsaved-changes prompt. */
export function releaseUnsavedChangesGuard(): void {
  guardReleased = true;
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
}

/** React binding for a screen with an editable document (the Designer). */
export function useUnsavedChanges(dirty: boolean): void {
  const source = useId();
  useEffect(() => {
    setUnsavedChanges(source, dirty);
    return () => setUnsavedChanges(source, false);
  }, [source, dirty]);
}

/** Tests only: back to the initial state. */
export function resetActivityForTests(): void {
  engineWork = 0;
  engineListeners.clear();
  for (const s of [...dirtySources]) setUnsavedChanges(s, false);
  unsavedListeners.clear();
  guardReleased = false;
}
