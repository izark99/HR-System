import type { NodePlugin } from '../core/plugin';
import { controlComparePlugin } from './control-compare';

/** Node plugin registry. Add new node types here (spec §12). */
export const nodePlugins: Record<string, NodePlugin<unknown>> = {
  [controlComparePlugin.type]: controlComparePlugin,
};
