import i18next from 'i18next';
import viDesigner from '../../locales/vi/designer.json';

/**
 * Designer texts live in their own namespace, loaded with the Designer chunk, so they never weigh
 * on the entry chunk (bundle budget, MEMORY 2026-10-27 07:36).
 */
if (!i18next.hasResourceBundle('vi', 'designer')) {
  i18next.addResourceBundle('vi', 'designer', viDesigner);
}
