import '@xyflow/react/dist/style.css';
import './designer.css';
import './i18n';
import { ReactFlowProvider } from '@xyflow/react';
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout } from '../../components/ui';
import { saveFile } from '../../lib/download';
import { errorKeyOf, type AdminErrorKey, type FlowVersions } from '../admin/admin-api';
import { Dialog } from '../admin/Dialog';
import { useAdminApi } from '../admin/use-admin';
import { DesignerEditor, type SavedState } from './DesignerEditor';
import { DesignerErrorBoundary } from './ErrorBoundary';
import { fromDefinition, toDefinition, type JsonObject } from './model';
import { useUnsavedChanges } from '../auth/idle/activity';

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

  // "Thử lại" after a crash remounts the editor from the latest canvas (still unsaved), not from
  // the server version.
  const [remount, setRemount] = useState<{
    versionId: string;
    doc: ReturnType<typeof fromDefinition>;
    saved: SavedState;
  } | null>(null);
  const latest = useRef<JsonObject | null>(null);
  const saved = useRef<SavedState | null>(null);
  const reload = useCallback(() => {
    latest.current = null;
    saved.current = null;
    setRemount(null);
    setTick((n) => n + 1);
  }, []);
  const keepLatest = useCallback((d: JsonObject) => {
    latest.current = d;
  }, []);
  const keepSaved = useCallback((s: SavedState) => {
    saved.current = s;
  }, []);
  const exportLatest = () => {
    if (!latest.current) return;
    saveFile({
      fileName: `${flowCode}_ban-nhap.json`,
      mimeType: 'application/json',
      data: new TextEncoder().encode(JSON.stringify(latest.current, null, 2)).buffer,
    });
  };

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

  const restored = remount && remount.versionId === version?.id ? remount : null;

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="m-0 text-page-title text-ink">{t('page.title')}</h1>
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
        <h1 className="m-0 text-page-title text-ink">{t('page.title')}</h1>
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
      <DesignerErrorBoundary
        fallback={(reset) => (
          <div className="flex flex-col gap-3 p-6">
            <CrashGuard
              dirty={
                !readOnly &&
                latest.current !== null &&
                JSON.stringify(latest.current) !==
                  (saved.current?.json ?? JSON.stringify(toDefinition(initial)))
              }
            />
            <h1 className="m-0 text-page-title text-ink">{t('crash.title')}</h1>
            <Callout tone="coral" label={t('toast.errorLabel')} role="alert">
              {t('crash.text')}
            </Callout>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={exportLatest}>
                {t('crash.export')}
              </Button>
              <Button
                onClick={() => {
                  if (latest.current && !readOnly) {
                    setRemount({
                      versionId: version.id,
                      doc: fromDefinition(latest.current),
                      saved: saved.current ?? {
                        json: JSON.stringify(toDefinition(initial)),
                        updatedAt: version.updatedAt,
                      },
                    });
                  }
                  reset();
                }}
              >
                {t('crash.retry')}
              </Button>
            </div>
          </div>
        )}
      >
        <DesignerEditor
          key={restored ? 'restored' : 'server'}
          onDefinition={keepLatest}
          onSaved={keepSaved}
          {...(restored ? { savedState: restored.saved } : {})}
          flowCode={flowCode}
          flowName={data.flow.name}
          version={version}
          initial={restored?.doc ?? initial}
          readOnly={readOnly}
          onReload={reload}
          onCreateDraft={() => void createDraft()}
          creatingDraft={creating}
        />
      </DesignerErrorBoundary>
    </ReactFlowProvider>
  );
}

/**
 * While the crash fallback is shown, unsaved work still blocks in-app navigation and the tab
 * close prompt (the editor that normally guards it is unmounted).
 */
function CrashGuard({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation('designer');
  useUnsavedChanges(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });
  return (
    <Dialog
      open={blocker.status === 'blocked'}
      onClose={() => blocker.reset?.()}
      title={t('leave.title')}
    >
      <p className="m-0 text-copy text-body">{t('leave.text')}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={() => blocker.reset?.()}>{t('leave.stay')}</Button>
        <Button variant="primary" onClick={() => blocker.proceed?.()}>
          {t('leave.leave')}
        </Button>
      </div>
    </Dialog>
  );
}
