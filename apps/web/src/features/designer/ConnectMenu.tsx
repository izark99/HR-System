import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectIcon } from '../../components/icons';
import { Tooltip } from '../../components/Tooltip';
import { buttonClass, cx, floatClass } from '../../components/ui';
import { connectTargets, filterTargets, sourcePorts } from './connect-targets';
import type { DEdge, DesignerDoc, DNode } from './model';

/** One row of the list: a source port (step 1) or a target port of a node (step 2). */
interface Item {
  key: string;
  label: string;
  port: string;
  node?: DNode;
}

/**
 * "Nối tới…" (spec §15 "Bàn phím", AC-UI-76): toolbar icon button opening a searchable list (the
 * custom Select's look and keys: ArrowUp/Down, Home/End, Enter, Escape, Tab) of the input ports
 * the selected node can be connected to, grouped by target node; ports already connected or
 * closing a cycle are not offered. A node with several output ports asks for the source port
 * first. Enter connects; Escape closes and gives focus back to the button. Mouse connection is
 * unchanged.
 */
export function ConnectMenu({
  doc,
  node,
  open,
  onOpenChange,
  onConnect,
}: {
  doc: DesignerDoc;
  /** The selected node (exactly one), or null. */
  node: DNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (edge: DEdge) => void;
}) {
  const { t } = useTranslation('designer');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const titleId = useId();
  const [fromPort, setFromPort] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const outputs = useMemo(() => (node ? sourcePorts(node) : []), [node]);
  const disabled = !node || outputs.length === 0;
  // A single output port needs no first step.
  const port = fromPort ?? (outputs.length === 1 ? outputs[0]! : null);
  const nodeName = (n: DNode) => n.label || n.id;
  const portLabel = (p: string) => t('canvas.inPort', { port: p });

  const sections = useMemo((): { label: string | null; items: Item[] }[] => {
    if (!node) return [];
    if (port === null) {
      return [
        {
          label: null,
          items: outputs
            .filter((p) => p.toLowerCase().includes(query.trim().toLowerCase()))
            .map((p) => ({ key: `out:${p}`, label: t('canvas.outPort', { port: p }), port: p })),
        },
      ];
    }
    const groups = filterTargets(connectTargets(doc, node.id, port), query, nodeName, portLabel);
    return groups.map((g) => ({
      label: nodeName(g.node),
      items: g.ports.map((p) => ({
        key: `${g.node.id}:${p}`,
        label: portLabel(p),
        port: p,
        node: g.node,
      })),
    }));
    // nodeName / portLabel only depend on `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, node, port, outputs, query, t]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const optionId = (i: number) => `${listId}-o${i}`;

  function reset() {
    setFromPort(null);
    setQuery('');
    setActive(0);
  }

  function close(focusButton: boolean) {
    onOpenChange(false);
    reset();
    if (focusButton) buttonRef.current?.focus();
  }

  // Opened (button or shortcut): start on the search box.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open, port]);

  // Outside pointer closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView?.({ block: 'nearest' });
    // optionId depends on listId only (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function choose(i: number) {
    const item = items[i];
    if (!item || !node) return;
    if (!item.node) {
      setFromPort(item.port);
      setQuery('');
      setActive(0);
      return;
    }
    onConnect({ from: node.id, fromPort: port!, to: item.node.id, toPort: item.port });
    close(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const last = items.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1);
      case 'ArrowUp':
        return move(active - 1);
      case 'PageDown':
        return move(active + 10);
      case 'PageUp':
        return move(active - 10);
      case 'Enter':
        e.preventDefault();
        return choose(active);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case 'Tab':
        return close(false);
    }
  }

  const tooltip = t('connectMenu.tip');
  let index = -1;
  return (
    <div ref={rootRef} className="relative inline-flex">
      <Tooltip text={open ? null : tooltip} className="inline-flex">
        <button
          ref={buttonRef}
          type="button"
          aria-label={t('connectMenu.button')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="Control+E"
          disabled={disabled}
          onClick={() => (open ? close(false) : onOpenChange(true))}
          className={cx(buttonClass('outline', 'sm'), 'w-control-sm px-0!')}
        >
          <ConnectIcon />
        </button>
      </Tooltip>
      {open && node && !disabled && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          data-connect-menu
          className={cx(
            floatClass,
            'absolute top-full right-0 z-50 mt-2 flex w-80 flex-col gap-2 p-2 text-dense',
          )}
        >
          <p id={titleId} className="m-0 px-2 pt-1 font-semibold text-ink">
            {port === null
              ? t('connectMenu.pickSource', { node: nodeName(node) })
              : t('connectMenu.pickTarget', { node: nodeName(node), port })}
          </p>
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-label={t('connectMenu.search')}
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? optionId(active) : undefined}
            placeholder={t('connectMenu.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-10.5 min-w-0 rounded-input border border-line-input bg-card px-3 text-dense text-ink focus:border-teal-strong focus:ring-3 focus:ring-teal-tint focus:outline-none"
          />
          {items.length === 0 && (
            <p role="status" className="m-0 px-3 py-2 text-caption text-muted">
              {query ? t('connectMenu.noResults') : t('connectMenu.empty')}
            </p>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={port === null ? t('connectMenu.sources') : t('connectMenu.targets')}
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          >
            {sections.map((section, s) => {
              const headerId = `${listId}-g${s}`;
              const rows = section.items.map((item) => {
                index++;
                const i = index;
                return (
                  <div
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onPointerMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
                    onClick={() => choose(i)}
                    className={cx(
                      'flex min-h-target cursor-pointer items-center rounded-input px-3 text-ink-soft',
                      i === active && 'bg-neutral ring-2 ring-teal-strong ring-inset',
                    )}
                  >
                    {item.label}
                  </div>
                );
              });
              return section.label ? (
                <div
                  key={headerId}
                  role="group"
                  aria-labelledby={headerId}
                  className="flex flex-col gap-0.5"
                >
                  <div
                    id={headerId}
                    role="presentation"
                    data-eyebrow
                    className="px-3 pt-2 pb-1 text-eyebrow text-muted uppercase"
                  >
                    {section.label}
                  </div>
                  {rows}
                </div>
              ) : (
                <div key={`plain-${s}`} role="presentation" className="flex flex-col gap-0.5">
                  {rows}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
