/**
 * Helpers of the component tests: components render to static HTML in Node (react-dom/server, no
 * DOM library), then the markup is queried with small regex helpers. Behaviour that needs a real
 * DOM (focus, Escape, timers on screen) is covered by `e2e/ui-frame.spec.ts`.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../i18n';

export function html(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** Opening tags (`<tag …>`) of `markup` whose attributes match `attr` (e.g. `role="tab"`). */
export function tags(markup: string, attr: string, tag = '[a-z0-9]+'): string[] {
  const re = new RegExp(
    `<(?:${tag})\\b[^>]*${attr.replace(/[[\]().*+?^$|\\]/g, '\\$&')}[^>]*>`,
    'g',
  );
  return markup.match(re) ?? [];
}

/** Value of attribute `name` in one opening tag, `undefined` when absent. */
export function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
}

/** Whether an element with this id exists in the markup. */
export function hasId(markup: string, id: string): boolean {
  return markup.includes(`id="${id}"`);
}
