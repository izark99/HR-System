import { useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../../components/ui';
import { foldText } from '../../components/select-logic';
import { NODE_GROUPS, NODE_TYPES, typeKey } from './catalog';
import { GROUP_BAR } from './canvas/nodes';

export const DRAG_MIME = 'application/x-hrflow-node';

/**
 * Node palette (spec §15.3 "Bảng node"): grouped Input / Biến đổi / Kiểm soát / Code / Output,
 * with search. Drag an item onto the canvas, or press Enter / click to add it at the centre.
 */
export function Palette({ onAdd, disabled }: { onAdd: (type: string) => void; disabled: boolean }) {
  const { t } = useTranslation('designer');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const q = foldText(query);
  const match = (type: string) =>
    !q ||
    foldText(t(`types.node.${typeKey(type)}`)).includes(q) ||
    foldText(t(`palette.desc.${typeKey(type)}`)).includes(q) ||
    type.toLowerCase().includes(q);

  const onDragStart = (e: DragEvent<HTMLButtonElement>, type: string) => {
    e.dataTransfer.setData(DRAG_MIME, type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <nav
      aria-label={t('palette.title')}
      className="flex h-full flex-col gap-3 overflow-y-auto p-3.5"
    >
      <h2 className="m-0 text-label font-bold text-ink">{t('palette.title')}</h2>
      <label htmlFor={searchId} className="sr-only">
        {t('palette.search')}
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        placeholder={t('palette.search')}
        onChange={(e) => setQuery(e.target.value)}
        className="h-10.5 shrink-0 rounded-control border border-line-input bg-card px-3 text-label"
      />
      {NODE_GROUPS.map((group) => {
        const items = NODE_TYPES.filter((s) => s.group === group && match(s.type));
        if (items.length === 0) return null;
        return (
          <section
            key={group}
            aria-label={t(`palette.groups.${group}`)}
            className="flex flex-col gap-1.5"
          >
            <h3 className="m-0 text-eyebrow text-muted uppercase">
              {t(`palette.groups.${group}`)}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {items.map((s) => (
                <li key={s.type}>
                  <button
                    type="button"
                    draggable={!disabled}
                    disabled={disabled}
                    onDragStart={(e) => onDragStart(e, s.type)}
                    onClick={() => onAdd(s.type)}
                    title={t('palette.addHint')}
                    className={cx(
                      'flex min-h-target w-full items-stretch gap-2.5 overflow-hidden rounded-control border border-line bg-card text-left',
                      'hover:border-teal-strong disabled:cursor-not-allowed disabled:text-muted',
                    )}
                  >
                    <span aria-hidden className={cx('w-1.5 shrink-0', GROUP_BAR[s.group])} />
                    <span className="flex min-w-0 flex-col py-1.5 pr-2">
                      <span className="text-label font-semibold text-ink">
                        {t(`types.node.${typeKey(s.type)}`)}
                      </span>
                      <span className="text-small text-muted">
                        {t(`palette.desc.${typeKey(s.type)}`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
