import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RefTableDef } from '../../engine/core/types';
import type { ParamValues } from '../../engine/protocol';
import { getSupabase } from '../../lib/supabase';
import { asOfFromParams, asOfParam, todayIso } from '../runner/as-of';
import {
  effectiveVersion,
  loadRefCatalog,
  refDefinitions,
  type RefTableMeta,
  type RefVersionInfo,
} from '../runner/ref-source';
import type { DesignerDoc } from './model';
import type { FlowParam } from '@hrflow/flow-schema';

/**
 * Reference tables in the Designer (spec §34 AC-RT-07, 08, 10): the catalog (every table with
 * its published versions, read by the Admin) for the node / param forms and the design check, and
 * the preview date — the as-of param of the sample params, else today — telling which version a
 * preview uses. No row is loaded here (only when a preview runs).
 */

export interface RefCatalog {
  /** null while loading. */
  tables: RefTableMeta[] | null;
  failed: boolean;
  retry: () => void;
  /** Definitions for the design check (undefined: not known yet / failed). */
  defs: Record<string, RefTableDef> | undefined;
  /** As-of date of the preview (YYYY-MM-DD). */
  previewAsOf: string;
  /** Where it comes from: a sample period / date, or today. */
  previewFrom: { kind: 'period' | 'date' | 'today'; value: string };
  /** Version of a table used by the preview (null: none effective). */
  previewVersion: (code: string) => RefVersionInfo | null;
}

const EMPTY: RefCatalog = {
  tables: null,
  failed: false,
  retry: () => undefined,
  defs: undefined,
  previewAsOf: '',
  previewFrom: { kind: 'today', value: '' },
  previewVersion: () => null,
};

export const RefCatalogContext = createContext<RefCatalog>(EMPTY);
export const useRefCatalog = () => useContext(RefCatalogContext);

function validParams(doc: DesignerDoc): FlowParam[] {
  return doc.params.filter(
    (p): p is (typeof doc.params)[number] & FlowParam =>
      typeof p.key === 'string' && typeof p.type === 'string',
  );
}

/** Loads the catalog once per Designer open (with retry) and derives the preview version. */
export function useRefCatalogState(doc: DesignerDoc, sampleParams: ParamValues): RefCatalog {
  const [tables, setTables] = useState<RefTableMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadRefCatalog(getSupabase()).then(
      (list) => {
        if (!alive) return;
        setTables(list);
        setFailed(false);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setFailed(false);
    setTables(null);
    setAttempt((n) => n + 1);
  }, []);

  const params = validParams(doc);
  const today = todayIso();
  const previewAsOf = asOfFromParams(params, sampleParams, today);
  const p = asOfParam(params);
  const raw = p ? String(sampleParams[p.key] ?? '') : '';
  // '' as "today": tells whether the sample param itself gave a valid date.
  const fromSample = asOfFromParams(params, sampleParams, '') !== '';
  const kind: 'period' | 'date' | 'today' = !fromSample
    ? 'today'
    : p?.type === 'month'
      ? 'period'
      : 'date';
  const fromValue = kind === 'today' ? '' : raw;

  return useMemo(() => {
    const byCode = new Map((tables ?? []).map((t) => [t.code, t]));
    return {
      tables,
      failed,
      retry,
      defs: tables ? refDefinitions(tables) : undefined,
      previewAsOf,
      previewFrom: { kind, value: fromValue },
      previewVersion: (code: string) => {
        const t = byCode.get(code);
        return t ? effectiveVersion(t.versions, previewAsOf) : null;
      },
    };
  }, [tables, failed, retry, previewAsOf, kind, fromValue]);
}
