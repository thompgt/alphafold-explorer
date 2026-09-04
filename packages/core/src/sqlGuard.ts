/**
 * Validation for SQL produced by a language model.
 *
 * The model is never trusted. Everything it emits passes through here before it
 * reaches DuckDB, and the guard works by *allowing* a narrow shape rather than
 * blocking a list of bad words: exactly one top-level SELECT (or WITH ... SELECT),
 * reading only from named views, with no statement separators, no DDL/DML, and no
 * function that can touch the filesystem, the network or another database.
 *
 * This is one layer. The caller also runs the statement inside a transaction that is
 * always rolled back, so even a bypass cannot persist anything.
 */

export class SqlGuardError extends Error {
  constructor(
    message: string,
    readonly reason: GuardReason,
  ) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

export type GuardReason =
  | 'empty'
  | 'not_a_select'
  | 'multiple_statements'
  | 'forbidden_keyword'
  | 'forbidden_function'
  | 'unknown_relation'
  | 'unterminated_literal';

/** The only relations natural-language queries may read. */
export const ALLOWED_RELATIONS = [
  'v_protein_overview',
  'v_low_confidence_segments',
  'v_residue_confidence',
] as const;

/** Statement-shaping and side-effecting keywords. None have a place in a read query. */
const FORBIDDEN_KEYWORDS = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'truncate',
  'create', 'drop', 'alter', 'rename',
  'attach', 'detach', 'copy', 'export', 'import',
  'install', 'load', 'pragma', 'call', 'set', 'reset',
  'grant', 'revoke', 'vacuum', 'checkpoint', 'analyze',
  'begin', 'commit', 'rollback', 'transaction',
  'prepare', 'execute', 'deallocate', 'use',
]);

/**
 * Functions that read outside the database. DuckDB exposes a lot of these, and a
 * plain SELECT is enough to exfiltrate a file through any one of them.
 */
const FORBIDDEN_FUNCTIONS = [
  /^read_/, /^scan_/, /_scan$/, /^sniff_/, /^glob$/,
  /^duckdb_/, /^pg_/, /^postgres_/, /^mysql_/, /^sqlite_/, /^iceberg_/, /^delta_/,
  /^getenv$/, /^shell$/, /^system$/, /^which_secret$/, /^parquet_/,
];

type TokenKind = 'word' | 'string' | 'number' | 'punct';

export interface Token {
  kind: TokenKind;
  value: string;
  /** Lower-cased value; identical to value for non-words. */
  lower: string;
}

/**
 * Tokenises far enough to reason about structure. Comments are dropped, which stops
 * a statement being smuggled in behind one, and string and quoted-identifier contents
 * are kept opaque so their bytes can never be mistaken for keywords.
 */
export function tokenise(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new SqlGuardError('unterminated block comment', 'unterminated_literal');
      i = end + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= sql.length) {
          throw new SqlGuardError('unterminated string literal', 'unterminated_literal');
        }
        if (sql[j] === ch) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[j + 1] === ch) {
            value += ch;
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j];
        j += 1;
      }
      // Double and backtick quotes delimit identifiers in DuckDB; single quotes are strings.
      tokens.push(
        ch === "'"
          ? { kind: 'string', value, lower: value }
          : { kind: 'word', value, lower: value.toLowerCase() },
      );
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[0-9._eE]/.test(sql[j]!)) j += 1;
      const value = sql.slice(i, j);
      tokens.push({ kind: 'number', value, lower: value });
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j]!)) j += 1;
      const value = sql.slice(i, j);
      tokens.push({ kind: 'word', value, lower: value.toLowerCase() });
      i = j;
      continue;
    }

    tokens.push({ kind: 'punct', value: ch, lower: ch });
    i += 1;
  }

  return tokens;
}

export interface GuardOptions {
  allowedRelations?: readonly string[];
  /** Row cap applied by wrapping the statement when it has no LIMIT of its own. */
  maxRows?: number;
}

export interface GuardedSql {
  /** The statement to execute: the input, wrapped in a row cap if it needed one. */
  sql: string;
  /** Relations the statement reads. */
  relations: string[];
  limitApplied: boolean;
}

/**
 * Throws SqlGuardError unless `sql` is a single read-only SELECT over allowed views.
 */
export function guardSql(sql: string, options: GuardOptions = {}): GuardedSql {
  const allowed = new Set<string>(options.allowedRelations ?? ALLOWED_RELATIONS);
  const maxRows = options.maxRows ?? 200;

  const tokens = tokenise(sql);
  if (tokens.length === 0) throw new SqlGuardError('no SQL statement supplied', 'empty');

  // Exactly one statement: a semicolon may only be the final token.
  const semicolon = tokens.findIndex((t) => t.kind === 'punct' && t.value === ';');
  if (semicolon !== -1 && semicolon !== tokens.length - 1) {
    throw new SqlGuardError('only a single statement is allowed', 'multiple_statements');
  }
  const body = semicolon === -1 ? tokens : tokens.slice(0, -1);
  if (body.length === 0) throw new SqlGuardError('no SQL statement supplied', 'empty');

  const first = body[0]!;
  if (first.kind !== 'word' || (first.lower !== 'select' && first.lower !== 'with')) {
    throw new SqlGuardError(
      `statement must start with SELECT or WITH, got ${JSON.stringify(first.value)}`,
      'not_a_select',
    );
  }

  const cteNames = collectCteNames(body);

  for (const [index, token] of body.entries()) {
    if (token.kind !== 'word') continue;

    if (FORBIDDEN_KEYWORDS.has(token.lower)) {
      throw new SqlGuardError(
        `keyword ${token.value.toUpperCase()} is not allowed`,
        'forbidden_keyword',
      );
    }

    const next = body[index + 1];
    const isCall = next?.kind === 'punct' && next.value === '(';
    if (isCall && FORBIDDEN_FUNCTIONS.some((pattern) => pattern.test(token.lower))) {
      throw new SqlGuardError(`function ${token.value} is not allowed`, 'forbidden_function');
    }
  }

  const relations = collectRelations(body, allowed, cteNames);

  const hasLimit = body.some((t) => t.kind === 'word' && t.lower === 'limit');
  const statement = sql.trim().replace(/;\s*$/, '');
  return {
    sql: hasLimit
      ? statement
      : `SELECT * FROM (\n${statement}\n) AS guarded_query LIMIT ${maxRows}`,
    relations,
    limitApplied: !hasLimit,
  };
}

/** Names bound by a WITH clause: legal FROM targets even though they are not views. */
function collectCteNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'word' || token.lower !== 'as') continue;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous?.kind === 'word' && next?.kind === 'punct' && next.value === '(') {
      names.add(previous.lower);
    }
  }
  return names;
}

/**
 * Every FROM/JOIN target must be an allowed view, a CTE, or a parenthesised subquery.
 * This is what stops reading a file path, a table function, or a qualified name that
 * reaches into another schema or attached database.
 */
function collectRelations(tokens: Token[], allowed: Set<string>, cteNames: Set<string>): string[] {
  const found = new Set<string>();

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'word') continue;
    if (token.lower !== 'from' && token.lower !== 'join') continue;

    const target = tokens[index + 1];
    if (!target) {
      throw new SqlGuardError(`${token.value.toUpperCase()} has no target`, 'unknown_relation');
    }
    if (target.kind === 'punct' && target.value === '(') continue; // subquery
    if (target.kind === 'string') {
      throw new SqlGuardError('reading from a file path is not allowed', 'unknown_relation');
    }
    if (target.kind !== 'word') {
      throw new SqlGuardError(
        `unexpected ${token.value.toUpperCase()} target ${JSON.stringify(target.value)}`,
        'unknown_relation',
      );
    }

    const following = tokens[index + 2];

    // A qualified name (main.proteins, other_db.schema.table) is never allowed.
    if (following?.kind === 'punct' && following.value === '.') {
      throw new SqlGuardError(
        `qualified relation names are not allowed: ${target.value}.*`,
        'unknown_relation',
      );
    }

    // A table function such as range(10) is a call, not a relation we can allowlist.
    if (following?.kind === 'punct' && following.value === '(') {
      throw new SqlGuardError(`table function ${target.value} is not allowed`, 'forbidden_function');
    }

    if (cteNames.has(target.lower)) continue;
    if (!allowed.has(target.lower)) {
      throw new SqlGuardError(
        `relation ${target.value} is not queryable; allowed: ${[...allowed].join(', ')}`,
        'unknown_relation',
      );
    }
    found.add(target.lower);
  }

  return [...found];
}
