import { useState } from 'react';
import { DataTable } from '../components/DataTable';
import { ConfirmDialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FormField, Textarea, TextInput } from '../components/FormField';
import { ConclusionCard, KpiCard, KpiRow } from '../components/KpiCard';
import { PageHeader, PageShell, Section, StickyActionBar, Toolbar } from '../components/layout';
import { DatePicker } from '../components/DatePicker';
import { MonthPicker } from '../components/MonthPicker';
import { Select } from '../components/Select';
import { Stepper } from '../components/Stepper';
import { TabPanel, Tabs } from '../components/Tabs';
import { ToastProvider, useToast } from '../components/Toast';
import { Button, cardClass, cx } from '../components/ui';

/**
 * E2E-only page (e2e-showcase.html, `vite build --mode e2e`): every round-A component on one
 * screen so `e2e/ui-frame.spec.ts` can check focus, keys, timers and axe on a real DOM before the
 * screens move to them (round B). Sample labels are neutral test strings, not UI text, and no
 * data of any person.
 */
interface Account {
  id: string;
  name: string;
  runs: number;
}

const ACCOUNTS: Account[] = [
  { id: 'a1', name: 'test.user01', runs: 3 },
  { id: 'a2', name: 'test.user02', runs: 12 },
];

function ToastButtons() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast.show({ tone: 'teal', message: 'Saved sample-flow' })}>
        toast success
      </Button>
      <Button onClick={() => toast.show({ tone: 'coral', message: 'Could not lock test.user01' })}>
        toast error
      </Button>
    </div>
  );
}

function Demo() {
  const [tab, setTab] = useState('first');
  const [group, setGroup] = useState('');
  const [month, setMonth] = useState('2026-09');
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<'danger' | 'primary' | null>(null);
  const [confirmed, setConfirmed] = useState(0);
  return (
    <PageShell>
      <PageHeader eyebrow="Showcase" title="UI frame" subtitle="Round A components" />
      <Stepper
        label="Steps"
        current={1}
        steps={[
          { id: 's1', label: 'Step one' },
          { id: 's2', label: 'Step two' },
          { id: 's3', label: 'Step three' },
        ]}
      />
      <KpiRow label="Numbers">
        <KpiCard label="Matched" value={1234} tone="teal" />
        <KpiCard label="Mismatched" value={9} tone="coral" />
        <KpiCard label="Only left" value={2} tone="amber" />
        <KpiCard label="Only right" value={1} tone="amber" />
      </KpiRow>
      <ConclusionCard title="12 items need attention" text="Sample conclusion" />

      <section aria-label="Tabs demo" className={cx(cardClass, 'flex flex-col')}>
        <Toolbar end="2 tabs">
          <Tabs
            id="demo"
            label="Demo tabs"
            items={[
              { id: 'first', label: 'First', count: 3 },
              { id: 'second', label: 'Second', count: 12 },
              { id: 'third', label: 'Third' },
            ]}
            selected={tab}
            onChange={setTab}
          />
        </Toolbar>
        <TabPanel tabsId="demo" item={tab} className="p-4">
          {`panel ${tab}`}
        </TabPanel>
      </section>

      <Section title="Fields" description="FormField wiring">
        <FormField label="Name" hint="Lower case" error={name === 'x' ? 'Taken' : undefined}>
          {(f) => <TextInput {...f.input} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField label="Group" hint="Pick one" error="Required" required>
          {(f) => (
            <Select
              id={f.id}
              describedBy={f.describedBy}
              invalid={f.invalid}
              required={f.required}
              value={group}
              onChange={setGroup}
              options={[
                { value: 'g1', label: 'Group 1' },
                { value: 'g2', label: 'Group 2' },
              ]}
            />
          )}
        </FormField>
        <FormField label="Period" hint="Month of the run">
          {(f) => (
            <MonthPicker
              id={f.id}
              labelId={f.labelId}
              describedBy={f.describedBy}
              invalid={f.invalid}
              value={month}
              onChange={setMonth}
            />
          )}
        </FormField>
        <FormField label="Start date" hint="First day of validity" error="Pick a date" required>
          {(f) => (
            <DatePicker
              id={f.id}
              labelId={f.labelId}
              describedBy={f.describedBy}
              invalid={f.invalid}
              required={f.required}
              value={day}
              onChange={setDay}
            />
          )}
        </FormField>
        <FormField label="Note">{(f) => <Textarea {...f.input} />}</FormField>
        <FormField label="Keep" inline>
          {(f) => <input type="checkbox" className="size-5" {...f.input} />}
        </FormField>
      </Section>

      <Section title="Table" plain>
        <div className={cardClass}>
          <DataTable
            caption="Accounts"
            rows={ACCOUNTS}
            rowKey={(r) => r.id}
            columns={[
              { id: 'name', header: 'Name', cell: (r) => r.name, rowHeader: true },
              { id: 'runs', header: 'Runs', cell: (r) => r.runs, align: 'right' },
            ]}
            actions={{
              header: 'Actions',
              cell: (r) => (
                <Button size="sm" onClick={() => setConfirm('danger')}>
                  {`Lock ${r.name}`}
                </Button>
              ),
            }}
            empty={{ title: 'No accounts' }}
          />
        </div>
        <div className={cardClass}>
          <EmptyState title="Nothing here" text="Import a flow first." />
        </div>
      </Section>

      <Section title="Feedback">
        <ToastButtons />
        <div className="flex gap-2">
          <Button onClick={() => setConfirm('primary')}>open confirm</Button>
          <output data-testid="confirmed">{confirmed}</output>
        </div>
      </Section>

      <ConfirmDialog
        open={confirm !== null}
        tone={confirm ?? 'primary'}
        title={confirm === 'danger' ? 'Lock test.user01?' : 'Publish version 3?'}
        description="Sample consequence."
        confirmLabel={confirm === 'danger' ? 'Lock' : 'Publish'}
        onConfirm={() => {
          setConfirmed((n) => n + 1);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <StickyActionBar label="Wizard actions" note="Sample note">
        <Button variant="text">Back</Button>
        <Button variant="primary">Run</Button>
      </StickyActionBar>
    </PageShell>
  );
}

export function ShowcaseApp() {
  return (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  );
}
