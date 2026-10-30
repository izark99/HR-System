import type { AnyNodePlugin } from '../core/plugin';
import { codeSqlPlugin } from './code-sql';
import { controlComparePlugin } from './control-compare';
import { inputExcelPlugin } from './input-excel';
import { outputExcelPlugin } from './output-excel';
import { outputPreviewPlugin } from './output-preview';
import { transformDedupePlugin } from './transform-dedupe';
import { transformFilterPlugin } from './transform-filter';
import { transformFormulaPlugin } from './transform-formula';
import { transformGroupByPlugin } from './transform-group-by';
import { transformJoinPlugin } from './transform-join';
import { transformSelectPlugin } from './transform-select';
import { transformSortPlugin } from './transform-sort';
import { transformUnionPlugin } from './transform-union';

/** Node plugin registry. Add new node types here (spec §12). */
export const nodePlugins: Record<string, AnyNodePlugin> = {
  [inputExcelPlugin.type]: inputExcelPlugin,
  [controlComparePlugin.type]: controlComparePlugin,
  [outputExcelPlugin.type]: outputExcelPlugin,
  [outputPreviewPlugin.type]: outputPreviewPlugin,
  [transformSelectPlugin.type]: transformSelectPlugin,
  [transformFilterPlugin.type]: transformFilterPlugin,
  [transformSortPlugin.type]: transformSortPlugin,
  [transformJoinPlugin.type]: transformJoinPlugin,
  [transformUnionPlugin.type]: transformUnionPlugin,
  [transformGroupByPlugin.type]: transformGroupByPlugin,
  [transformDedupePlugin.type]: transformDedupePlugin,
  [transformFormulaPlugin.type]: transformFormulaPlugin,
  [codeSqlPlugin.type]: codeSqlPlugin,
};
