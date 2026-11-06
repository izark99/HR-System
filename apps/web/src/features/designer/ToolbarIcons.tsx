import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { Button, cx } from '../../components/ui';

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
