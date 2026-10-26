import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/supabase';
import { AdminApi, errorKeyOf, type AdminErrorKey } from './admin-api';

let api: AdminApi | null = null;

export function useAdminApi(): AdminApi {
  return useMemo(() => (api ??= new AdminApi(getSupabase())), []);
}

/** Loads data with `load`, exposes it with a `reload` (no caching library needed here). */
export function useAdminQuery<T>(load: (api: AdminApi) => Promise<T>) {
  const adminApi = useAdminApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    load(adminApi).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      },
      (e: unknown) => alive && setError(errorKeyOf(e)),
    );
    return () => {
      alive = false;
    };
    // `load` must be a module-level function (stable identity).
  }, [adminApi, load, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}
