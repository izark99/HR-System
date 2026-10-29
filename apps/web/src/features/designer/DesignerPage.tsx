import '@xyflow/react/dist/style.css';
import './designer.css';
import './i18n';
import { ReactFlowProvider } from '@xyflow/react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Callout } from '../../components/ui';
import { errorKeyOf, type AdminErrorKey, type FlowVersions } from '../admin/admin-api';
import { useAdminApi } from '../admin/use-admin';
import { DesignerEditor } from './DesignerEditor';
import { fromDefinition } from './model';

/**
 * Flow Designer route (spec §15.3; Admin only, lazy chunk with React Flow). Always edits the
 * flow's draft; `?version=<id>` (or a flow without draft) opens a published/retired version
 * read-only with "Tạo draft từ version này" (AC-B3-47).
 */
export function DesignerPage() {
  const { t } = useTranslation('designer');
  const { t: tc } = useTranslation();
  const api = useAdminApi();
  const navigate = useNavigate();
  const { flowCode } = useParams({ from: '/admin/flows/$flowCode/designer' });
  const search = useSearch({ from: '/admin/flows/$flowCode/designer' });
  const [loaded, setLoaded] = useState<{ tick: number; data: FlowVersions | null } | null>(null);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getFlowVersions(flowCode).then(
      (d) => {
        if (!alive) return;
        setLoaded({ tick, data: d });
        setError(null);
      },
      (e: unknown) => alive && setError(errorKeyOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [api, flowCode, tick]);

  const data = loaded && loaded.tick === tick ? loaded.data : undefined;
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const draft = versions.find((v) => v.status === 'draft');
  const version =
    (search.version ? versions.find((v) => v.id === search.version) : undefined) ??
    draft ??
    versions[0];
  const readOnly = version?.status !== 'draft';
  const initial = useMemo(() => (version ? fromDefinition(version.definition) : null), [version]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const createDraft = useCallback(async () => {
    if (!version) return;
    if (draft) {
      setCreateError(tc('admin.versions.hasDraft', { version: draft.versionNo }));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await api.createDraftFromVersion(version.id);
      await navigate({
        to: '/admin/flows/$flowCode/designer',
        params: { flowCode },
        search: {},
      });
      reload();
    } catch (err) {
      const key = errorKeyOf(err);
      setCreateError(
        key === 'duplicate' ? tc('admin.versions.hasDraftUnknown') : tc(`admin.errors.${key}`),
      );
    } finally {
      setCreating(false);
    }
  }, [api, draft, flowCode, navigate, reload, tc, version]);

  if (error) {
    return (
      <div className="p-6">
        <Callout tone="coral" label={tc('admin.errorLabel')} role="alert">
          {tc(`admin.errors.${error}`)}
        </Callout>
      </div>
    );
  }
  if (data === undefined) {
    return <p className="m-0 p-6 text-muted">{tc('common.loading')}</p>;
  }
  if (data === null || !version || !initial) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Callout tone="coral" label={tc('admin.errorLabel')} role="alert">
          {data === null ? tc('admin.versions.notFound') : t('page.noVersion')}
        </Callout>
        <Link to="/admin/flows" className="text-teal-strong">
          {tc('admin.versions.back')}
        </Link>
      </div>
    );
  }

  return (
    <ReactFlowProvider key={`${version.id}:${tick}`}>
      {createError && (
        <div className="px-3.5 pt-2">
          <Callout tone="amber" label={t('toast.noteLabel')} role="alert">
            {createError}
            {draft && (
              <>
                {' '}
                <Link
                  to="/admin/flows/$flowCode/designer"
                  params={{ flowCode }}
                  search={{}}
                  onClick={() => setCreateError(null)}
                  className="font-semibold text-teal-strong"
                >
                  {t('page.openDraft', { version: draft.versionNo })}
                </Link>
              </>
            )}
          </Callout>
        </div>
      )}
      <DesignerEditor
        flowCode={flowCode}
        flowName={data.flow.name}
        version={version}
        initial={initial}
        readOnly={readOnly}
        onReload={reload}
        onCreateDraft={() => void createDraft()}
        creatingDraft={creating}
      />
    </ReactFlowProvider>
  );
}
