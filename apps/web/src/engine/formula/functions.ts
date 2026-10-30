/**
 * Excel functions of `transform.formula` (spec §9.1, §12.2): name, group and argument count.
 * Pure data shared by the engine (transpiler) and the Designer (completion, "Hàm hỗ trợ" table);
 * descriptions, syntax and examples are i18n texts (`designer:formula.fn.<NAME>`).
 */

export type FunctionGroup = 'logic' | 'math' | 'text' | 'date' | 'param';

export const FUNCTION_GROUPS: FunctionGroup[] = ['logic', 'math', 'text', 'date', 'param'];

export interface FunctionSpec {
  name: string;
  group: FunctionGroup;
  min: number;
  /** `Infinity` = variadic. */
  max: number;
}

const f = (name: string, group: FunctionGroup, min: number, max: number): FunctionSpec => ({
  name,
  group,
  min,
  max,
});

const MANY = 255;

export const FUNCTIONS: FunctionSpec[] = [
  f('IF', 'logic', 2, 3),
  f('IFS', 'logic', 2, 254),
  f('AND', 'logic', 1, MANY),
  f('OR', 'logic', 1, MANY),
  f('NOT', 'logic', 1, 1),
  f('SWITCH', 'logic', 3, 254),
  f('IFERROR', 'logic', 2, 2),
  f('ISBLANK', 'logic', 1, 1),
  f('ISNUMBER', 'logic', 1, 1),
  f('ROUND', 'math', 2, 2),
  f('ROUNDUP', 'math', 2, 2),
  f('ROUNDDOWN', 'math', 2, 2),
  f('INT', 'math', 1, 1),
  f('ABS', 'math', 1, 1),
  f('MIN', 'math', 1, MANY),
  f('MAX', 'math', 1, MANY),
  f('MOD', 'math', 2, 2),
  f('SUM', 'math', 1, MANY),
  f('LEFT', 'text', 1, 2),
  f('RIGHT', 'text', 1, 2),
  f('MID', 'text', 3, 3),
  f('LEN', 'text', 1, 1),
  f('TRIM', 'text', 1, 1),
  f('UPPER', 'text', 1, 1),
  f('LOWER', 'text', 1, 1),
  f('PROPER', 'text', 1, 1),
  f('CONCAT', 'text', 1, MANY),
  f('TEXTJOIN', 'text', 3, 252),
  f('SUBSTITUTE', 'text', 3, 4),
  f('FIND', 'text', 2, 3),
  f('SEARCH', 'text', 2, 3),
  f('VALUE', 'text', 1, 1),
  f('DATE', 'date', 3, 3),
  f('YEAR', 'date', 1, 1),
  f('MONTH', 'date', 1, 1),
  f('DAY', 'date', 1, 1),
  f('EDATE', 'date', 2, 2),
  f('EOMONTH', 'date', 2, 2),
  f('DATEDIF', 'date', 3, 3),
  f('WEEKDAY', 'date', 1, 2),
  f('PARAM', 'param', 1, 1),
];

export const FUNCTION_BY_NAME = new Map(FUNCTIONS.map((s) => [s.name, s]));

/** Lookup functions: suggest the Join node instead (spec §9.1, AC-B4-02). */
export const LOOKUP_FUNCTIONS = new Set([
  'XLOOKUP',
  'VLOOKUP',
  'HLOOKUP',
  'LOOKUP',
  'INDEX',
  'MATCH',
  'XMATCH',
]);
