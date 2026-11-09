import i18next from 'i18next';
import { applyTextOverrides } from '../../../lib/ui-text';
import viRefTables from '../../../locales/vi/ref-tables.json';

/**
 * Texts of the "Bảng tham chiếu" screens (spec §34): their own namespace, loaded with the screens'
 * chunk (bundle budget, AC-RT-12); editable in "Văn bản giao diện" (spec §33).
 */
if (!i18next.hasResourceBundle('vi', 'refTables')) {
  i18next.addResourceBundle('vi', 'refTables', viRefTables);
  applyTextOverrides('refTables');
}
