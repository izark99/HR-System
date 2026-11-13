import type { ReactNode } from 'react';

/**
 * Every icon of the app (spec §25.5 "Icon", AC-UI-69): inline SVG on a 24px grid, `stroke` 2,
 * `currentColor`, `aria-hidden` (the control holding the icon carries the accessible name). No
 * icon font or library, nothing fetched. Screens import from here; `design-tokens.test.ts` rejects
 * `<svg` anywhere else.
 *
 * `size` defaults to 20px for new icons; icons moved from older files keep the size they had, so
 * moving them changed nothing on screen.
 */
export interface IconProps {
  className?: string;
  size?: number;
}

function Icon({
  size,
  className,
  children,
  filled = false,
}: IconProps & { size: number; children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// ---- general (formerly components/ui.tsx) -------------------------------------------------

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

export function DownloadIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </Icon>
  );
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

/** Down chevron of the Select trigger (18px) and the menu button (16px). */
export function ChevronDownIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

/** Previous / next chevron of the pickers. */
export function ChevronIcon({ dir, size = 18, className }: IconProps & { dir: 'left' | 'right' }) {
  return (
    <Icon size={size} className={className}>
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </Icon>
  );
}

export function CalendarIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  );
}

/** Circle with an exclamation mark: error / warning badge (Designer node, toast, callout). */
export function AlertCircleIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </Icon>
  );
}

/** Circle with an "i": information toast. */
export function InfoIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Icon>
  );
}

/** Circle with a check: success toast. */
export function CheckCircleIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.5" />
    </Icon>
  );
}

/** Three lines: opens the left menu on mobile (SideNavLayout). */
export function MenuIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

/** Empty tray: default picture of an empty state. */
export function InboxIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
      <path d="M3 13h5l1.5 3h5l1.5-3h5" />
    </Icon>
  );
}

/** Small solid triangle of a sorted table column (10px, own 12px grid). */
export function SortArrowIcon({ dir, className }: { dir: 'asc' | 'desc'; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d={dir === 'asc' ? 'M6 2l4 6H2z' : 'M6 10L2 4h8z'} />
    </svg>
  );
}

// ---- admin row actions (formerly components/icons.tsx, AC-UI-58) ------------------------------

/** Edit (Sửa, Mở Designer). */
export function PencilIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </Icon>
  );
}

/** View read-only (Xem trong Designer). */
export function EyeIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** Stacked layers = versions (Mở trang phiên bản). */
export function LayersIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Icon>
  );
}

/** Horizontal ellipsis (Thao tác khác). */
export function MoreIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className} filled>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </Icon>
  );
}

/** Circular arrow: "Khôi phục mặc định" (Văn bản giao diện). */
export function ResetIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </Icon>
  );
}

// ---- Designer toolbar (formerly features/designer/ToolbarIcons.tsx) ---------------------------

export function UndoIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}

export function RedoIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  );
}

export function CopyIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}

export function PasteIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </Icon>
  );
}

export function TrashIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

/** "Nối tới…" (keyboard edge linking, AC-UI-76): two nodes joined by a wire. */
export function ConnectIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="4" width="7" height="6" rx="1.5" />
      <rect x="15" y="14" width="7" height="6" rx="1.5" />
      <path d="M9 7h3a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h-1" />
    </Icon>
  );
}

/** "Thêm ghi chú": a sticky note with a folded corner. */
export function NoteIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M4 4h16v10l-6 6H4z" />
      <path d="M14 20v-6h6" />
      <path d="M8 9h8M8 13h4" />
    </Icon>
  );
}

/** "Tự sắp xếp": boxes laid out on a grid. */
export function LayoutIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

// ---- admin menu (SideNavLayout) -------------------------------------------------------------

/** Menu "Tổng quan": four tiles. */
export function GridIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

/** Menu "Luồng xử lý": two steps joined by a line. */
export function FlowIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="2" y="4" width="7" height="6" rx="1.5" />
      <rect x="15" y="14" width="7" height="6" rx="1.5" />
      <path d="M9 7h3a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h-1" />
    </Icon>
  );
}

/** Menu "Bảng tham chiếu": a small table. */
export function TableIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </Icon>
  );
}

/** Menu "Mẫu": a sheet with a folded corner. */
export function FileIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
    </Icon>
  );
}

/** Menu "Tài khoản và nhóm": two people. */
export function UsersIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </Icon>
  );
}

/** Menu "Cài đặt UI": the letter T. */
export function TextIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M5 7V4h14v3M12 4v16M9 20h6" />
    </Icon>
  );
}

/** Menu "Lịch sử hoạt động": a clock turning back. */
export function HistoryIcon({ size = 20, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}
