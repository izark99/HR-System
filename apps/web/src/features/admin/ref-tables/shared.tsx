import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '../../../components/icons';
import type { Tone } from '../../../components/ui';
import type { RefVersionStatus } from '../../../lib/database.types';
import { getSupabase } from '../../../lib/supabase';
import './i18n';
import type { RefType } from './model';
import { RefTablesApi } from './ref-tables-api';

let api: RefTablesApi | null = null;

export function useRefApi(): RefTablesApi {
  return useMemo(() => (api ??= new RefTablesApi(getSupabase())), []);
}

/** Status chips (mock approved 2026-11-09 14:38): draft amber, published teal, retired grey. */
export const REF_STATUS_TONE: Record<RefVersionStatus, Tone> = {
  draft: 'amber',
  published: 'teal',
  retired: 'neutral',
  discarded: 'neutral',
};

/** YYYY-MM-DD → dd/MM/yyyy. */
export function formatDay(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Timestamp → dd/MM/yyyy HH:mm (local time). */
export function formatStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function useTypeLabel(): (type: RefType) => string {
  const { t } = useTranslation('refTables');
  return (type) => t(`types.${type}`);
}

/** Path below /admin/ref-tables (one splat route, spec §34 AC-RT-11). */
export function refPath(code?: string, rest?: string): { _splat: string } {
  return { _splat: [code, rest].filter(Boolean).join('/') };
}

/** "‹ Bảng tham chiếu" (list) or "‹ Phiên bản" (versions of `code`). */
export function BackLink({ code }: { code?: string }) {
  const { t } = useTranslation('refTables');
  return (
    <Link
      to="/admin/ref-tables/$"
      params={refPath(code, code ? 'versions' : undefined)}
      className="inline-flex min-h-target items-center gap-2 self-start text-label text-teal-strong"
    >
      <ArrowLeftIcon />
      {code ? t('back.versions', { code }) : t('back.list')}
    </Link>
  );
}
