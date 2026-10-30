import { useEffect, useRef, useState } from 'react';
import type { DesignCheckResult } from '../../engine/design';
import { EngineClient, EngineCrashedError } from '../runner/engine-client';

export const CHECK_DEBOUNCE_MS = 300;

/**
 * Realtime engine check of the definition on the canvas (spec §13.2, §15.3): debounced, run in
 * the engine worker of this Designer, only the latest answer is kept. The worker holds no file
 * here (configuration only); it is terminated when the Designer closes.
 */
export function useDesignCheck(definition: unknown): {
  result: DesignCheckResult | null;
  checking: boolean;
  failed: boolean;
} {
  const clientRef = useRef<EngineClient | null>(null);
  const seq = useRef(0);
  const [result, setResult] = useState<DesignCheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const client = new EngineClient();
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setChecking(true);
    const timer = setTimeout(() => {
      const attempt = (retry: boolean) => {
        const client = clientRef.current;
        if (!client) return;
        client.api.checkDesign(definition).then(
          (r) => {
            if (id !== seq.current) return;
            setResult(r);
            setFailed(false);
            setChecking(false);
          },
          (err: unknown) => {
            if (id !== seq.current) return;
            // A crashed check worker (out of memory, bug) is replaced once; the call that
            // crashed was already released, so the idle countdown is not left paused.
            if (retry && err instanceof EngineCrashedError) {
              client.restart();
              attempt(false);
              return;
            }
            setFailed(true);
            setChecking(false);
          },
        );
      };
      attempt(true);
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [definition]);

  return { result, checking, failed };
}
