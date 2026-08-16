/**
 * Spreadsheet-style formula engine: tokenizer → AST → evaluator over the
 * table document. Supports cell refs (A1), ranges (A1:B3), numbers, strings,
 * booleans, arithmetic, and a whitelist of functions. Evaluation is relative
 * to the formula cell; errors surface as the '#ERROR' string. The engine is
 * pure — the controller owns caching and recalc scheduling.
 */
import type { CellValue, TableDoc } from './types.ts'

/** Column letter for a zero-based column index (A, B, ..., Z, AA...). */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

/** Parse a cell reference like 'B3' → {col, row} (0-based), or null. */
export function parseRef(text: string): { col: number; row: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(text.trim())
  if (match === null) return null
  /* v8 ignore next -- the regex guarantees both groups when the match succeeds. */
  const letters = match[1] ?? ''
  let col = 0
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  /* v8 ignore next -- the regex guarantees group 2. */
  return { col: col - 1, row: Number(match[2] ?? '1') - 1 }
}

const ERROR = '#ERROR'

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'lp' } | { kind: 'rp' } | { kind: 'comma' }

/** Tokenize a formula body (without the leading '='). */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    /* v8 ignore next -- i < source.length guarantees a real character. */
    const ch = source[i] ?? ''
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    if (ch === '(') { tokens.push({ kind: 'lp' }); i += 1; continue }
    if (ch === ')') { tokens.push({ kind: 'rp' }); i += 1; continue }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i += 1; continue }
    if (ch === '"') {
      let value = ''
      i += 1
      while (i < source.length && source[i] !== '"') {
        /* v8 ignore next -- the loop guard guarantees source[i] exists. */
        value += source[i] ?? ''
        i += 1
      }
      tokens.push({ kind: 'str', value })
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let value = ''
      /* v8 ignore next -- the loop guard guarantees source[i] exists. */
      while (i < source.length && /[0-9.]/.test(source[i] ?? '')) { value += source[i] ?? ''; i += 1 }
      tokens.push({ kind: 'num', value: Number(value) })
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let value = ''
      /* v8 ignore next -- the loop guard guarantees source[i] exists. */
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] ?? '')) { value += source[i] ?? ''; i += 1 }
      tokens.push({ kind: 'id', value })
      continue
    }
    if ('+-*/%^&<=>!:'.includes(ch)) {
      let value = ch
      const nextCh = source[i + 1] ?? ''
      const merge = ch === '=' ? nextCh === '=' : ch === '!' ? nextCh === '=' : ['=', '<', '>'].includes(nextCh)
      if (merge) {
        value += nextCh
        i += 1
      }
      tokens.push({ kind: 'op', value })
      i += 1
      continue
    }
    // Unknown char: skip (lenient).
    i += 1
  }
  return tokens
}

type Ast =
  | { t: 'num'; value: number }
  | { t: 'bool'; value: boolean }
  | { t: 'str'; value: string }
  | { t: 'ref'; col: number; row: number }
  | { t: 'range'; c0: number; r0: number; c1: number; r1: number }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'bin'; op: string; left: Ast; right: Ast }
  | { t: 'un'; op: string; operand: Ast }

/** Parse tokens into an AST (precedence: or < and < compare < add < mul < unary). */
export function parseFormula(source: string): Ast | null {
  const tokens = tokenize(source)
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const next = (): Token | undefined => tokens[pos++]

  function parseOr(): Ast {
    let left = parseAnd()
    /* v8 ignore start -- the tokenizer yields OR/AND as id tokens, so the operator forms never appear. */
    while (peek()?.kind === 'op' && (peek() as { value: string }).value === 'OR') {
      next()
      left = { t: 'bin', op: 'OR', left, right: parseAnd() }
    }
    /* v8 ignore stop */
    return left
  }
  function parseAnd(): Ast {
    let left = parseCompare()
    /* v8 ignore start -- the tokenizer yields OR/AND as id tokens, so the operator forms never appear. */
    while (peek()?.kind === 'op' && (peek() as { value: string }).value === 'AND') {
      next()
      left = { t: 'bin', op: 'AND', left, right: parseCompare() }
    }
    /* v8 ignore stop */
    return left
  }
  function parseCompare(): Ast {
    let left = parseAdd()
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && ['=', '<>', '<=', '>=', '<', '>'].includes(token.value)) {
        next()
        left = { t: 'bin', op: token.value, left, right: parseAdd() }
      } else if (token?.kind === 'op' && ['==', '!='].includes(token.value)) {
        next()
        left = { t: 'bin', op: token.value === '==' ? '=' : '<>', left, right: parseAdd() }
      } else {
        break
      }
    }
    return left
  }
  function parseAdd(): Ast {
    let left = parseMul()
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && (token.value === '+' || token.value === '-')) {
        next()
        left = { t: 'bin', op: token.value, left, right: parseMul() }
      } else {
        break
      }
    }
    return left
  }
  function parseMul(): Ast {
    let left = parseUnary()
    for (;;) {
      const token = peek()
      if (token?.kind === 'op' && ['*', '/', '%', '^'].includes(token.value)) {
        next()
        left = { t: 'bin', op: token.value, left, right: parseUnary() }
      } else {
        break
      }
    }
    return left
  }
  function parseUnary(): Ast {
    const token = peek()
    if (token?.kind === 'op' && (token.value === '-' || token.value === '+')) {
      next()
      return { t: 'un', op: token.value, operand: parseUnary() }
    }
    return parsePrimary()
  }
  function parsePrimary(): Ast {
    const token = next()
    if (token === undefined) throw new Error('unexpected end')
    switch (token.kind) {
      case 'num': return { t: 'num', value: token.value }
      case 'str': return { t: 'str', value: token.value }
      case 'lp': {
        const inner = parseOr()
        if (peek()?.kind !== 'rp') throw new Error('missing )')
        next()
        return inner
      }
      case 'id': {
        if (token.value === 'TRUE') return { t: 'bool', value: true }
        if (token.value === 'FALSE') return { t: 'bool', value: false }
        if (peek()?.kind === 'lp') {
          next()
          const args: Ast[] = []
          if (peek()?.kind !== 'rp') {
            for (;;) {
              args.push(parseOr())
              if (peek()?.kind === 'comma') { next(); continue }
              break
            }
          }
          if (peek()?.kind !== 'rp') throw new Error('missing )')
          next()
          return { t: 'call', name: token.value.toUpperCase(), args }
        }
        const ref = parseRef(token.value)
        if (ref !== null) {
          // Range when followed by ':' and a ref.
          if (peek()?.kind === 'op' && (peek() as { value: string }).value === ':') {
            next()
            const right = next()
            if (right?.kind !== 'id') throw new Error('bad range')
            const ref2 = parseRef(right.value)
            if (ref2 === null) throw new Error('bad range')
            return {
              t: 'range',
              c0: Math.min(ref.col, ref2.col), r0: Math.min(ref.row, ref2.row),
              c1: Math.max(ref.col, ref2.col), r1: Math.max(ref.row, ref2.row),
            }
          }
          return { t: 'ref', col: ref.col, row: ref.row }
        }
        throw new Error(`unknown id ${token.value}`)
      }
      default:
        throw new Error('unexpected token')
    }
  }

  try {
    const ast = parseOr()
    if (pos < tokens.length) throw new Error('trailing tokens')
    return ast
  } catch {
    return null
  }
}

interface EvalContext {
  table: TableDoc
  /** Formula cell position (relative refs resolve against it). */
  row: number
  col: number
  /** cell-key → resolved value cache for this recalc pass. */
  cache: Map<string, CellValue>
  depth: number
}

function cellValueAt(ctx: EvalContext, row: number, col: number): CellValue {
  const column = ctx.table.columns[col]
  if (column === undefined) return null
  const cell = ctx.table.rows[row]?.cells[column.id]
  if (cell === undefined) return null
  if (cell.formula !== undefined) {
    const key = `${row}:${col}`
    if (ctx.cache.has(key)) {
      const cached = ctx.cache.get(key)
      return cached === null || cached === undefined ? ERROR : cached // in-progress marker = cycle
    }
    ctx.cache.set(key, null) // cycle guard
    const value = evaluateFormulaAt(ctx.table, row, col, cell.formula, ctx.cache, ctx.depth + 1)
    ctx.cache.set(key, value)
    return value
  }
  return cell.value
}

function asNumber(value: CellValue): number {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value !== '') return Number(value)
  return Number.NaN
}

function rangeValues(ctx: EvalContext, node: Extract<Ast, { t: 'range' }>): CellValue[] {
  const values: CellValue[] = []
  for (let r = node.r0; r <= node.r1; r += 1) {
    for (let c = node.c0; c <= node.c1; c += 1) {
      values.push(cellValueAt(ctx, r, c))
    }
  }
  return values
}

function truthy(value: CellValue): boolean {
  if (value === null || value === '') return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  return true
}

function compare(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN')
}

/** First value of a range/array, or the scalar itself. */
function asScalar(v: CellValue | CellValue[]): CellValue {
  /* v8 ignore next -- non-empty ranges and scalars never yield undefined here. */
  return (Array.isArray(v) ? v[0] : v) ?? null
}

/** Evaluate a value AST node (ranges yield value arrays). */
function evalNode(ctx: EvalContext, node: Ast): CellValue | CellValue[] {
  if (ctx.depth > 64) return ERROR
  switch (node.t) {
    case 'num': return node.value
    case 'bool': return node.value
    case 'str': return node.value
    case 'ref': return cellValueAt(ctx, node.row, node.col)
    case 'range': return rangeValues(ctx, node)
    case 'un': {
      const operand = asScalar(evalNode(ctx, node.operand))
      return node.op === '-' ? -asNumber(operand) : asNumber(operand)
    }
    case 'bin': {
      const lv = asScalar(evalNode(ctx, node.left))
      const rv = asScalar(evalNode(ctx, node.right))
      /* v8 ignore next -- the parser never builds AND/OR operator nodes. */
      if (node.op === 'AND') return truthy(lv) && truthy(rv)
      /* v8 ignore next -- the parser never builds AND/OR operator nodes. */
      if (node.op === 'OR') return truthy(lv) || truthy(rv)
      const l = lv
      const r = rv
      if (l === ERROR || r === ERROR) return ERROR
      switch (node.op) {
        case '+': return asNumber(l) + asNumber(r)
        case '-': return asNumber(l) - asNumber(r)
        case '*': return asNumber(l) * asNumber(r)
        case '/': return asNumber(r) === 0 ? ERROR : asNumber(l) / asNumber(r)
        case '%': return asNumber(l) % asNumber(r)
        case '^': return asNumber(l) ** asNumber(r)
        case '=': return l === r
        case '<>': return l !== r
        case '<': return compare(l, r) < 0
        case '<=': return compare(l, r) <= 0
        case '>': return compare(l, r) > 0
        case '>=': return compare(l, r) >= 0
        /* v8 ignore next -- every tokenized operator is handled above. */
        default: return ERROR
      }
    }
    case 'call': {
      const args = node.args.map(arg => evalNode(ctx, arg))
      const flat = (v: CellValue | CellValue[]): CellValue[] => Array.isArray(v) ? v : [v]
      const numbers = args.flatMap(flat).map(asNumber)
      /* v8 ignore next -- call args are scalars or non-empty ranges, never undefined arrays. */
      const first = (v: CellValue | CellValue[]): CellValue => (Array.isArray(v) ? v[0] : v) ?? null
      switch (node.name) {
        case 'SUM': return numbers.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0)
        case 'AVERAGE': {
          const nums = numbers.filter(n => !Number.isNaN(n))
          return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length
        }
        case 'MAX': {
          const nums = numbers.filter(n => !Number.isNaN(n))
          return nums.length === 0 ? 0 : Math.max(...nums)
        }
        case 'MIN': {
          const nums = numbers.filter(n => !Number.isNaN(n))
          return nums.length === 0 ? 0 : Math.min(...nums)
        }
        case 'COUNT': return numbers.filter(n => !Number.isNaN(n)).length
        case 'COUNTA': return args.flatMap(flat).filter(a => a !== null && a !== '').length
        case 'IF': return truthy(first(args[0] ?? null)) ? first(args[1] ?? null) : first(args[2] ?? null)
        case 'AND': return args.flatMap(flat).every(truthy)
        case 'OR': return args.flatMap(flat).some(truthy)
        case 'CONCAT': return args.flatMap(flat).map(a => String(a ?? '')).join('')
        case 'TEXTJOIN': {
          const sep = String(first(args[0] ?? null) ?? '')
          return args.slice(1).flatMap(flat).filter(a => a !== null && a !== '').map(a => String(a)).join(sep)
        }
        case 'ROUND': return Math.round(numbers[0] ?? 0)
        case 'ABS': return Math.abs(numbers[0] ?? 0)
        case 'TODAY': {
          const d = new Date()
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          return `${d.getFullYear()}-${mm}-${dd}`
        }
        case 'NOW': return Date.now()
        case 'DATE': {
          const d = new Date(numbers[0] ?? 0, (numbers[1] ?? 1) - 1, numbers[2] ?? 1)
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          return `${d.getFullYear()}-${mm}-${dd}`
        }
        case 'YEAR': return new Date(numbers[0] ?? 0).getFullYear()
        case 'MONTH': return new Date(numbers[0] ?? 0).getMonth() + 1
        case 'DAY': return new Date(numbers[0] ?? 0).getDate()
        case 'LEFT': return String(args[0] ?? '').slice(0, Math.max(0, numbers[1] ?? 1))
        case 'RIGHT': {
          const text = String(args[0] ?? '')
          return text.slice(Math.max(0, text.length - (numbers[1] ?? 1)))
        }
        case 'MID': return String(args[0] ?? '').slice((numbers[1] ?? 1) - 1, (numbers[1] ?? 1) - 1 + (numbers[2] ?? 1))
        case 'LEN': return String(args[0] ?? '').length
        case 'TRIM': return String(args[0] ?? '').trim()
        case 'UPPER': return String(args[0] ?? '').toUpperCase()
        case 'LOWER': return String(args[0] ?? '').toLowerCase()
        default: return ERROR
      }
    }
  }
}

/** Evaluate a formula for a specific cell. */
export function evaluateFormulaAt(
  table: TableDoc,
  row: number,
  col: number,
  formula: string,
  cache = new Map<string, CellValue>(),
  depth = 0,
): CellValue {
  const body = formula.startsWith('=') ? formula.slice(1) : formula
  const ast = parseFormula(body)
  if (ast === null) return ERROR
  try {
    const result = evalNode({ table, row, col, cache, depth }, ast)
    return Array.isArray(result) ? (result[0] ?? null) : result
  } catch {
    /* v8 ignore next -- evalNode does not throw for any parseable AST. */
    return ERROR
  }
}

/** Evaluate a formula against a standalone context (tests). */
export function evaluateFormula(table: TableDoc, row: number, col: number, formula: string): CellValue {
  return evaluateFormulaAt(table, row, col, formula)
}

/** Recalculate every formula cell's cached value in place. */
export function recalcFormulas(table: TableDoc): void {
  const cache = new Map<string, CellValue>()
  table.rows.forEach((row, r) => {
    for (const [columnId, cell] of Object.entries(row.cells)) {
      if (cell.formula === undefined) continue
      const c = table.columns.findIndex(column => column.id === columnId)
      if (c < 0) continue
      const value = evaluateFormulaAt(table, r, c, cell.formula, cache, 0)
      cell.value = value
    }
  })
}
