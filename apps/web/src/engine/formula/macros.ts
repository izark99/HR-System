/**
 * DuckDB macros used by the `transform.formula` transpiler (compile.ts), created with the engine
 * macros when the database opens (duckdb/db.ts). They only take values (no data in their text).
 *
 * Numbers are DECIMAL(38,10). Multiplication and division are exact (DuckDB turns DECIMAL / DECIMAL
 * into DOUBLE and DECIMAL * DECIMAL into DECIMAL(38,20), which overflows early): `hrflow_fx_s`
 * gives the scaled integer (value × 10^10, HUGEINT), `hrflow_fx_u` turns it back. Every macro
 * returns NULL instead of raising (overflow, out-of-range date); the transpiler maps that NULL to
 * the Excel error (#NUM!, #VALUE!).
 */

const D = 'DECIMAL(38,10)';
const SCALE = '10000000000';
const P10 = Array.from({ length: 39 }, (_, k) => `'1${'0'.repeat(k)}'`).join(', ');

export const FORMULA_MACROS: readonly string[] = [
  // value × 10^10 as HUGEINT (exact; |x| < 10^28 → < 10^38)
  `CREATE MACRO hrflow_fx_s(x) AS CAST(trunc(x) AS HUGEINT) * ${SCALE} + CAST((x - trunc(x)) * ${SCALE} AS HUGEINT)`,
  // scaled HUGEINT → DECIMAL(38,10); NULL when out of range
  `CREATE MACRO hrflow_fx_u(n) AS TRY(CAST(CAST(n AS DECIMAL(38,0)) * 0.0000000001 AS ${D}))`,
  // n / d rounded half away from zero (HUGEINT; DuckDB // and % truncate toward zero)
  `CREATE MACRO hrflow_fx_rdiv(n, d) AS n // d + CASE WHEN 2 * abs(n % d) >= abs(d) THEN sign(n) * sign(d) ELSE 0 END`,
  // a × b, exact then rounded to 10 places (half away from zero)
  `CREATE MACRO hrflow_fx_mul(a, b) AS TRY(CAST(a * CAST(trunc(b) AS DECIMAL(38,0)) + CAST(trunc(a) AS DECIMAL(38,0)) * CAST(b - trunc(b) AS DECIMAL(11,10)) + CAST(round(CAST(a - trunc(a) AS DECIMAL(11,10)) * CAST(b - trunc(b) AS DECIMAL(11,10)), 10) AS ${D}) AS ${D}))`,
  // a / b (b <> 0) rounded half away from zero to 10 places. |b| ≥ 10^18: quotient by the integer
  // part of b (relative error < 10^-18).
  `CREATE MACRO hrflow_fx_div(a, b) AS TRY(CASE WHEN abs(hrflow_fx_s(b)) < CAST('10000000000000000000000000000' AS HUGEINT) THEN hrflow_fx_u((hrflow_fx_s(a) // hrflow_fx_s(b)) * ${SCALE} + hrflow_fx_rdiv((hrflow_fx_s(a) % hrflow_fx_s(b)) * ${SCALE}, hrflow_fx_s(b))) ELSE hrflow_fx_u(hrflow_fx_rdiv(hrflow_fx_s(a), hrflow_fx_s(b) // ${SCALE})) END)`,
  // Scaled a / b (|a|, |b| < 10^27, b <> 0) rounded half away from zero: one HUGEINT division.
  `CREATE MACRO hrflow_fx_qdiv(a, b) AS hrflow_fx_u((2 * a * ${SCALE} + sign(a) * abs(b)) // (2 * b))`,
  `CREATE MACRO hrflow_fx_p10(k) AS CAST([${P10}] AS HUGEINT[])[k + 1]`,
  // ROUND/ROUNDUP/ROUNDDOWN of x to n places; s = hrflow_fx_s(x)
  // round the scaled integer s to a multiple of p: 0 = half away from zero, 1 = up, 2 = down
  `CREATE MACRO hrflow_fx_rnd(s, p, m) AS CASE m WHEN 0 THEN (s + sign(s) * (p // 2)) // p * p WHEN 1 THEN (s + sign(s) * (p - 1)) // p * p ELSE s // p * p END`,
  `CREATE MACRO hrflow_fx_round(x, s, n, m) AS CASE WHEN n >= 10 THEN x WHEN n < -27 THEN CASE WHEN m = 1 AND x <> 0 THEN NULL ELSE CAST(0 AS ${D}) END ELSE hrflow_fx_u(hrflow_fx_rnd(s, hrflow_fx_p10(10 - n), m)) END`,
  // Excel MOD: sign of the divisor
  `CREATE MACRO hrflow_fx_mod(n, d) AS CASE WHEN n % d <> 0 AND (n % d < 0) <> (d < 0) THEN n % d + d ELSE n % d END`,
  // number → text like Excel's General format (no trailing zeros)
  `CREATE MACRO hrflow_fx_text(x) AS CASE WHEN contains(CAST(x AS VARCHAR), '.') THEN rtrim(rtrim(CAST(x AS VARCHAR), '0'), '.') ELSE CAST(x AS VARCHAR) END`,
  // text → number (plain decimal / exponent notation, surrounding spaces); NULL if not a number
  `CREATE MACRO hrflow_fx_num(x) AS CASE WHEN regexp_full_match(x, '\\s*[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?\\s*') THEN TRY_CAST(trim(x) AS ${D}) END`,
  // Excel serial number of a date (1900 date system, incl. the fictitious 1900-02-29)
  `CREATE MACRO hrflow_fx_serial(d) AS CASE WHEN d < DATE '1900-03-01' THEN date_diff('day', DATE '1899-12-31', d) ELSE date_diff('day', DATE '1899-12-30', d) END`,
  // serial number → date (serial 0 = 1899-12-31 stands for Excel's 1900-01-00); NULL out of range
  `CREATE MACRO hrflow_fx_date(n) AS CASE WHEN n < 0 OR n >= 2958466 THEN NULL WHEN n < 61 THEN DATE '1899-12-31' + CAST(floor(n) AS INTEGER) ELSE DATE '1899-12-30' + CAST(floor(n) AS INTEGER) END`,
  `CREATE MACRO hrflow_fx_dok(d) AS CASE WHEN d BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN d END`,
  // DATE(y, m, d) with Excel's carry of months/days; year 0–1899 = 1900+y
  `CREATE MACRO hrflow_fx_mkdate(y, m, d) AS CASE WHEN y < 0 OR y > 9999 THEN NULL ELSE hrflow_fx_dok(TRY(CAST(make_date(y + CASE WHEN y < 1900 THEN 1900 ELSE 0 END, 1, 1) + to_months(CAST(m - 1 AS INTEGER)) AS DATE) + CAST(d - 1 AS INTEGER))) END`,
  `CREATE MACRO hrflow_fx_months(s, e) AS (year(e) * 12 + month(e)) - (year(s) * 12 + month(s)) - CASE WHEN day(e) < day(s) THEN 1 ELSE 0 END`,
  `CREATE MACRO hrflow_fx_datedif(s, e, u) AS CASE WHEN s > e THEN NULL WHEN u = 'Y' THEN hrflow_fx_months(s, e) // 12 WHEN u = 'M' THEN hrflow_fx_months(s, e) WHEN u = 'D' THEN date_diff('day', s, e) WHEN u = 'YM' THEN hrflow_fx_months(s, e) % 12 WHEN u = 'MD' THEN CASE WHEN day(e) >= day(s) THEN day(e) - day(s) ELSE day(e) + day(CAST(date_trunc('month', e) AS DATE) - 1) - day(s) END WHEN u = 'YD' THEN CASE WHEN CAST(s + to_years(CAST(year(e) - year(s) AS INTEGER)) AS DATE) > e THEN date_diff('day', CAST(s + to_years(CAST(year(e) - year(s) - 1 AS INTEGER)) AS DATE), e) ELSE date_diff('day', CAST(s + to_years(CAST(year(e) - year(s) AS INTEGER)) AS DATE), e) END END`,
  `CREATE MACRO hrflow_fx_weekday(d, t) AS CASE t WHEN 1 THEN dayofweek(d) + 1 WHEN 2 THEN isodow(d) WHEN 3 THEN isodow(d) - 1 END`,
  // FIND / SEARCH: 1-based position from start st, NULL = #VALUE!
  `CREATE MACRO hrflow_fx_find(f, w, st) AS CASE WHEN st < 1 OR (st > length(w) AND st <> 1) THEN NULL WHEN strpos(substring(w, st), f) = 0 THEN NULL ELSE strpos(substring(w, st), f) + st - 1 END`,
  // Excel wildcards (* ? and ~ escape) → RE2 pattern, every other character literal
  `CREATE MACRO hrflow_fx_wild(p) AS replace(replace(replace(replace(replace(regexp_replace(replace(replace(replace(p, '~~', chr(1)), '~*', chr(2)), '~?', chr(3)), '([.+()\\[\\]{}|^$\\\\])', '\\\\\\1', 'g'), '*', '.*'), '?', '.'), chr(2), '\\*'), chr(3), '\\?'), chr(1), '~')`,
  `CREATE MACRO hrflow_fx_search(f, w, st) AS CASE WHEN st < 1 OR (st > length(w) AND st <> 1) THEN NULL WHEN regexp_matches(substring(w, st), '(?is)' || hrflow_fx_wild(f)) THEN length(regexp_extract(substring(w, st), '(?is)^(.*?)(?:' || hrflow_fx_wild(f) || ')', 1)) + st END`,
  // 1-based position of the k-th occurrence of o in s (k ≤ number of occurrences)
  `CREATE MACRO hrflow_fx_nth(s, o, k) AS CAST(list_sum(list_transform(string_split(s, o)[1:k], x -> length(x))) + (k - 1) * length(o) + 1 AS BIGINT)`,
  // SUBSTITUTE(s, o, n, k): replace the k-th occurrence only
  `CREATE MACRO hrflow_fx_subst(s, o, n, k) AS CASE WHEN o = '' OR len(string_split(s, o)) - 1 < k THEN s ELSE substring(s, 1, hrflow_fx_nth(s, o, k) - 1) || n || substring(s, hrflow_fx_nth(s, o, k) + length(o)) END`,
  // PROPER: upper-case a letter that follows a non-letter
  `CREATE MACRO hrflow_fx_proper(x) AS array_to_string(list_transform(list_zip(string_split(lower(x), ''), list_prepend('', string_split(lower(x), ''))), p -> CASE WHEN upper(p[2]) = lower(p[2]) THEN upper(p[1]) ELSE p[1] END), '')`,
];
