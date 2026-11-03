import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { Button, cx } from '../../components/ui';

/** Inline SVG icons of the Designer toolbar (no icon library, nothing fetched). */
const iconProps = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function UndoIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg {...iconProps}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function PasteIcon() {
  return (
    <svg {...iconProps}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * Square 36px toolbar button showing only an icon (AC-UI-52): `label` is the accessible name
 * (unchanged from the former text button, so shortcuts and tests keep working) and the tooltip
 * shown on hover / keyboard focus.
 */
export function IconButton({
  label,
  tooltip,
  icon,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  tooltip: string;
  icon: ReactNode;
}) {
  return (
    <Tooltip text={tooltip} className="inline-flex">
      <Button
        size="sm"
        aria-label={label}
        className={cx('w-control-sm px-0!', className)}
        {...props}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}
