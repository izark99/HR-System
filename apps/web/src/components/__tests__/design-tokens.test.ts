/**
 * Design system guard (spec §25, §28 AC-UI-01/02/42): the v2 tokens exist in `index.css`, the v1
 * tokens are gone, and no component bypasses the tokens with arbitrary values, hex colours,
 * gradients or the dropped font weights.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...tsxFiles(path));
    } else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** Comments removed (JS line/block comments and JSX `{/* … *\/}`), keeping line numbers. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Quoted string literals ('…', "…", `…`) on one line: where class names and styles live. */
const STRING = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
/** Same, but a template literal may span lines (className={`…⏎ px-7`}): for whole-file rules. */
const STRING_ML = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;

interface Rule {
  id: string;
  re: RegExp;
  why: string;
}

const T = (name: string) => new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*${name}(?![\\w-])`);

const RULES: Rule[] = [
  // v1 tokens removed in design v2 (AC-UI-01).
  { id: 'v1-radius', re: T('rounded-(?:control|tile|callout|card-lg)'), why: 'v1 radius token' },
  { id: 'v1-shadow', re: T('shadow-(?:card|soft|header)'), why: 'v1 shadow token' },
  {
    id: 'v1-text',
    re: T('text-(?:copy|small|section)'),
    why: 'v1 type token',
  },
  { id: 'v1-sky', re: T('(?:from|via|to|bg)-sky-tint'), why: 'v1 login gradient colour' },
  // Dropped font weights (AC-UI-03/42): titles are 600, nothing is 800 (or 500).
  { id: 'weight', re: T('font-(?:extrabold|black|medium|light|thin)'), why: 'weight not in v2' },
  // Tailwind default sizes (removed from the theme) would silently generate nothing.
  {
    id: 'tw-default-text',
    re: T('text-(?:xs|sm|base|lg|xl|[2-9]xl)'),
    why: 'use a §25.1 token',
  },
  {
    id: 'tw-default-radius',
    re: T('rounded(?:-[trblse]{1,2})?-(?:xs|sm|md|lg|xl|[2-4]xl)'),
    why: 'use rounded-input/card/pill',
  },
  {
    id: 'tw-default-shadow',
    re: T('shadow-(?:2xs|xs|sm|md|lg|xl|2xl)'),
    why: 'only shadow-float exists',
  },
  // Arbitrary values bypassing tokens (AC-UI-02).
  { id: 'arbitrary-text', re: /(?<![\w-])(?:[a-z0-9-]+:)*text-\[[^\]]*px\]/, why: 'text-[…px]' },
  {
    id: 'arbitrary-radius',
    re: /(?<![\w-])(?:[a-z0-9-]+:)*rounded(?:-[a-z]+)?-\[/,
    why: 'rounded-[…]',
  },
  { id: 'arbitrary-shadow', re: /(?<![\w-])(?:[a-z0-9-]+:)*shadow-\[/, why: 'shadow-[…]' },
  { id: 'arbitrary-tracking', re: /(?<![\w-])(?:[a-z0-9-]+:)*tracking-\[/, why: 'tracking-[…]' },
  {
    id: 'gradient',
    re: /(?<![\w-])(?:[a-z0-9-]+:)*bg-(?:linear|radial|conic|gradient)-/,
    why: 'gradient',
  },
  // Raw colours in className/style strings.
  {
    id: 'hex',
    re: /(?<![\w&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?(?![\w-])/,
    why: 'hex colour',
  },
  { id: 'rgb', re: /\b(?:rgba?|hsla?)\(/, why: 'rgb()/hsl() colour' },
];

/**
 * Exceptions, each with a reason: `file` relative to src/, `rule` id, `includes` a substring of
 * the offending string literal. Keep this list short.
 */
const ALLOW: { file: string; rule: string; includes: string; reason: string }[] = [];

interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const path of tsxFiles(SRC)) {
    const file = relative(SRC, path);
    const lines = stripComments(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const literal of line.match(STRING) ?? []) {
        for (const rule of RULES) {
          if (!rule.re.test(literal)) continue;
          if (
            ALLOW.some((a) => a.file === file && a.rule === rule.id && literal.includes(a.includes))
          )
            continue;
          hits.push({ file, line: i + 1, rule: `${rule.id} (${rule.why})`, text: literal });
        }
      }
    });
  }
  return hits;
}

// ---- frame rules (spec §25.5, §29.1 AC-UI-61) ---------------------------------------------

/** Spacing utilities (gap / padding / margin / space-between) and the values of the §25.5 scale. */
const SPACING_UTIL = '-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])';
const SPACING_OK = new Set([
  '0',
  '0.5',
  '1',
  '2',
  '3',
  '4',
  '6',
  '8',
  '12',
  '16',
  'px',
  'auto',
  // Semantic tokens of index.css (§25.5).
  'page-x',
  'page-top',
  'section',
  'stack',
  'inline',
]);
const SPACING_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z0-9-]+:)*(${SPACING_UTIL})-(\\[[^\\]]*\\]|[a-z0-9.-]+)!?(?![\\w.-])`,
  'g',
);

/** Off-scale spacing classes in one string literal (`px-3.5`, `gap-5`, `p-[10px]`). */
function offScaleSpacing(literal: string): string[] {
  const out: string[] = [];
  for (const m of literal.matchAll(SPACING_CLASS)) {
    const value = m[2]!;
    if (!SPACING_OK.has(value)) out.push(m[0]);
  }
  return out;
}

interface FrameRule {
  id: string;
  why: string;
  /** File (relative to src/) allowed to do it: the component that owns the pattern. */
  owner: (file: string) => boolean;
  /** Matches in the comment-free source of one file. */
  find: (source: string) => string[];
}

const DEPRECATED_TEXT =
  /(?<![\w-])(?:[a-z0-9-]+:)*text-(?:display-xl|display-lg|body-lg)(?![\w-])/g;

const FRAME_RULES: FrameRule[] = [
  {
    id: 'spacing',
    why: 'gap/padding/margin outside the 4·8·12·16·24·32·48·64 scale',
    owner: () => false,
    find: (src) => (src.match(STRING_ML) ?? []).flatMap(offScaleSpacing),
  },
  {
    id: 'main',
    why: '<main> outside PageShell',
    owner: (f) => f === 'components/layout/PageShell.tsx',
    find: (src) => src.match(/<main\b/g) ?? [],
  },
  {
    id: 'tablist',
    why: 'role="tablist" outside Tabs',
    owner: (f) => f === 'components/Tabs.tsx',
    find: (src) => src.match(/role=["'{`]+tablist/g) ?? [],
  },
  {
    id: 'table',
    why: '<table> outside DataTable (dense/diff tables are allowed below)',
    owner: (f) => f === 'components/DataTable.tsx',
    find: (src) => src.match(/<table\b/g) ?? [],
  },
  {
    id: 'deprecated-text',
    why: 'text-display-xl / text-display-lg / text-body-lg (AC-UI-60, deleted in round B)',
    owner: () => false,
    find: (src) => (src.match(STRING_ML) ?? []).flatMap((l) => l.match(DEPRECATED_TEXT) ?? []),
  },
  {
    id: 'svg',
    why: 'icon SVG outside components/icons (AC-UI-69)',
    owner: (f) => f.startsWith('components/icons/'),
    find: (src) => src.match(/<svg\b/g) ?? [],
  },
];

/**
 * Permanent exceptions to the frame rules, each with its reason; `only` limits an exception to
 * those matches (the rest of the file still follows the rule). Keep this list short.
 */
const FRAME_ALLOW: { file: string; rule: string; reason: string; only?: string[] }[] = [
  {
    file: 'features/runner/components/ResultTable.tsx',
    rule: 'table',
    reason: 'dense, virtualised result sheet (§25.5: large data tables keep their own component)',
  },
  {
    file: 'features/designer/DataPanel.tsx',
    rule: 'table',
    reason: 'dense Designer preview table (§25.1 high-density exception)',
  },
  {
    file: 'features/admin/versions/DiffView.tsx',
    rule: 'table',
    reason: 'side-by-side JSON diff of two versions, not an admin list',
  },
  {
    file: 'features/designer/formula/FormulaForm.tsx',
    rule: 'table',
    reason: 'dense reference table of supported functions beside the canvas',
  },
  {
    file: 'components/ui.tsx',
    rule: 'spacing',
    reason:
      'OneLine: -my-5 py-5 keeps stacked Vietnamese marks inside the clipping box (cancels out, no layout change)',
    only: ['-my-5', 'py-5'],
  },
];

/**
 * TEMPORARY: screens (and older shared pieces) that still break a frame rule because round A only
 * built the components. ROUND B MUST EMPTY THIS LIST: each screen moved to PageShell / Tabs /
 * DataTable / the new tokens leaves it, and the test fails when an entry no longer has a hit
 * (stale) or when a file NOT listed here breaks a rule.
 */
const PENDING_ROUND_B: { file: string; rules: string[] }[] = [
  { file: 'components/Menu.tsx', rules: ['spacing'] },
  { file: 'components/MonthPicker.tsx', rules: ['spacing'] },
  { file: 'components/Select.tsx', rules: ['spacing'] },
  { file: 'components/Skeleton.tsx', rules: ['spacing'] },
  { file: 'components/Tooltip.tsx', rules: ['spacing'] },
  { file: 'components/picker-shared.tsx', rules: ['spacing'] },
  { file: 'components/ui.tsx', rules: ['spacing', 'deprecated-text'] },
  { file: 'features/admin/AdminFlowsPage.tsx', rules: ['spacing', 'table'] },
  { file: 'features/admin/AdminLayout.tsx', rules: ['spacing', 'main'] },
  { file: 'features/admin/AdminUsersPage.tsx', rules: ['spacing', 'tablist', 'table'] },
  { file: 'features/admin/versions/DiffView.tsx', rules: ['spacing'] },
  {
    file: 'features/admin/versions/FlowVersionsPage.tsx',
    rules: ['spacing', 'table', 'deprecated-text'],
  },
  { file: 'features/designer/ConfigPanel.tsx', rules: ['spacing', 'tablist'] },
  { file: 'features/designer/DataPanel.tsx', rules: ['spacing', 'tablist'] },
  { file: 'features/designer/DesignerEditor.tsx', rules: ['spacing', 'deprecated-text'] },
  { file: 'features/designer/DesignerPage.tsx', rules: ['spacing', 'deprecated-text'] },
  { file: 'features/designer/Palette.tsx', rules: ['spacing'] },
  { file: 'features/designer/StatusBar.tsx', rules: ['spacing'] },
  { file: 'features/designer/canvas/nodes.tsx', rules: ['spacing'] },
  { file: 'features/designer/forms/NodeForms.tsx', rules: ['spacing'] },
  { file: 'features/designer/forms/ParamsForm.tsx', rules: ['spacing'] },
  { file: 'features/designer/forms/SlotForm.tsx', rules: ['spacing'] },
  { file: 'features/designer/forms/fields.tsx', rules: ['spacing'] },
  { file: 'features/designer/formula/FormulaForm.tsx', rules: ['spacing'] },
  { file: 'features/runner/FlowListPage.tsx', rules: ['spacing', 'main', 'table'] },
  {
    file: 'features/runner/ResultPage.tsx',
    rules: ['spacing', 'main', 'tablist', 'deprecated-text'],
  },
  { file: 'features/runner/RunPage.tsx', rules: ['spacing', 'main'] },
  { file: 'features/runner/components/ParamsCard.tsx', rules: ['spacing'] },
  { file: 'features/runner/components/ResultTable.tsx', rules: ['spacing'] },
  { file: 'features/runner/components/RunProgress.tsx', rules: ['spacing'] },
  { file: 'features/runner/components/SlotCard.tsx', rules: ['spacing'] },
  { file: 'features/runner/components/Steps.tsx', rules: ['spacing'] },
  { file: 'features/runner/components/ValidationReport.tsx', rules: ['table'] },
];

interface FrameHit {
  file: string;
  rule: string;
  matches: string[];
}

function scanFrame(): FrameHit[] {
  const hits: FrameHit[] = [];
  for (const path of tsxFiles(SRC)) {
    const file = relative(SRC, path).split('\\').join('/');
    const src = stripComments(readFileSync(path, 'utf8'));
    for (const rule of FRAME_RULES) {
      if (rule.owner(file)) continue;
      let matches = rule.find(src);
      for (const a of FRAME_ALLOW.filter((x) => x.file === file && x.rule === rule.id))
        matches = a.only ? matches.filter((m) => !a.only!.includes(m)) : [];
      if (matches.length === 0) continue;
      hits.push({ file, rule: rule.id, matches });
    }
  }
  return hits;
}

describe('design tokens (index.css @theme)', () => {
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

  it.each([
    ['--text-kpi', '40px'],
    ['--text-kpi--line-height', '44px'],
    ['--text-kpi--font-weight', '600'],
    ['--text-page-title-showcase', '32px'],
    ['--text-page-title-showcase--line-height', '40px'],
    ['--text-page-title-showcase--font-weight', '600'],
    ['--text-page-title', '28px'],
    ['--text-page-title--line-height', '36px'],
    ['--text-page-title--font-weight', '600'],
    ['--text-title-md', '24px'],
    ['--text-title-sm', '20px'],
    ['--text-body', '16px'],
    ['--text-label', '16px'],
    ['--text-caption', '14px'],
    ['--text-eyebrow', '14px'],
    ['--text-button', '16px'],
    ['--text-button--line-height', '24px'],
    ['--text-button-sm', '14.4px'],
    ['--text-title-sm--font-weight', '700'],
    ['--text-eyebrow--font-weight', '500'],
    ['--text-code', '14px'],
    ['--text-dense', '14px'],
    ['--radius-input', '6px'],
    ['--radius-card', '12px'],
    ['--radius-pill', '999px'],
    ['--shadow-float', '0 8px 28px rgba(31, 42, 68, 0.12)'],
    ['--color-line-input', '#475569'],
    ['--color-ink', '#1f2a44'],
    ['--color-line', '#e2e8f0'],
    ['--spacing-control', '44px'],
    ['--spacing-control-sm', '36px'],
    ['--spacing-row', '48px'],
    ['--spacing-page-x', '32px'],
    ['--spacing-page-top', '24px'],
    ['--spacing-section', '24px'],
    ['--spacing-stack', '16px'],
    ['--spacing-inline', '8px'],
  ])('%s is %s', (name, value) => {
    expect(theme).toMatch(new RegExp(`\\n\\s*${name}:\\s*${value.replace(/[().]/g, '\\$&')};`));
  });

  it('declares the mobile (< 768px) type scale', () => {
    const mobile = /@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(mobile).toMatch(/--text-kpi:\s*32px;/);
    expect(mobile).toMatch(/--text-kpi--line-height:\s*36px;/);
    expect(mobile).toMatch(/--text-page-title-showcase:\s*24px;/);
    expect(mobile).toMatch(/--text-page-title-showcase--line-height:\s*32px;/);
    expect(mobile).toMatch(/--text-page-title:\s*24px;/);
    expect(mobile).toMatch(/--text-page-title--line-height:\s*32px;/);
    expect(mobile).toMatch(/--text-title-md:\s*20px;/);
    expect(mobile).toMatch(/--text-title-sm:\s*18px;/);
    expect(mobile).toMatch(/--text-eyebrow:\s*13px;/);
    expect(mobile).toMatch(/--spacing-page-x:\s*16px;/);
    expect(mobile).toMatch(/--spacing-page-top:\s*16px;/);
    expect(mobile).toMatch(/--spacing-section:\s*16px;/);
  });

  it('has no v1 token left', () => {
    for (const v1 of [
      '--radius-card-lg',
      '--radius-tile',
      '--radius-callout',
      '--radius-control',
      '--shadow-card',
      '--shadow-soft',
      '--shadow-header',
      '--text-copy',
      '--text-small',
      '--text-section',
      '--color-sky-tint',
      '--color-body:',
    ]) {
      expect(theme, v1).not.toContain(v1);
    }
    expect(theme).not.toMatch(/--radius-card:\s*20px/);
  });

  it('only one shadow exists and it is the level-2 float shadow', () => {
    expect(theme.match(/--shadow-[\w*-]+:/g)).toEqual(['--shadow-*:', '--shadow-float:']);
  });

  it('self-hosts Be Vietnam Pro without weight 800', () => {
    const weights = [...css.matchAll(/font-weight:\s*(\d+);/g)].map((m) => m[1]);
    expect(new Set(weights)).toEqual(new Set(['400', '500', '600', '700']));
    expect(css).not.toMatch(/https?:\/\//);
  });
});

describe('components use tokens only (AC-UI-02)', () => {
  it('finds no v1 class, arbitrary value, gradient, raw colour or dropped weight in .tsx', () => {
    const hits = scan().map((h) => `${h.file}:${h.line} ${h.rule}: ${h.text}`);
    expect(hits).toEqual([]);
  });

  it('the scanner catches each forbidden pattern', () => {
    const samples: [string, string][] = [
      ["'rounded-control px-3'", 'v1-radius'],
      ["'p-6 shadow-card'", 'v1-shadow'],
      ["'hover:shadow-soft'", 'v1-shadow'],
      ["'text-small text-muted'", 'v1-text'],
      ["'font-extrabold'", 'weight'],
      ["'text-[40px]'", 'arbitrary-text'],
      ["'rounded-[10px]'", 'arbitrary-radius'],
      ["'shadow-[0_1px_0_#000]'", 'arbitrary-shadow'],
      ["'bg-linear-135 from-teal'", 'gradient'],
      ["'bg-[#ff0000]'", 'hex'],
      ['"color: rgb(1, 2, 3)"', 'rgb'],
      ["'text-xs'", 'tw-default-text'],
      ["'rounded-lg'", 'tw-default-radius'],
    ];
    for (const [literal, id] of samples) {
      const rule = RULES.find((r) => r.id === id)!;
      expect(rule.re.test(literal), `${id} should catch ${literal}`).toBe(true);
    }
    // New tokens with similar names are allowed.
    for (const ok of [
      "'rounded-card'",
      "'text-page-title'",
      "'text-kpi'",
      "'text-caption'",
      "'shadow-float'",
    ]) {
      expect(
        RULES.filter((r) => r.re.test(ok)).map((r) => r.id),
        ok,
      ).toEqual([]);
    }
  });
});

describe('frame rules (AC-UI-61)', () => {
  const hits = scanFrame();
  const pending = (file: string, rule: string) =>
    PENDING_ROUND_B.some((p) => p.file === file && p.rules.includes(rule));

  it('no file outside PENDING_ROUND_B breaks a frame rule', () => {
    const fresh = hits
      .filter((h) => !pending(h.file, h.rule))
      .map((h) => {
        const why = FRAME_RULES.find((r) => r.id === h.rule)!.why;
        return `${h.file} ${h.rule} (${why}): ${[...new Set(h.matches)].join(' ')}`;
      });
    expect(fresh).toEqual([]);
  });

  it('PENDING_ROUND_B has no stale entry (remove a file once it is moved)', () => {
    const stale = PENDING_ROUND_B.flatMap((p) =>
      p.rules
        .filter((rule) => !hits.some((h) => h.file === p.file && h.rule === rule))
        .map((rule) => `${p.file} ${rule}`),
    );
    expect(stale).toEqual([]);
  });

  it('every permanent exception names a real file and gives a reason', () => {
    for (const a of FRAME_ALLOW) {
      expect(tsxFiles(SRC).some((p) => relative(SRC, p).split('\\').join('/') === a.file)).toBe(
        true,
      );
      expect(a.reason.length).toBeGreaterThan(10);
      expect(FRAME_RULES.some((r) => r.id === a.rule)).toBe(true);
    }
  });

  it('the frame scanner catches each pattern', () => {
    const rule = (id: string) => FRAME_RULES.find((r) => r.id === id)!;
    for (const bad of [
      "'px-3.5'",
      "'gap-2.5'",
      "'mt-1.5'",
      "'p-5'",
      "'py-7'",
      "'-mx-9'",
      "'gap-10'",
      "'pb-11'",
      "'md:px-5'",
      "'gap-[10px]'",
      "'p-[3px]'",
      "'px-20'",
      "'space-y-5'",
    ])
      expect(rule('spacing').find(bad), bad).not.toEqual([]);
    for (const ok of [
      "'px-4 py-2 gap-0.5 m-0 mx-auto'",
      "'gap-section px-page-x pt-page-top gap-stack gap-inline'",
      "'md:px-8 -my-1 px-0! pb-12 p-16'",
      "'h-10.5 w-62 size-5 min-w-40 top-1.5'",
    ])
      expect(rule('spacing').find(ok), ok).toEqual([]);
    expect(rule('main').find('<main id="main">')).toHaveLength(1);
    expect(rule('tablist').find('<div role="tablist">')).toHaveLength(1);
    expect(rule('table').find('<table className="w-full">')).toHaveLength(1);
    expect(rule('deprecated-text').find("'m-0 text-display-lg'")).toHaveLength(1);
    expect(rule('deprecated-text').find("'max-md:text-body-lg'")).toHaveLength(1);
    expect(rule('deprecated-text').find("'text-body text-page-title'")).toHaveLength(0);
    expect(rule('svg').find('<svg viewBox="0 0 24 24">')).toHaveLength(1);
    expect(rule('main').owner('components/layout/PageShell.tsx')).toBe(true);
    expect(rule('table').owner('features/admin/AdminUsersPage.tsx')).toBe(false);
  });
});
