/**
 * Excel formula parser of `transform.formula` (spec §12.2 "Cú pháp"). Pure TS, shared by the
 * engine and the Designer. Column references are `[Tiêu đề]` / `[key]` (`]]` escapes `]`),
 * arguments are separated by `,`, the decimal separator is `.` (MEMORY 2026-10-30 13:24).
 */

/** Error found in a formula: i18n key (engine namespace) + params, with the character range. */
export class FormulaError extends Error {
  constructor(
    readonly messageKey: string,
    readonly params: Record<string, unknown> = {},
    /** 0-based offset in the formula text, when known. */
    readonly pos?: number,
    readonly end?: number,
  ) {
    super(messageKey);
    this.name = 'FormulaError';
  }
}

/** Nesting limit of function calls / parentheses (spec §12.2). */
export const MAX_DEPTH = 64;
export const MAX_LENGTH = 2000;

export type TokenType = 'num' | 'str' | 'ref' | 'ident' | 'op' | 'lp' | 'rp' | 'comma' | 'eof';

export interface Token {
  type: TokenType;
  /** Number text, string value (unescaped), reference name (unescaped), identifier, operator. */
  value: string;
  pos: number;
  end: number;
}

export type Ast =
  | { k: 'num'; text: string; pos: number; end: number }
  | { k: 'str'; value: string; pos: number; end: number }
  | { k: 'bool'; value: boolean; pos: number; end: number }
  | { k: 'ref'; name: string; pos: number; end: number }
  | { k: 'call'; name: string; args: Ast[]; pos: number; end: number; nameEnd: number }
  | { k: 'unary'; op: '-' | '+'; arg: Ast; pos: number; end: number }
  | { k: 'pct'; arg: Ast; pos: number; end: number }
  | { k: 'bin'; op: string; left: Ast; right: Ast; pos: number; end: number };

function syntax(context: string, pos: number, end = pos + 1): FormulaError {
  return new FormulaError('formula.error.syntax', { context, pos: pos + 1 }, pos, end);
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS = ['<>', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '^', '&', '%'];

/** Tokens after the leading `=`. Offsets are relative to the whole formula text. */
export function tokenize(text: string, from: number): Token[] {
  const out: Token[] = [];
  let i = from;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (ch === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= text.length) throw syntax('unterminatedString', start, text.length);
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i];
        i++;
      }
      out.push({ type: 'str', value, pos: start, end: i });
      continue;
    }
    if (ch === '[') {
      let name = '';
      i++;
      for (;;) {
        if (i >= text.length) throw syntax('unterminatedRef', start, text.length);
        if (text[i] === ']') {
          if (text[i + 1] === ']') {
            name += ']';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        name += text[i];
        i++;
      }
      if (name.trim() === '') throw syntax('emptyRef', start, i);
      out.push({ type: 'ref', value: name, pos: start, end: i });
      continue;
    }
    if (ch === ';') throw syntax('semicolon', start);
    if (ch === '(' || ch === ')' || ch === ',') {
      out.push({
        type: ch === '(' ? 'lp' : ch === ')' ? 'rp' : 'comma',
        value: ch,
        pos: i,
        end: i + 1,
      });
      i++;
      continue;
    }
    const rest = text.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      out.push({ type: 'num', value: num[0], pos: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      out.push({ type: 'ident', value: id[0], pos: i, end: i + id[0].length });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ type: 'op', value: op, pos: i, end: i + op.length });
      i += op.length;
      continue;
    }
    throw syntax('unexpectedChar', i);
  }
  out.push({ type: 'eof', value: '', pos: text.length, end: text.length });
  return out;
}

/** Offset of the leading `=` (after optional whitespace), or -1. */
export function equalsOffset(text: string): number {
  const m = /^\s*=/.exec(text);
  return m ? m[0].length - 1 : -1;
}

const CMP = new Set(['=', '<>', '<', '>', '<=', '>=']);

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }
  private next(): Token {
    return this.tokens[this.i++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === v;
  }

  parse(): Ast {
    if (this.peek().type === 'eof') throw syntax('empty', this.peek().pos);
    const ast = this.comparison();
    const t = this.peek();
    if (t.type !== 'eof') throw syntax(t.type === 'rp' ? 'unbalanced' : 'unexpected', t.pos, t.end);
    return ast;
  }

  private enter(pos: number): void {
    if (++this.depth > MAX_DEPTH) {
      throw new FormulaError('formula.error.tooDeep', { max: MAX_DEPTH }, pos, pos + 1);
    }
  }

  private comparison(): Ast {
    let left = this.concat();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || !CMP.has(t.value)) return left;
      this.next();
      const right = this.concat();
      left = { k: 'bin', op: t.value, left, right, pos: left.pos, end: right.end };
    }
  }

  private concat(): Ast {
    let left = this.additive();
    while (this.isOp('&')) {
      this.next();
      const right = this.additive();
      left = { k: 'bin', op: '&', left, right, pos: left.pos, end: right.end };
    }
    return left;
  }

  private additive(): Ast {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      const right = this.multiplicative();
      left = { k: 'bin', op, left, right, pos: left.pos, end: right.end };
    }
    return left;
  }

  private multiplicative(): Ast {
    let left = this.power();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next().value;
      const right = this.power();
      left = { k: 'bin', op, left, right, pos: left.pos, end: right.end };
    }
    return left;
  }

  /** `^` is left-associative in Excel (2^3^2 = 64). */
  private power(): Ast {
    let left = this.percent();
    while (this.isOp('^')) {
      this.next();
      const right = this.percent();
      left = { k: 'bin', op: '^', left, right, pos: left.pos, end: right.end };
    }
    return left;
  }

  private percent(): Ast {
    let arg = this.unary();
    while (this.isOp('%')) {
      const t = this.next();
      arg = { k: 'pct', arg, pos: arg.pos, end: t.end };
    }
    return arg;
  }

  /** Negation binds tighter than `^` in Excel (-2^2 = 4). */
  private unary(): Ast {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      this.enter(t.pos);
      const arg = this.unary();
      this.depth--;
      return { k: 'unary', op: t.value, arg, pos: t.pos, end: arg.end };
    }
    return this.primary();
  }

  private primary(): Ast {
    const t = this.next();
    switch (t.type) {
      case 'num':
        return { k: 'num', text: t.value, pos: t.pos, end: t.end };
      case 'str':
        return { k: 'str', value: t.value, pos: t.pos, end: t.end };
      case 'ref':
        return { k: 'ref', name: t.value, pos: t.pos, end: t.end };
      case 'lp': {
        this.enter(t.pos);
        const inner = this.comparison();
        const close = this.next();
        if (close.type !== 'rp') throw syntax('missingParen', close.pos, close.end);
        this.depth--;
        return { ...inner, pos: t.pos, end: close.end };
      }
      case 'ident': {
        const upper = t.value.toUpperCase().replace(/^_XLFN\.|^_XLWS\./, '');
        if (this.peek().type === 'lp') return this.call(upper, t);
        if (upper === 'TRUE' || upper === 'FALSE') {
          return { k: 'bool', value: upper === 'TRUE', pos: t.pos, end: t.end };
        }
        if (/^\$?[A-Z]{1,3}\$?\d+$/.test(upper)) throw syntax('cellRef', t.pos, t.end);
        throw syntax('name', t.pos, t.end);
      }
      case 'eof':
        throw syntax('end', t.pos);
      default:
        throw syntax('unexpected', t.pos, t.end);
    }
  }

  private call(name: string, t: Token): Ast {
    const open = this.next();
    this.enter(open.pos);
    const args: Ast[] = [];
    if (this.peek().type === 'rp') {
      const close = this.next();
      this.depth--;
      return { k: 'call', name, args, pos: t.pos, end: close.end, nameEnd: t.end };
    }
    for (;;) {
      args.push(this.comparison());
      const sep = this.next();
      if (sep.type === 'comma') continue;
      if (sep.type === 'rp') {
        this.depth--;
        return { k: 'call', name, args, pos: t.pos, end: sep.end, nameEnd: t.end };
      }
      throw syntax(sep.type === 'eof' ? 'missingParen' : 'unexpected', sep.pos, sep.end);
    }
  }
}

/** Parse a formula (must start with `=`). Throws `FormulaError` (`formula.error.syntax`, …). */
export function parseFormula(text: string): Ast {
  if (text.length > MAX_LENGTH) {
    throw new FormulaError('formula.error.tooLong', { max: MAX_LENGTH }, MAX_LENGTH, text.length);
  }
  const eq = equalsOffset(text);
  if (eq < 0) throw syntax('missingEquals', 0);
  return new Parser(tokenize(text, eq + 1)).parse();
}
