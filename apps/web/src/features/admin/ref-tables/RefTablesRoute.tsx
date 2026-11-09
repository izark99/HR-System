import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Callout } from '../../../components/ui';
import { RefTableDataPage } from './RefTableDataPage';
import { RefTableFormPage } from './RefTableFormPage';
import { RefTablesListPage } from './RefTablesListPage';
import { RefTableVersionsPage } from './RefTableVersionsPage';
import { BackLink } from './shared';

/**
 * "Bảng tham chiếu" (spec §34 AC-RT-11): one lazy route `/admin/ref-tables/$` (a single entry in
 * the entry chunk's route tree, bundle budget AC-RT-12) dispatching on the rest of the path:
 * `` list · `new` · `CODE` columns · `CODE/versions` · `CODE/versions/N` data.
 */
export function RefTablesRoute() {
  const { t } = useTranslation('refTables');
  const { _splat: splat = '' } = useParams({ from: '/admin/ref-tables/$' });
  const parts = splat.split('/').filter(Boolean);
  const [code, section, no] = parts;
  if (!code) return <RefTablesListPage />;
  if (parts.length === 1)
    return code === 'new' ? <RefTableFormPage /> : <RefTableFormPage code={code} />;
  if (section === 'versions' && parts.length === 2) return <RefTableVersionsPage code={code} />;
  if (section === 'versions' && parts.length === 3 && /^[1-9]\d{0,8}$/.test(no!))
    return <RefTableDataPage code={code} versionNo={Number(no)} />;
  return (
    <>
      <BackLink />
      <Callout tone="coral" label={t('errorLabel')} role="alert">
        {t('notFound', { code })}
      </Callout>
    </>
  );
}
