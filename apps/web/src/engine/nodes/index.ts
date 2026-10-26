import type { AnyNodePlugin } from '../core/plugin';
import { controlComparePlugin } from './control-compare';
import { inputExcelPlugin } from './input-excel';
import { outputExcelPlugin } from './output-excel';

/** Node plugin registry. Add new node types here (spec §12). */
export const nodePlugins: Record<string, AnyNodePlugin> = {
  [inputExcelPlugin.type]: inputExcelPlugin,
  [controlComparePlugin.type]: controlComparePlugin,
  [outputExcelPlugin.type]: outputExcelPlugin,
};
