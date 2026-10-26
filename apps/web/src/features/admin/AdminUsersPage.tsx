import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, Card, Chip, cx, PageHeader } from '../../components/ui';
import type { Role } from '../../lib/database.types';
import { useAuth } from '../auth/auth-context';
import { normalizeUsername, USERNAME_PATTERN } from '../auth/credentials';
import {
  errorKeyOf,
  type AdminApi,
  type AdminErrorKey,
  type AdminFlow,
  type AdminGroup,
  type AdminUser,
  type Assignment,
} from './admin-api';
import { Dialog } from './Dialog';
import { useAdminApi, useAdminQuery } from './use-admin';

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

const inputClass = 'h-10.5 rounded-control border border-line-input bg-card px-3 text-label';
const labelClass = 'text-small font-semibold text-body';
const linkButtonClass =
  'inline-flex min-h-target items-center rounded-control px-2 text-label font-semibold text-teal-strong hover:bg-teal-tint disabled:text-muted';

function ErrorText({ code }: { code: AdminErrorKey | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <Callout tone="coral" label={t('admin.errorLabel')} role="alert">
      {t(`admin.errors.${code}`)}
    </Callout>
  );
}

// ---- tabs (APG: arrow keys move between tabs, automatic activation) ------------------------

function Tabs<K extends string>({
  base,
  label,
  tabs,
  active,
  onChange,
}: {
  base: string;
  label: string;
  tabs: { key: K; label: string }[];
  active: K;
  onChange: (k: K) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKey(e: KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const target =
      e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : delta ? index + delta : null;
    if (target === null) return;
    e.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length]!;
    onChange(next.key);
    refs.current[next.key]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
      {tabs.map((tab, i) => (
        <button
          key={tab.key}
          ref={(el) => {
            refs.current[tab.key] = el;
          }}
          type="button"
          role="tab"
          id={`${base}-${tab.key}`}
          aria-selected={active === tab.key}
          aria-controls={`${base}-${tab.key}-panel`}
          tabIndex={active === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => onKey(e, i)}
          className={cx(
            'min-h-target rounded-full px-4 text-label',
            active === tab.key
              ? 'bg-teal-tint font-bold text-teal-strong'
              : 'font-semibold text-muted hover:bg-page',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function tabPanelProps(base: string, key: string) {
  return { role: 'tabpanel', id: `${base}-${key}-panel`, 'aria-labelledby': `${base}-${key}` };
}

// ---- temp password ----------------------------------------------------------------------

interface Secret {
  username: string;
  password: string;
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
      <p className="m-0 text-label text-muted">{t('admin.temp.intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <output
          aria-label={t('admin.temp.passwordLabel')}
          className="rounded-control bg-neutral px-4 py-3 font-mono text-xl font-bold tracking-wider text-ink select-all"
        >
          {secret?.password}
        </output>
        <Button onClick={() => void copy()}>{t('admin.temp.copy')}</Button>
        <span role="status" className="text-small font-semibold text-teal-strong">
          {copied ? t('admin.temp.copied') : ''}
        </span>
      </div>
      <Callout tone="amber" label={t('admin.temp.warningLabel')}>
        {t('admin.temp.warning')}
      </Callout>
      <Button
        variant="primary"
        className="self-end"
        onClick={() => {
          setCopied(false);
          onClose();
        }}
      >
        {t('admin.temp.done')}
      </Button>
    </Dialog>
  );
}

// ---- confirm ----------------------------------------------------------------------------

interface Confirm {
  title: string;
  body: ReactNode;
  action: string;
  run: () => Promise<void>;
}

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  function close() {
    setError(null);
    onClose();
  }
  return (
    <Dialog open={confirm !== null} onClose={close} title={confirm?.title ?? ''}>
      <div className="text-label text-body">{confirm?.body}</div>
      <ErrorText code={error} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={close}>{t('admin.cancel')}</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            if (!confirm) return;
            setBusy(true);
            setError(null);
            confirm.run().then(
              () => {
                setBusy(false);
                close();
              },
              (e: unknown) => {
                setBusy(false);
                setError(errorKeyOf(e));
              },
            );
          }}
        >
          {confirm?.action}
        </Button>
      </div>
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
      <legend className={cx(labelClass, 'mb-1.5')}>{legend}</legend>
      {groups.length === 0 && <p className="m-0 text-small text-muted">{t('admin.groups.none')}</p>}
      {groups.map((g) => (
        <label key={g.id} className="flex min-h-target items-center gap-2.5 text-label text-body">
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
  disabled,
}: {
  name: string;
  value: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0" disabled={disabled}>
      <legend className={cx(labelClass, 'mb-1.5')}>{t('admin.users.role')}</legend>
      {(['user', 'admin'] as const).map((r) => (
        <label key={r} className="flex min-h-target items-center gap-2 text-label text-body">
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
      onCreated({ username: created.username, password: created.temp_password });
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="create-user"
      aria-labelledby="create-user-title"
      onSubmit={(e) => void submit(e)}
      noValidate
      className="flex flex-[1_1_300px] flex-col gap-3.5 rounded-card border-t-8 border-teal bg-card p-6 shadow-card"
    >
      <h2 id="create-user-title" className="m-0 text-section">
        {t('admin.create.title')}
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-username" className={labelClass}>
          {t('admin.users.username')} <span aria-hidden>*</span>
          <span className="sr-only">({t('common.required')})</span>
        </label>
        <input
          id="new-username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-describedby="new-username-hint"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
        <span id="new-username-hint" className="text-small text-muted">
          {t('admin.create.usernameHint')}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-fullname" className={labelClass}>
          {t('admin.users.fullName')}
        </label>
        <input
          id="new-fullname"
          autoComplete="off"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputClass}
        />
      </div>
      <RoleRadios name="new-role" value={role} onChange={setRole} />
      <GroupCheckboxes
        groups={groups}
        value={groupIds}
        onChange={setGroupIds}
        legend={t('admin.users.groups')}
      />
      <Callout tone="blue" label={t('admin.create.tempLabel')} className="text-small">
        {t('admin.create.temp')}
      </Callout>
      <ErrorText code={error} />
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? t('admin.create.submitting') : t('admin.create.submit')}
      </Button>
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(user.id, {
        fullName,
        ...(self ? {} : { role }),
        groupIds,
      });
      onSaved();
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-fullname" className={labelClass}>
          {t('admin.users.fullName')}
        </label>
        <input
          id="edit-fullname"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputClass}
        />
      </div>
      <RoleRadios name="edit-role" value={role} onChange={setRole} disabled={self} />
      {self && <p className="m-0 text-small text-muted">{t('admin.edit.selfRole')}</p>}
      <GroupCheckboxes
        groups={groups}
        value={groupIds}
        onChange={setGroupIds}
        legend={t('admin.users.groups')}
      />
      <ErrorText code={error} />
      <Button type="submit" variant="primary" disabled={busy} className="self-end">
        {t('admin.edit.save')}
      </Button>
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
  selfId,
  onEdit,
  onReset,
  onToggleActive,
}: {
  data: PageData;
  selfId: string | null;
  onEdit: (u: AdminUser) => void;
  onReset: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
}) {
  const { t } = useTranslation();
  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-155 border-collapse text-label text-body">
        <caption className="sr-only">{t('admin.users.caption')}</caption>
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.username')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.fullName')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.role')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.groups')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.status')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => {
            const self = u.id === selfId;
            return (
              <tr
                key={u.id}
                className={cx(
                  'border-b border-line last:border-b-0',
                  u.isActive && u.mustChangePassword && 'bg-amber-tint',
                )}
              >
                <th scope="row" className="px-2 py-2 text-left font-semibold">
                  {u.username}
                </th>
                <td className="px-2 py-2">{u.fullName || '-'}</td>
                <td className="px-2 py-2">
                  <Chip tone={u.role === 'admin' ? 'blue' : 'neutral'}>
                    {t(`userMenu.role.${u.role}`)}
                  </Chip>
                </td>
                <td className="px-2 py-2">
                  {u.groupIds
                    .map((id) => groupName.get(id))
                    .filter(Boolean)
                    .join(', ') || '-'}
                </td>
                <td className="px-2 py-2">
                  <StatusChip user={u} />
                </td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap items-center">
                    <button
                      type="button"
                      className={linkButtonClass}
                      aria-label={t('admin.users.editNamed', { username: u.username })}
                      onClick={() => onEdit(u)}
                    >
                      {t('admin.users.edit')}
                    </button>
                    {!self && (
                      <>
                        <button
                          type="button"
                          className={linkButtonClass}
                          aria-label={t('admin.users.resetNamed', { username: u.username })}
                          onClick={() => onReset(u)}
                        >
                          {t('admin.users.reset')}
                        </button>
                        <button
                          type="button"
                          className={linkButtonClass}
                          aria-label={t(
                            u.isActive ? 'admin.users.lockNamed' : 'admin.users.unlockNamed',
                            {
                              username: u.username,
                            },
                          )}
                          onClick={() => onToggleActive(u)}
                        >
                          {u.isActive ? t('admin.users.lock') : t('admin.users.unlock')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- groups -----------------------------------------------------------------------------

function GroupForm({ group, onDone }: { group: AdminGroup | null; onDone: () => void }) {
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
      setError('invalid_input');
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
      onDone();
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefix}-name`} className={labelClass}>
          {t('admin.groups.name')} <span aria-hidden>*</span>
          <span className="sr-only">({t('common.required')})</span>
        </label>
        <input
          id={`${prefix}-name`}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefix}-description`} className={labelClass}>
          {t('admin.groups.description')}
        </label>
        <input
          id={`${prefix}-description`}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>
      <ErrorText code={error} />
      <Button type="submit" variant="primary" disabled={busy}>
        {group ? t('admin.groups.save') : t('admin.groups.create')}
      </Button>
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
  if (data.groups.length === 0) {
    return <p className="m-0 text-muted">{t('admin.groups.none')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-120 border-collapse text-label text-body">
        <caption className="sr-only">{t('admin.groups.caption')}</caption>
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.groups.name')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.groups.description')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.groups.members')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              {t('admin.users.actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <tr key={g.id} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-2 py-2 text-left font-semibold">
                {g.name}
              </th>
              <td className="px-2 py-2">{g.description || '-'}</td>
              <td className="px-2 py-2">{counts.get(g.id) ?? 0}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  className={linkButtonClass}
                  aria-label={t('admin.groups.editNamed', { name: g.name })}
                  onClick={() => onEdit(g)}
                >
                  {t('admin.users.edit')}
                </button>
                <button
                  type="button"
                  className={linkButtonClass}
                  aria-label={t('admin.groups.deleteNamed', { name: g.name })}
                  onClick={() => onDelete(g)}
                >
                  {t('admin.groups.delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- assignments ------------------------------------------------------------------------

function AssignmentsCard({ data, onChanged }: { data: PageData; onChanged: () => void }) {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [target, setTarget] = useState<string>(() =>
    data.groups[0] ? `g:${data.groups[0].id}` : data.users[0] ? `u:${data.users[0].id}` : '',
  );
  const [busyFlow, setBusyFlow] = useState<string | null>(null);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const [status, setStatus] = useState('');
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
      setStatus(t(on ? 'admin.assign.added' : 'admin.assign.removed', { flow: flow.name }));
      onChanged();
    } catch (err) {
      setError(errorKeyOf(err));
    } finally {
      setBusyFlow(null);
    }
  }

  return (
    <Card aria-labelledby="assign-title" className="flex flex-col gap-3">
      <h2 id="assign-title" className="m-0 text-section">
        {targetName
          ? t(kind === 'group' ? 'admin.assign.titleGroup' : 'admin.assign.titleUser', {
              name: targetName,
            })
          : t('admin.assign.title')}
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="assign-target" className={labelClass}>
          {t('admin.assign.target')}
        </label>
        <select
          id="assign-target"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setStatus('');
          }}
          className={cx(inputClass, 'max-w-90')}
        >
          {data.groups.length > 0 && (
            <optgroup label={t('admin.assign.groups')}>
              {data.groups.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('admin.assign.users')}>
            {data.users.map((u) => (
              <option key={u.id} value={`u:${u.id}`}>
                {u.username}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {flows.length === 0 && <p className="m-0 text-muted">{t('admin.assign.noFlows')}</p>}
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
                className="flex min-h-target items-center gap-2.5 text-label text-body"
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
      <p role="status" className="m-0 min-h-5 text-small text-teal-strong">
        {status}
      </p>
      <ErrorText code={error} />
      <p className="m-0 text-small text-muted">{t('admin.assign.note')}</p>
    </Card>
  );
}

// ---- page -------------------------------------------------------------------------------

export function AdminUsersPage() {
  const { t } = useTranslation();
  const api = useAdminApi();
  const auth = useAuth();
  const selfId = auth.status === 'signedIn' ? auth.user.id : null;
  const { data, error, reload } = useAdminQuery(loadAll);
  const [tab, setTab] = useState<'users' | 'groups'>('users');
  const [secret, setSecret] = useState<Secret | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editingGroup, setEditingGroup] = useState<AdminGroup | null>(null);
  const tabsBase = useId();

  function askReset(u: AdminUser) {
    setConfirm({
      title: t('admin.reset.title', { username: u.username }),
      body: t('admin.reset.body'),
      action: t('admin.reset.action'),
      run: async () => {
        const r = await api.resetPassword(u.id);
        reload();
        setSecret({ username: u.username, password: r.temp_password });
      },
    });
  }

  function askToggle(u: AdminUser) {
    setConfirm({
      title: t(u.isActive ? 'admin.lock.title' : 'admin.unlock.title', { username: u.username }),
      body: t(u.isActive ? 'admin.lock.body' : 'admin.unlock.body'),
      action: t(u.isActive ? 'admin.users.lock' : 'admin.users.unlock'),
      run: async () => {
        await api.setActive(u.id, !u.isActive);
        reload();
      },
    });
  }

  function askDeleteGroup(g: AdminGroup) {
    setConfirm({
      title: t('admin.groups.deleteTitle', { name: g.name }),
      body: t('admin.groups.deleteBody'),
      action: t('admin.groups.delete'),
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
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setTab('users');
              setTimeout(() => document.getElementById('new-username')?.focus(), 0);
            }}
          >
            {t('admin.users.createButton')}
          </Button>
        }
      />

      <ErrorText code={error} />
      {!data && !error && <p className="m-0 text-muted">{t('common.loading')}</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-start gap-5">
            <Card
              className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5"
              aria-label={t('admin.users.listLabel')}
            >
              <Tabs
                base={tabsBase}
                label={t('admin.users.tabsLabel')}
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: 'users', label: t('admin.users.tabUsers', { count: data.users.length }) },
                  {
                    key: 'groups',
                    label: t('admin.users.tabGroups', { count: data.groups.length }),
                  },
                ]}
              />
              <div {...tabPanelProps(tabsBase, tab)}>
                {tab === 'users' ? (
                  <UsersTable
                    data={data}
                    selfId={selfId}
                    onEdit={setEditing}
                    onReset={askReset}
                    onToggleActive={askToggle}
                  />
                ) : (
                  <GroupsTable data={data} onEdit={setEditingGroup} onDelete={askDeleteGroup} />
                )}
              </div>
            </Card>
            {tab === 'users' ? (
              <CreateUserForm
                groups={data.groups}
                onCreated={(s) => {
                  reload();
                  setSecret(s);
                }}
              />
            ) : (
              <section
                aria-labelledby="create-group-title"
                className="flex flex-[1_1_300px] flex-col gap-3.5 rounded-card border-t-8 border-teal bg-card p-6 shadow-card"
              >
                <h2 id="create-group-title" className="m-0 text-section">
                  {t('admin.groups.createTitle')}
                </h2>
                <GroupForm group={null} onDone={reload} />
              </section>
            )}
          </div>

          <AssignmentsCard data={data} onChanged={reload} />
        </>
      )}

      <TempPasswordDialog secret={secret} onClose={() => setSecret(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      <EditUserDialog
        user={editing}
        self={editing?.id === selfId}
        groups={data?.groups ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
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
            onDone={() => {
              setEditingGroup(null);
              reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
