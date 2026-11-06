import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { Dialog, DialogFooter } from '../../components/Dialog';
import { FormField, TextInput } from '../../components/FormField';
import { PageHeader, Section, Toolbar } from '../../components/layout';
import { RowActions, RowIcon, rowIconClass } from '../../components/RowActions';
import { Select } from '../../components/Select';
import { TabPanel, Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { Button, Callout, cardClass, CellText, Chip, cx, labelClass } from '../../components/ui';
import type { Role } from '../../lib/database.types';
import { signOutAndReload, useAuth, useAuthService } from '../auth/auth-context';
import { normalizeUsername, USERNAME_PATTERN } from '../auth/credentials';
import {
  errorKeyOf,
  type AdminApi,
  type AdminErrorKey,
  type AdminWarning,
  type AdminFlow,
  type AdminGroup,
  type AdminUser,
  type Assignment,
} from './admin-api';
import { AdminConfirm, type ConfirmRequest } from './AdminConfirm';
import { useAdminApi, useAdminQuery } from './use-admin';
import { EmptyState } from '../../components/EmptyState';
import { LoadingRegion, TableCardSkeleton } from '../../components/Skeleton';
import { PencilIcon } from '../../components/icons';

interface PageData {
  users: AdminUser[];
  groups: AdminGroup[];
  flows: AdminFlow[];
  assignments: Assignment[];
}

async function loadAll(api: AdminApi): Promise<PageData> {
  const [users, groups, flows, assignments] = await Promise.all([
    api.listUsers(),
    api.listGroups(),
    api.listFlows(),
    api.listAssignments(),
  ]);
  return { users, groups, flows, assignments };
}

function ErrorText({ code }: { code: AdminErrorKey | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
      {t(`admin.errors.${code}`)}
    </Callout>
  );
}

// ---- temp password ----------------------------------------------------------------------

interface Secret {
  username: string;
  password: string;
  /** The account was changed but its audit entry could not be written. */
  warning?: AdminWarning;
}

function TempPasswordDialog({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Dialog
      open={secret !== null}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      title={t('admin.temp.title', { username: secret?.username ?? '' })}
    >
      <p className="m-0 text-body text-muted">{t('admin.temp.intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <output
          aria-label={t('admin.temp.passwordLabel')}
          className="rounded-card bg-neutral px-4 py-3 font-mono text-title-sm tracking-wider text-ink select-all"
        >
          {secret?.password}
        </output>
        <Button onClick={() => void copy()}>{t('admin.temp.copy')}</Button>
        <span role="status" className="text-caption font-semibold text-teal-strong">
          {copied ? t('admin.temp.copied') : ''}
        </span>
      </div>
      <Callout tone="amber" label={t('admin.temp.warningLabel')}>
        {t('admin.temp.warning')}
      </Callout>
      {secret?.warning && (
        <Callout tone="amber" label={t('admin.warnings.label')} role="status">
          {t(`admin.warnings.${secret.warning}`)}
        </Callout>
      )}
      <DialogFooter>
        <Button
          variant="primary"
          onClick={() => {
            setCopied(false);
            onClose();
          }}
        >
          {t('admin.temp.done')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ---- users ------------------------------------------------------------------------------

function GroupCheckboxes({
  groups,
  value,
  onChange,
  legend,
}: {
  groups: AdminGroup[];
  value: string[];
  onChange: (ids: string[]) => void;
  legend: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className={cx(labelClass, 'mb-2')}>{legend}</legend>
      {groups.length === 0 && (
        <p className="m-0 text-caption text-muted">{t('admin.groups.none')}</p>
      )}
      {groups.map((g) => (
        <label key={g.id} className="flex min-h-target items-center gap-3 text-body text-ink-soft">
          <input
            type="checkbox"
            className="size-4.5 accent-teal-strong"
            checked={value.includes(g.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, g.id] : value.filter((id) => id !== g.id))
            }
          />
          {g.name}
        </label>
      ))}
    </fieldset>
  );
}

function RoleRadios({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Role;
  onChange: (r: Role) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
      <legend className={cx(labelClass, 'mb-2')}>{t('admin.users.role')}</legend>
      {(['user', 'admin'] as const).map((r) => (
        <label key={r} className="flex min-h-target items-center gap-2 text-body text-ink-soft">
          <input
            type="radio"
            name={name}
            className="size-4.5 accent-teal-strong"
            checked={value === r}
            onChange={() => onChange(r)}
          />
          {t(`userMenu.role.${r}`)}
        </label>
      ))}
    </fieldset>
  );
}

function CreateUserForm({
  groups,
  onCreated,
}: {
  groups: AdminGroup[];
  onCreated: (secret: Secret) => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(name)) {
      setError('invalid_input');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createUser({ username: name, fullName, role, groupIds });
      setUsername('');
      setFullName('');
      setRole('user');
      setGroupIds([]);
      onCreated({
        username: created.username,
        password: created.temp_password,
        ...(created.warning ? { warning: created.warning } : {}),
      });
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="create-user"
      aria-label={t('admin.create.title')}
      onSubmit={(e) => void submit(e)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField
        id="new-username"
        required
        label={
          <>
            {t('admin.users.username')} <span aria-hidden>*</span>
          </>
        }
        hint={t('admin.create.usernameHint')}
      >
        {(field) => (
          <TextInput
            {...field.input}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
      </FormField>
      <FormField id="new-fullname" label={t('admin.users.fullName')}>
        {(field) => (
          <TextInput
            {...field.input}
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
      </FormField>
      <RoleRadios name="new-role" value={role} onChange={setRole} />
      <GroupCheckboxes
        groups={groups}
        value={groupIds}
        onChange={setGroupIds}
        legend={t('admin.users.groups')}
      />
      <Callout tone="blue" label={t('admin.create.tempLabel')} size="caption">
        {t('admin.create.temp')}
      </Callout>
      <ErrorText code={error} />
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('admin.create.submitting') : t('admin.create.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditUserDialog({
  user,
  self,
  groups,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  self: boolean;
  groups: AdminGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={t('admin.edit.title', { username: user?.username ?? '' })}
    >
      {user && (
        <EditUserForm key={user.id} user={user} self={self} groups={groups} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

function EditUserForm({
  user,
  self,
  groups,
  onSaved,
}: {
  user: AdminUser;
  self: boolean;
  groups: AdminGroup[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [groupIds, setGroupIds] = useState<string[]>(user.groupIds);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  // Demoting oneself (allowed, MEMORY 2026-10-26 18:09) needs a second, explicit confirmation.
  const selfDemote = self && user.role === 'admin' && role !== 'admin';
  const [demoteConfirmed, setDemoteConfirmed] = useState(false);
  const askDemote = selfDemote && !demoteConfirmed;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (askDemote) {
      setDemoteConfirmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, { fullName, role, groupIds });
      if (selfDemote) {
        // Full reload: the app re-reads the profile and drops the Admin screens.
        window.location.assign('/');
        return;
      }
      onSaved();
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <FormField id="edit-fullname" label={t('admin.users.fullName')}>
        {(field) => (
          <TextInput
            {...field.input}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
      </FormField>
      <RoleRadios
        name="edit-role"
        value={role}
        onChange={(r) => {
          setRole(r);
          setDemoteConfirmed(false);
        }}
      />
      {selfDemote && demoteConfirmed && (
        <Callout tone="coral" label={t('admin.self.label')} role="alert">
          {t('admin.self.demote')}
        </Callout>
      )}
      <GroupCheckboxes
        groups={groups}
        value={groupIds}
        onChange={setGroupIds}
        legend={t('admin.users.groups')}
      />
      <ErrorText code={error} />
      <DialogFooter>
        <Button type="submit" variant="primary" disabled={busy}>
          {selfDemote && demoteConfirmed ? t('admin.self.demoteAction') : t('admin.edit.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function StatusChip({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  if (!user.isActive) return <Chip tone="coral">{t('admin.status.locked')}</Chip>;
  if (user.mustChangePassword) return <Chip tone="amber">{t('admin.status.mustChange')}</Chip>;
  return <Chip tone="teal">{t('admin.status.active')}</Chip>;
}

function UsersTable({
  data,
  onEdit,
  onReset,
  onToggleActive,
}: {
  data: PageData;
  onEdit: (u: AdminUser) => void;
  onReset: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
}) {
  const { t } = useTranslation();
  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'username',
      header: t('admin.users.username'),
      rowHeader: true,
      cell: (u) => <CellText text={u.username} />,
    },
    {
      id: 'fullName',
      header: t('admin.users.fullName'),
      cell: (u) => <CellText text={u.fullName || '-'} />,
    },
    {
      id: 'role',
      header: t('admin.users.role'),
      cell: (u) => (
        <Chip tone={u.role === 'admin' ? 'blue' : 'neutral'}>{t(`userMenu.role.${u.role}`)}</Chip>
      ),
    },
    {
      id: 'groups',
      header: t('admin.users.groups'),
      cell: (u) => (
        <CellText
          text={
            u.groupIds
              .map((id) => groupName.get(id))
              .filter(Boolean)
              .join(', ') || '-'
          }
        />
      ),
    },
    { id: 'status', header: t('admin.users.status'), cell: (u) => <StatusChip user={u} /> },
  ];
  return (
    <DataTable
      caption={t('admin.users.caption')}
      columns={columns}
      rows={data.users}
      rowKey={(u) => u.id}
      rowTone={(u) => (u.isActive && u.mustChangePassword ? 'amber' : undefined)}
      empty={{ title: t('admin.users.none'), text: t('admin.users.noneHint') }}
      actions={{
        header: t('admin.users.actions'),
        cell: (u) => (
          <RowActions
            rowName={u.username}
            visible={
              <RowIcon label={t('admin.users.edit')}>
                <button
                  type="button"
                  className={rowIconClass}
                  aria-label={t('admin.users.editNamed', { username: u.username })}
                  onClick={() => onEdit(u)}
                >
                  <PencilIcon />
                </button>
              </RowIcon>
            }
            items={[
              {
                key: 'reset',
                label: t('admin.users.reset'),
                ariaLabel: t('admin.users.resetNamed', { username: u.username }),
                onSelect: () => onReset(u),
              },
              {
                key: u.isActive ? 'lock' : 'unlock',
                label: u.isActive ? t('admin.users.lock') : t('admin.users.unlock'),
                ariaLabel: t(u.isActive ? 'admin.users.lockNamed' : 'admin.users.unlockNamed', {
                  username: u.username,
                }),
                danger: u.isActive,
                onSelect: () => onToggleActive(u),
              },
            ]}
          />
        ),
      }}
    />
  );
}

// ---- groups -----------------------------------------------------------------------------

function GroupForm({
  group,
  onDone,
}: {
  group: AdminGroup | null;
  onDone: (name: string) => void;
}) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = group ? 'edit-group' : 'new-group';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('group_name_required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (group) await api.updateGroup(group.id, name, description);
      else await api.createGroup(name, description);
      if (!group) {
        setName('');
        setDescription('');
      }
      onDone(name.trim());
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
      <FormField
        id={`${prefix}-name`}
        required
        label={
          <>
            {t('admin.groups.name')} <span aria-hidden>*</span>
          </>
        }
      >
        {(field) => (
          <TextInput
            {...field.input}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </FormField>
      <FormField id={`${prefix}-description`} label={t('admin.groups.description')}>
        {(field) => (
          <TextInput
            {...field.input}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </FormField>
      <ErrorText code={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {group ? t('admin.groups.save') : t('admin.groups.create')}
        </Button>
      </div>
    </form>
  );
}

function GroupsTable({
  data,
  onEdit,
  onDelete,
}: {
  data: PageData;
  onEdit: (g: AdminGroup) => void;
  onDelete: (g: AdminGroup) => void;
}) {
  const { t } = useTranslation();
  const counts = new Map<string, number>();
  for (const u of data.users) for (const g of u.groupIds) counts.set(g, (counts.get(g) ?? 0) + 1);
  const columns: DataTableColumn<AdminGroup>[] = [
    {
      id: 'name',
      header: t('admin.groups.name'),
      rowHeader: true,
      cell: (g) => <CellText text={g.name} />,
    },
    {
      id: 'description',
      header: t('admin.groups.description'),
      cell: (g) => <CellText text={g.description || '-'} />,
    },
    { id: 'members', header: t('admin.groups.members'), cell: (g) => counts.get(g.id) ?? 0 },
  ];
  return (
    <DataTable
      caption={t('admin.groups.caption')}
      columns={columns}
      rows={data.groups}
      rowKey={(g) => g.id}
      empty={{ title: t('admin.groups.none'), text: t('admin.groups.noneHint') }}
      actions={{
        header: t('admin.users.actions'),
        cell: (g) => (
          <RowActions
            rowName={g.name}
            visible={
              <RowIcon label={t('admin.users.edit')}>
                <button
                  type="button"
                  className={rowIconClass}
                  aria-label={t('admin.groups.editNamed', { name: g.name })}
                  onClick={() => onEdit(g)}
                >
                  <PencilIcon />
                </button>
              </RowIcon>
            }
            items={[
              {
                key: 'delete',
                label: t('admin.groups.delete'),
                ariaLabel: t('admin.groups.deleteNamed', { name: g.name }),
                danger: true,
                onSelect: () => onDelete(g),
              },
            ]}
          />
        ),
      }}
    />
  );
}

// ---- assignments ------------------------------------------------------------------------

function AssignmentsCard({ data, onChanged }: { data: PageData; onChanged: () => void }) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [target, setTarget] = useState<string>(() =>
    data.groups[0] ? `g:${data.groups[0].id}` : data.users[0] ? `u:${data.users[0].id}` : '',
  );
  const toast = useToast();
  const [busyFlow, setBusyFlow] = useState<string | null>(null);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  // The last "Đã gán / Đã gỡ" toast: replaced by the next one, dropped when the target changes.
  const lastToast = useRef<number | null>(null);
  function dropToast() {
    if (lastToast.current !== null) toast.dismiss(lastToast.current);
    lastToast.current = null;
  }
  const kind = target.startsWith('g:') ? 'group' : 'user';
  const targetId = target.slice(2);
  const targetName =
    kind === 'group'
      ? data.groups.find((g) => g.id === targetId)?.name
      : data.users.find((u) => u.id === targetId)?.username;
  const flows = data.flows.filter((f) => !f.isArchived);

  async function toggle(flow: AdminFlow, on: boolean) {
    setBusyFlow(flow.id);
    setError(null);
    try {
      const existing = data.assignments.find(
        (a) => a.flowId === flow.id && (kind === 'group' ? a.groupId : a.userId) === targetId,
      );
      if (on && !existing) {
        await api.assign(flow.id, kind === 'group' ? { groupId: targetId } : { userId: targetId });
      } else if (!on && existing) {
        await api.unassign(existing.id);
      }
      dropToast();
      lastToast.current = toast.show({
        tone: 'teal',
        message: t(on ? 'admin.assign.added' : 'admin.assign.removed', { flow: flow.name }),
      });
      onChanged();
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusyFlow(null);
    }
  }

  return (
    <Section
      title={
        targetName
          ? t(kind === 'group' ? 'admin.assign.titleGroup' : 'admin.assign.titleUser', {
              name: targetName,
            })
          : t('admin.assign.title')
      }
      description={t('admin.assign.note')}
    >
      <FormField id="assign-target" label={t('admin.assign.target')}>
        {(field) => (
          <Select
            id={field.id}
            value={target}
            onChange={(v) => {
              setTarget(v);
              dropToast();
            }}
            groups={[
              {
                label: t('admin.assign.groups'),
                options: data.groups.map((g) => ({ value: `g:${g.id}`, label: g.name })),
              },
              {
                label: t('admin.assign.users'),
                options: data.users.map((u) => ({ value: `u:${u.id}`, label: u.username })),
              },
            ]}
            className="w-full max-w-90"
          />
        )}
      </FormField>
      {flows.length === 0 && <EmptyState variant="inline" title={t('admin.assign.noFlows')} />}
      {target && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="sr-only">{t('admin.assign.flowsLegend')}</legend>
          {flows.map((f) => {
            const checked = data.assignments.some(
              (a) => a.flowId === f.id && (kind === 'group' ? a.groupId : a.userId) === targetId,
            );
            return (
              <label
                key={f.id}
                className="flex min-h-target items-center gap-3 text-body text-ink-soft"
              >
                <input
                  type="checkbox"
                  className="size-4.5 accent-teal-strong"
                  checked={checked}
                  disabled={busyFlow !== null}
                  onChange={(e) => void toggle(f, e.target.checked)}
                />
                {f.name}
              </label>
            );
          })}
        </fieldset>
      )}
      <ErrorText code={error} />
    </Section>
  );
}

const TABS_ID = 'admin-users-tabs';

// ---- page -------------------------------------------------------------------------------

export function AdminUsersPage() {
  const { t } = useTranslation();
  const api = useAdminApi();
  const auth = useAuth();
  const authService = useAuthService();
  const toast = useToast();
  const selfId = auth.status === 'signedIn' ? auth.user.id : null;
  const { data, error, reload } = useAdminQuery(loadAll);
  const [tab, setTab] = useState<'users' | 'groups'>('users');
  const [secret, setSecret] = useState<Secret | null>(null);
  /** The Admin reset their own password: sign out once the temp password has been noted. */
  const [selfReset, setSelfReset] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);
  /** "+ Tạo tài khoản" dialog (AC-UI-55): the tables keep the full width of the page. */
  const [creating, setCreating] = useState(false);
  const done = (message: string) => toast.show({ tone: 'teal', message });

  /** Body of a confirm dialog, with an explicit warning when the Admin targets themself. */
  function confirmBody(text: string, selfWarning: string | null): ReactNode {
    if (!selfWarning) return text;
    return (
      <div className="flex flex-col gap-3">
        <Callout tone="coral" label={t('admin.self.label')} role="alert">
          {selfWarning}
        </Callout>
        <p className="m-0">{text}</p>
      </div>
    );
  }

  function askReset(u: AdminUser) {
    const self = u.id === selfId;
    setConfirm({
      title: t('admin.reset.title', { username: u.username }),
      body: confirmBody(t('admin.reset.body'), self ? t('admin.self.reset') : null),
      action: t('admin.reset.action'),
      // The temporary password itself stays in its dialog (AC-UI-73), never in a toast.
      success: t('admin.toast.reset', { username: u.username }),
      run: async () => {
        const r = await api.resetPassword(u.id);
        if (self) setSelfReset(true);
        else reload();
        setSecret({
          username: u.username,
          password: r.temp_password,
          ...(r.warning ? { warning: r.warning } : {}),
        });
      },
    });
  }

  function askToggle(u: AdminUser) {
    const selfLock = u.id === selfId && u.isActive;
    setConfirm({
      title: t(u.isActive ? 'admin.lock.title' : 'admin.unlock.title', { username: u.username }),
      body: confirmBody(
        t(u.isActive ? 'admin.lock.body' : 'admin.unlock.body'),
        selfLock ? t('admin.self.lock') : null,
      ),
      action: t(u.isActive ? 'admin.users.lock' : 'admin.users.unlock'),
      tone: u.isActive ? 'danger' : 'primary',
      ...(selfLock
        ? {}
        : {
            success: t(u.isActive ? 'admin.toast.locked' : 'admin.toast.unlocked', {
              username: u.username,
            }),
          }),
      run: async () => {
        await api.setActive(u.id, !u.isActive);
        // Own sessions are revoked: leave the app now instead of failing on the next request.
        if (selfLock) await signOutAndReload(authService);
        else reload();
      },
    });
  }

  function askDeleteGroup(g: AdminGroup) {
    setConfirm({
      title: t('admin.groups.deleteTitle', { name: g.name }),
      body: t('admin.groups.deleteBody'),
      action: t('admin.groups.delete'),
      tone: 'danger',
      success: t('admin.toast.groupDeleted', { name: g.name }),
      run: async () => {
        await api.deleteGroup(g.id);
        reload();
      },
    });
  }

  return (
    <>
      <PageHeader
        eyebrow={t('admin.users.eyebrow')}
        eyebrowTone="blue"
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        actions={
          <Button
            variant="primary"
            disabled={!data}
            onClick={() => {
              setTab('users');
              setCreating(true);
            }}
          >
            {t('admin.users.createButton')}
          </Button>
        }
      />

      {error && (
        <div className="flex flex-col items-start gap-3">
          <ErrorText code={error} />
          <Button size="sm" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!data && !error && (
        <LoadingRegion>
          <TableCardSkeleton columns={5} />
        </LoadingRegion>
      )}

      {data && (
        <>
          <section
            aria-label={t('admin.users.listLabel')}
            data-card
            className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
          >
            <Toolbar>
              <Tabs
                id={TABS_ID}
                label={t('admin.users.tabsLabel')}
                selected={tab}
                onChange={(id) => setTab(id as 'users' | 'groups')}
                items={[
                  { id: 'users', label: t('admin.users.tabUsers', { count: data.users.length }) },
                  {
                    id: 'groups',
                    label: t('admin.users.tabGroups', { count: data.groups.length }),
                  },
                ]}
              />
            </Toolbar>
            <TabPanel tabsId={TABS_ID} item={tab} focusable={false}>
              {tab === 'users' ? (
                <UsersTable
                  data={data}
                  onEdit={setEditing}
                  onReset={askReset}
                  onToggleActive={askToggle}
                />
              ) : (
                <GroupsTable data={data} onEdit={setEditingGroup} onDelete={askDeleteGroup} />
              )}
            </TabPanel>
          </section>
          {tab === 'groups' && (
            <Section title={t('admin.groups.createTitle')}>
              <div className="max-w-140">
                <GroupForm
                  group={null}
                  onDone={(name) => {
                    reload();
                    done(t('admin.toast.groupCreated', { name }));
                  }}
                />
              </div>
            </Section>
          )}

          <AssignmentsCard data={data} onChanged={reload} />
        </>
      )}

      <Dialog
        open={creating && !!data}
        onClose={() => setCreating(false)}
        title={t('admin.create.title')}
        initialFocusId="new-username"
      >
        {data && (
          <CreateUserForm
            groups={data.groups}
            onCreated={(s) => {
              setCreating(false);
              reload();
              setSecret(s);
              done(t('admin.toast.created', { username: s.username }));
            }}
          />
        )}
      </Dialog>
      <TempPasswordDialog
        secret={secret}
        onClose={() => {
          setSecret(null);
          if (selfReset) void signOutAndReload(authService);
        }}
      />
      <AdminConfirm confirm={confirm} onClose={() => setConfirm(null)} />
      <EditUserDialog
        user={editing}
        self={editing?.id === selfId}
        groups={data?.groups ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          if (editing) done(t('admin.toast.saved', { username: editing.username }));
          setEditing(null);
          reload();
        }}
      />
      <Dialog
        open={editingGroup !== null}
        onClose={() => setEditingGroup(null)}
        title={t('admin.groups.editTitle', { name: editingGroup?.name ?? '' })}
      >
        {editingGroup && (
          <GroupForm
            key={editingGroup.id}
            group={editingGroup}
            onDone={(name) => {
              setEditingGroup(null);
              reload();
              done(t('admin.toast.groupSaved', { name }));
            }}
          />
        )}
      </Dialog>
    </>
  );
}
